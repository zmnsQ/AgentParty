import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type AppEnv } from "../src/index";
import { handleChannelMcp } from "../src/collaboration/mcp";
import { markMcpDiagnostic, mcpRequestDiagnostics } from "../src/collaboration/mcp-request-diagnostics";
import { createChannel, seedToken, uniq } from "./helpers";
import { enableMcpFixture } from "./mcp-test-helpers";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const future = () => new Date(Date.now() + 60_000).toISOString();
const endpoint = "https://commons.test/api/channels/private-channel-canary/mcp?query-canary=private";
const init = { jsonrpc: "2.0", id: "private-rpc-id-canary", method: "initialize", params: {
  protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "private-client-canary", version: "1" },
} };
function spy() { return vi.spyOn(console, "warn").mockImplementation(() => {}); }
function records(log: ReturnType<typeof spy>) {
  return log.mock.calls.filter(call => call[0] === "mcp_request_diagnostic").map(call => JSON.parse(String(call[1])));
}
function testApp(until: () => string | undefined = future) {
  const app = new Hono(); app.use("*", mcpRequestDiagnostics({ until }));
  // Preserve a fixed exception response without using Hono's unrelated default console.error.
  app.onError(() => new Response("Internal Server Error", { status: 500 }));
  return app;
}

describe("temporary MCP request diagnostics", () => {
  it("whitelists eight fields and never reads headers/body/query/response values into logs", async () => {
    const log = spy(), app = testApp();
    app.post("*", c => {
      markMcpDiagnostic(c.req.raw, "participant_removed");
      return c.json({ error: { code: "participant_removed", message: "private-response-canary" } }, 403);
    });
    const response = await app.request(endpoint, { method: "POST", headers: {
      authorization: "Bearer private-token-canary", cookie: "private-cookie-canary",
      "x-request-id": "private-client-request-id-canary", "content-type": "application/json",
    }, body: JSON.stringify(init) });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { message: "private-response-canary" } });
    const [start, finish] = records(log);
    expect(Object.keys(finish).sort()).toEqual(["request_time", "request_id", "method", "route", "http_status",
      "duration_ms", "error_code", "authorization_present"].sort());
    expect(start).toMatchObject({ http_status: null, duration_ms: null, error_code: null });
    expect(finish).toMatchObject({ request_id: start.request_id, method: "POST", route: "/api/channels/:slug/mcp",
      authorization_present: true, http_status: 403, error_code: "participant_removed" });
    expect(finish.request_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(Number.isFinite(Date.parse(finish.request_time))).toBe(true);
    expect(finish.duration_ms).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-|query-canary/);
  });

  it.each([undefined, "invalid", "2000-01-01T00:00:00Z"])("stays disabled for missing/invalid/expired deadline %s", async deadline => {
    const log = spy(), app = testApp(() => deadline); app.all("*", c => c.text("ok"));
    expect((await app.request(endpoint)).status).toBe(200); expect(records(log)).toHaveLength(0);
  });

  it("stops new admissions at expiry, while completing an already admitted request", async () => {
    const log = spy(); let deadline = future();
    const app = testApp(() => deadline);
    app.get("*", c => { deadline = "2000-01-01T00:00:00Z"; return c.text("ok"); });
    await app.request(endpoint); await app.request(endpoint);
    expect(records(log)).toHaveLength(2); expect(records(log)[1].http_status).toBe(200);
  });

  it("ignores non-MCP routes and clamps unknown methods to OTHER", async () => {
    const log = spy(), app = testApp(); app.all("*", c => c.text("ok"));
    for (const path of ["/api/health", "/oauth/token", "/api/channels/dev/messages", "/api/channels/dev/mcp/other"])
      await app.request("https://commons.test" + path);
    expect(records(log)).toHaveLength(0);
    // workerd rejects unknown methods before constructing a real Request.
    // Exercise the defensive allowlist with a synthetic middleware context.
    const middleware = mcpRequestDiagnostics({ until: future });
    await middleware({ req: { path: "/api/channels/dev/mcp", raw: {
      method: "PRIVATE-METHOD-CANARY", headers: new Headers(),
    } }, res: new Response("ok") } as unknown as Parameters<typeof middleware>[0], async () => {});
    expect(records(log)[0].method).toBe("OTHER");
  });

  it("caps at 64 requests / 128 records, including concurrent requests and completions", async () => {
    const log = spy(), app = testApp(); app.get("*", c => c.text("ok"));
    await Promise.all(Array.from({ length: 80 }, () => app.request(endpoint)));
    const rows = records(log); expect(rows).toHaveLength(128);
    expect(new Set(rows.map(row => row.request_id)).size).toBe(64);
    expect(rows.filter(row => row.http_status === 200)).toHaveLength(64);
    expect(JSON.stringify(rows).length).toBeLessThan(50_000);
  });

  it("logs exceptions only as internal_error and never consumes an open response stream", async () => {
    const log = spy(), app = testApp();
    app.get("*", () => { throw new Error("private-exception-canary"); });
    expect((await app.request(endpoint)).status).toBe(500);
    expect(records(log)[1]).toMatchObject({ http_status: 500, error_code: "internal_error" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-exception-canary");
    log.mockClear();
    const streamApp = testApp(); let controller!: ReadableStreamDefaultController;
    const stream = new ReadableStream({ start(c) { controller = c; } });
    streamApp.get("*", () => new Response(stream, { headers: { "content-type": "text/event-stream" } }));
    const response = await streamApp.request(endpoint);
    expect(records(log)[1]).toMatchObject({ http_status: 200, error_code: null });
    expect(response.bodyUsed).toBe(false); controller.close();
  });

  it("logging failures do not change the authentication response", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => { throw new Error("sink-failed"); });
    const app = testApp(); app.get("*", c => c.text("unauthorized", 401));
    const response = await app.request(endpoint);
    expect(response.status).toBe(401); expect(await response.text()).toBe("unauthorized");
  });

  it.each([
    [{ "content-type": "text/plain" }, 415, "unsupported_media_type"],
    [{ "content-type": "application/json", origin: "https://private-origin-canary.test" }, 403, "origin_rejected"],
    [{ "content-type": "application/json", "mcp-protocol-version": "unknown-canary" }, 400, "protocol_version_unsupported"],
  ])("classifies protocol rejection without logging header values %s", async (headers, status, code) => {
    const log = spy(), app = testApp();
    app.post("*", c => handleChannelMcp(c.req.raw, "private-channel-canary", {
      name: "private-agent-canary", kind: "agent", role: "agent", hash: "private-hash-canary", channel_scope: "private-channel-canary",
    }, async () => { throw new Error("must not forward"); }));
    expect((await app.request(endpoint, { method: "POST", headers: headers as HeadersInit, body: JSON.stringify(init) })).status).toBe(status);
    expect(records(log)[1].error_code).toBe(code);
    expect(JSON.stringify(log.mock.calls)).not.toContain("canary");
  });

  it("reaches the real auth/policy/initialize/tool paths with synthetic credentials only", async () => {
    const owner = await seedToken("human", uniq("diagnostic-owner"), { owner: uniq("private-account") });
    const slug = await createChannel(owner.token);
    const row = await env.DB.prepare("SELECT owner FROM tokens WHERE name=?").bind(owner.name).first<{ owner: string }>();
    const agent = await seedToken("agent", uniq("private-agent"), { owner: row!.owner, channelScope: slug });
    vi.stubGlobal("__AGENTPARTY_MCP_DIAGNOSTICS_UNTIL__", future());
    const log = spy();
    const invoke = async (token?: string, body: unknown = init) => {
      const ctx = createExecutionContext();
      const response = await worker.fetch(new Request(`https://commons.test/api/channels/${slug}/mcp?query-canary`, {
        method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }), env as unknown as AppEnv, ctx);
      await waitOnExecutionContext(ctx); return response;
    };
    expect((await invoke()).status).toBe(401);
    expect(records(log).at(-1)).toMatchObject({ authorization_present: false, http_status: 401, error_code: "unauthorized" });
    expect((await invoke(agent.token)).status).toBe(403);
    expect(records(log).at(-1).error_code).toBe("mcp_disabled");
    await enableMcpFixture(slug, row!.owner, false, false);
    expect((await invoke(agent.token)).status).toBe(200);
    expect(records(log).at(-1)).toMatchObject({ http_status: 200, error_code: null });
    expect((await invoke(agent.token, { jsonrpc: "2.0", id: 2, method: "tools/list" })).status).toBe(200);
    expect((await invoke(agent.token, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "commons_profile" } })).status).toBe(200);
    expect(records(log)).toHaveLength(10);
    await env.DB.prepare("INSERT INTO channel_participant_removals(channel_slug,principal_type,principal,removed_at,removal_epoch,removed_by) VALUES(?,'name',?,?,?,?)")
      .bind(slug, agent.name, Date.now(), crypto.randomUUID(), owner.name).run();
    expect((await invoke(agent.token)).status).toBe(403);
    expect(records(log).at(-1)).toMatchObject({ authorization_present: true, http_status: 403, error_code: "participant_removed" });
    await env.DB.prepare("UPDATE tokens SET revoked_at=? WHERE name=?").bind(Date.now(), agent.name).run();
    expect((await invoke(agent.token)).status).toBe(401);
    expect(records(log).at(-1)).toMatchObject({ authorization_present: true, http_status: 401, error_code: "unauthorized" });
    const output = JSON.stringify(log.mock.calls);
    for (const secret of [owner.token, agent.token, slug, agent.name, row!.owner, "query-canary", "private-client-canary", "private-rpc-id-canary"])
      expect(output).not.toContain(secret);
  });
});
