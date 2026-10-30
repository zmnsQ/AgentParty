import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TokenIdentity } from "../src/auth";
import type { AppEnv } from "../src/index";
import { handleChannelMcp } from "../src/collaboration/mcp";

const schema = JSON.parse(readFileSync(new NodeURL("./fixtures/schema-2026-07-28.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(schema, "mcp-2026-07-28");
function conforms(definition: string, value: unknown) {
  const validate = ajv.compile({ $ref: `mcp-2026-07-28#/$defs/${definition}` });
  expect(validate(value), ajv.errorsText(validate.errors)).toBe(true);
}

const endpoint = "https://fixture.invalid/api/channels/fixture/mcp";
// Synthetic credential only. This fetch adapter never opens a socket or uses a provider.
const bearer = "Bearer fixture-only-not-a-production-credential";
const identity: TokenIdentity = { name: "fixture-agent", role: "agent", kind: "agent", hash: "fixture-hash", channel_scope: "fixture" };
const unused = async (): Promise<Response> => { throw Error("Unexpected group operation"); };
function environment() {
  const policy = { enabled: 1, owner_mfa_enabled: 1, allow_write: 1, allow_events: 1, updated_at: 0 };
  const env = { DB: { prepare(query: string) {
    return { bind() { return this; }, async first() {
      if (query.includes("channel_mcp_security")) return { ...policy };
      if (query.includes("browser_auth_limits")) return { attempts: 1 };
      throw Error("Unexpected fixture query");
    } };
  } } } as unknown as AppEnv;
  return { env, policy };
}
function modern(method: string, params: Record<string, unknown> = {}) {
  return new Request(endpoint, { method: "POST", headers: {
    authorization: bearer, "content-type": "application/json", accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2026-07-28", "mcp-method": method,
    ...(typeof params.name === "string" ? { "mcp-name": params.name } : {}),
  }, body: JSON.stringify({ jsonrpc: "2.0", id: "fixture-id", method, params: { ...params, _meta: {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": { name: "fixture", version: "1" },
  } } }) });
}
async function invoke(request: Request, env: AppEnv, forward = unused) {
  const response = await handleChannelMcp(request, "fixture", identity, forward, env);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const packet = await response.json() as { jsonrpc: string; id: string; result: Record<string, any> };
  expect(packet.id).toBe("fixture-id");
  conforms("JSONRPCResultResponse", packet);
  return packet.result;
}
afterEach(() => vi.unstubAllGlobals());

describe("pinned official MCP 2026-07-28 response contracts", () => {
  it("discovers a complete server result with authorization-private, immediately stale caching", async () => {
    const { env } = environment();
    const result = await invoke(modern("server/discover"), env);
    conforms("DiscoverResult", result);
    expect(result).toMatchObject({ resultType: "complete", ttlMs: 0, cacheScope: "private", supportedVersions: ["2026-07-28"] });
    expect(result._meta["io.modelcontextprotocol/serverInfo"]).toMatchObject({ name: "agent-commons", version: "0.2.0" });
  });

  it("lists valid tools and refreshes authorization-dependent visibility without shared caches", async () => {
    const { env, policy } = environment();
    const writable = await invoke(modern("tools/list"), env);
    conforms("ListToolsResult", writable);
    expect(writable).toMatchObject({ resultType: "complete", ttlMs: 0, cacheScope: "private" });
    expect(writable.tools).toHaveLength(16);
    expect(writable.tools.some((tool: any) => tool.name === "commons_send_message")).toBe(true);
    for (const tool of writable.tools) {
      expect(tool.securitySchemes).toBeUndefined();
      expect(ajv.compile(tool.inputSchema)).toBeTypeOf("function");
    }
    policy.allow_write = 0;
    const readonly = await invoke(modern("tools/list"), env);
    conforms("ListToolsResult", readonly);
    expect(readonly.tools.every((tool: any) => tool.annotations.readOnlyHint)).toBe(true);
    expect(readonly).toMatchObject({ ttlMs: 0, cacheScope: "private" });
    const denied = await handleChannelMcp(modern("tools/call", { name: "commons_send_message", arguments: { body: "unused", idempotency_key: "fixture" } }), "fixture", identity, unused, env);
    expect(denied.status).toBe(403);
    policy.enabled = 0;
    expect((await handleChannelMcp(modern("tools/list"), "fixture", identity, unused, env)).status).toBe(403);
  });

  it("validates complete tool success and execution-error results, without list cache hints", async () => {
    const { env } = environment();
    for (const [name, args, isError] of [
      ["commons_profile", {}, false],
      ["commons_read_messages", { after: "invalid" }, true],
    ] as const) {
      const result = await invoke(modern("tools/call", { name, arguments: args }), env);
      conforms("CallToolResult", result);
      expect(result).toMatchObject({ resultType: "complete", isError });
      expect(result.ttlMs).toBeUndefined();
      expect(result.cacheScope).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain(identity.hash);
    }
  });

  it("returns a complete ping and keeps invalid tool lookup a JSON-RPC error", async () => {
    const { env } = environment();
    conforms("EmptyResult", await invoke(modern("ping"), env));
    const response = await handleChannelMcp(modern("tools/call", { name: "missing", arguments: {} }), "fixture", identity, unused, env);
    const packet = await response.json() as any;
    expect(packet.error.code).toBe(-32602);
    expect(packet.result).toBeUndefined();
  });
});

describe("official SDK 1.31 legacy Streamable HTTP compatibility", () => {
  it("keeps legacy response fields for absent and both supported legacy version headers", async () => {
    const { env } = environment();
    for (const version of [null, "2025-06-18", "2025-11-25"]) {
      const request = new Request(endpoint, { method: "POST", headers: {
        authorization: bearer, "content-type": "application/json",
        ...(version === null ? {} : { "mcp-protocol-version": version }),
      }, body: JSON.stringify({ jsonrpc: "2.0", id: "legacy", method: "tools/list" }) });
      const response = await handleChannelMcp(request, "fixture", identity, unused, env);
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.result.tools).toHaveLength(16);
      for (const field of ["resultType", "ttlMs", "cacheScope"]) expect(body.result[field]).toBeUndefined();
    }
  });
  it("connects, initializes, lists and calls a read-only tool using only a synthetic Bearer", async () => {
    vi.stubGlobal("fetch", () => { throw Error("External network forbidden in protocol fixture"); });
    const { env } = environment();
    const observed: Array<{ method: string; status: number; version: string | null }> = [];
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { authorization: bearer } },
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.headers.get("authorization") !== bearer) return new Response(null, { status: 401 });
        const method = request.method === "POST" ? (await request.clone().json() as any).method : request.method;
        const response = await handleChannelMcp(request, "fixture", identity, unused, env);
        observed.push({ method, status: response.status, version: request.headers.get("mcp-protocol-version") });
        if (response.status === 200) {
          const body = await response.clone().json() as any;
          expect(body.result.resultType).toBeUndefined();
          expect(body.result.ttlMs).toBeUndefined();
          expect(body.result.cacheScope).toBeUndefined();
        }
        return response;
      },
    });
    const client = new Client({ name: "legacy-fixture", version: "1" }, { capabilities: {} });
    try {
      await client.connect(transport);
      expect(client.getServerCapabilities()).toEqual({ tools: { listChanged: false } });
      expect((await client.listTools()).tools).toHaveLength(16);
      const result = await client.callTool({ name: "commons_profile", arguments: {} });
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({ name: identity.name, channel: "fixture" });
      expect(observed.filter(row => row.method !== "GET").map(row => [row.method, row.status])).toEqual([
        ["initialize", 200], ["notifications/initialized", 202], ["tools/list", 200], ["tools/call", 200],
      ]);
      expect(observed.filter(row => ["tools/list", "tools/call"].includes(row.method)).every(row => row.version === "2025-06-18")).toBe(true);
      expect(observed.filter(row => row.method === "GET").every(row => row.status === 405)).toBe(true);
    } finally { await client.close(); }
  });
});
