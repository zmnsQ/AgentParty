import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type AppEnv } from "../src/index";
import { handleChannelMcp } from "../src/collaboration/mcp";
import { markMcpDiagnostic, mcpRequestDiagnostics, MCP_CAPTURE_LIMITS } from "../src/collaboration/mcp-request-diagnostics";
import { createChannel, seedToken, uniq } from "./helpers";
import { enableMcpFixture } from "./mcp-test-helpers";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const future = () => new Date(Date.now() + 60_000).toISOString();
const endpoint = "https://commons.test/api/channels/private-channel-canary/mcp?query-canary=private";
const init = { jsonrpc: "2.0", id: "private-rpc-id-canary", method: "initialize", params: {
  protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "private-client-canary", version: "1" },
} };
function spy() { return vi.spyOn(console, "warn").mockImplementation(() => {}); }
function allRecords(log: ReturnType<typeof spy>) {
  return log.mock.calls.filter(call => call[0] === "mcp_request_diagnostic").map(call => JSON.parse(String(call[1])));
}
const CONTROLS = ["diagnostic_window_opened", "diagnostic_limit_reached", "diagnostic_window_closed"];
function records(log: ReturnType<typeof spy>) { return allRecords(log).filter(row => !CONTROLS.includes(row.error_code)); }
function testApp(options: Parameters<typeof mcpRequestDiagnostics>[0] = {}) {
  const base = Date.now(), app = new Hono();
  app.use("*", mcpRequestDiagnostics({from:()=>new Date(base-1000).toISOString(), until:()=>new Date(base+60_000).toISOString(), ...options}));
  app.onError(()=>new Response("Internal Server Error",{status:500})); return app;
}
describe("short full MCP capture",()=>{
  it("defaults off, including the legacy UNTIL-only build",async()=>{
    const log=spy();vi.stubGlobal("__AGENTPARTY_MCP_DIAGNOSTICS_UNTIL__",future());
    const app=new Hono();app.use("*",mcpRequestDiagnostics());app.all("*",c=>c.text("ok"));
    await app.request(endpoint);expect(allRecords(log)).toEqual([]);
  });
  it("initializes inside a request even if the startup clock was epoch zero",async()=>{
    const log=spy(),base=Date.now();let now=0;
    const app=testApp({from:()=>new Date(base).toISOString(),until:()=>new Date(base+1000).toISOString(),now:()=>now});
    app.get("*",c=>c.text("denied",401));now=base;await app.request(endpoint);
    expect(records(log).at(-1)).toMatchObject({http_status:401,error_code:"unauthorized",request_time:new Date(base).toISOString()});
  });
  it.each([[undefined,undefined],["invalid","invalid"],["2026-01-01T00:00:01Z","2026-01-01T00:00:00Z"],["2026-01-01T00:00:00Z","2026-01-01T00:10:00.001Z"]])("rejects invalid capture window %s %s",async(from,until)=>{
    const log=spy(),app=testApp({from:()=>from,until:()=>until});app.all("*",c=>c.text("ok"));
    expect((await app.request(endpoint)).status).toBe(200);expect(allRecords(log)).toHaveLength(0);
  });
  it("opens only at the agreed time and closes via health without restarting or reopening",async()=>{
    const log=spy(),base=Date.now();let now=base-1;
    const app=testApp({from:()=>new Date(base).toISOString(),until:()=>new Date(base+1000).toISOString(),now:()=>now});app.all("*",c=>c.text("ok"));
    await app.request(endpoint);expect(allRecords(log)).toHaveLength(0);
    now=base;await app.request("https://commons.test/api/health");expect(allRecords(log).map(x=>x.error_code)).toEqual(["diagnostic_window_opened"]);
    await app.request(endpoint);expect(records(log)).toHaveLength(2);
    now=base+1000;await app.request("https://commons.test/api/health");expect(allRecords(log).at(-1).error_code).toBe("diagnostic_window_closed");
    const count=allRecords(log).length;now=base;await app.request(endpoint);expect(allRecords(log)).toHaveLength(count);
  });
  it("marks a window closed even when no request ran inside it",async()=>{
    const log=spy(),base=Date.now(),app=testApp({from:()=>new Date(base-2000).toISOString(),until:()=>new Date(base-1000).toISOString()});app.all("*",c=>c.text("ok"));
    await app.request("https://commons.test/api/health");expect(allRecords(log).map(x=>x.error_code)).toEqual(["diagnostic_window_closed"]);expect(records(log)).toHaveLength(0);
  });
  it("records entry before dispatch and whitelists eight fields without consuming bodies",async()=>{
    const log=spy(),app=testApp();app.post("*",c=>{
      expect(records(log)).toHaveLength(1);expect(records(log)[0].http_status).toBeNull();expect(c.req.raw.bodyUsed).toBe(false);
      markMcpDiagnostic(c.req.raw,"participant_removed");return c.json({private:"private-response-canary"},403);
    });
    const response=await app.request(endpoint,{method:"POST",headers:{authorization:"Bearer private-token-canary",cookie:"private-cookie-canary","x-request-id":"private-client-id-canary",origin:"https://private-origin-canary.test"},body:JSON.stringify(init)});
    expect(await response.json()).toEqual({private:"private-response-canary"});
    const [start,end]=records(log);expect(end).toMatchObject({request_id:start.request_id,http_status:403,error_code:"participant_removed",authorization_present:true});
    expect(start.request_id).toMatch(/^[a-f0-9-]{36}$/);
    for(const row of allRecords(log))expect(Object.keys(row).sort()).toEqual(["request_time","request_id","method","route","http_status","duration_ms","error_code","authorization_present"].sort());
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-|query-canary/);
  });
  it("records all high-frequency normal requests and subsequent failures without sampling",async()=>{
    const log=spy(),app=testApp();app.get("*",c=>c.text("ok"));app.post("*",c=>c.text("denied",403));
    await Promise.all(Array.from({length:1000},()=>app.request(endpoint)));
    await Promise.all(Array.from({length:20},()=>app.request(endpoint,{method:"POST"})));
    const rows=records(log);expect(rows).toHaveLength(2040);expect(new Set(rows.map(x=>x.request_id)).size).toBe(1020);
    expect(rows.filter(x=>x.http_status===200)).toHaveLength(1000);expect(rows.filter(x=>x.http_status===403)).toHaveLength(20);
    expect(allRecords(log).some(x=>x.error_code==="diagnostic_limit_reached")).toBe(false);
    for(const id of new Set(rows.map(x=>x.request_id)))expect(rows.filter(x=>x.request_id===id)).toHaveLength(2);
  });
  it("reserves terminal/overflow/close records within a hard byte bound",async()=>{
    const log=spy(),base=Date.now();let now=base,served=0;
    const app=testApp({from:()=>new Date(base).toISOString(),until:()=>new Date(base+1000).toISOString(),now:()=>now});app.all("*",c=>{served++;return c.text("ok");});
    await Promise.all(Array.from({length:1026},()=>app.request(endpoint)));
    expect(served).toBe(1026);expect(records(log)).toHaveLength(2048);expect(allRecords(log).filter(x=>x.error_code==="diagnostic_limit_reached")).toHaveLength(1);
    now=base+1000;await app.request("https://commons.test/api/health");expect(allRecords(log)).toHaveLength(MCP_CAPTURE_LIMITS.maxRecords);
    expect(allRecords(log).filter(x=>x.error_code==="diagnostic_window_closed")).toHaveLength(1);
    for(const c of log.mock.calls)expect(String(c[0]).length+String(c[1]).length+2).toBeLessThanOrEqual(MCP_CAPTURE_LIMITS.maxRecordBytes);
    expect(log.mock.calls.reduce((n,c)=>n+String(c[0]).length+String(c[1]).length+2,0)).toBeLessThanOrEqual(MCP_CAPTURE_LIMITS.maxApplicationBytes);
    await app.request(endpoint);expect(allRecords(log)).toHaveLength(MCP_CAPTURE_LIMITS.maxRecords);
  });
  it("snapshots concurrent hangs at cutoff with matching IDs and no fabricated HTTP status",async()=>{
    const log=spy(),base=Date.now();let now=base,release!:()=>void;
    const gate=new Promise<void>(r=>{release=r;});const app=testApp({from:()=>new Date(base).toISOString(),until:()=>new Date(base+1000).toISOString(),now:()=>now});
    app.post("*",async c=>{await gate;return c.text("ok");});app.get("*",c=>c.text("ok"));
    const flight=[app.request(endpoint,{method:"POST"}),app.request(endpoint,{method:"POST"})];await new Promise(r=>setTimeout(r,0));
    const starts=records(log);expect(starts).toHaveLength(2);now=base+1000;await app.request("https://commons.test/api/health");
    const ends=records(log).filter(x=>x.error_code==="diagnostic_pending_at_cutoff");expect(ends).toHaveLength(2);expect(ends.map(x=>x.request_id).sort()).toEqual(starts.map(x=>x.request_id).sort());
    expect(ends.every(x=>x.http_status===null&&x.duration_ms===1000)).toBe(true);const count=allRecords(log).length;release();
    expect((await Promise.all(flight)).every(x=>x.status===200)).toBe(true);expect(allRecords(log)).toHaveLength(count);
  });
  it("an active request timer closes a hang without a health request",async()=>{
    const log=spy(),base=Date.now();let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
    const app=testApp({from:()=>new Date(base-1).toISOString(),until:()=>new Date(base+40).toISOString()});app.post("*",async c=>{await gate;return c.text("ok");});
    const flight=app.request(endpoint,{method:"POST"});await new Promise(r=>setTimeout(r,70));
    expect(records(log).some(x=>x.error_code==="diagnostic_pending_at_cutoff")).toBe(true);expect(allRecords(log).some(x=>x.error_code==="diagnostic_window_closed")).toBe(true);
    release();expect((await flight).status).toBe(200);
  });
  it("captures exceptions and HTTP200 tool errors without error text",async()=>{
    const log=spy(),app=testApp();app.get("*",()=>{throw new Error("private-exception-canary");});app.post("*",c=>{markMcpDiagnostic(c.req.raw,"tool_error");return c.json({private:"private-response-canary"});});
    expect((await app.request(endpoint)).status).toBe(500);expect((await app.request(endpoint,{method:"POST"})).status).toBe(200);
    expect(records(log).filter(x=>x.http_status!==null).map(x=>x.error_code)).toEqual(["internal_error","tool_error"]);expect(JSON.stringify(log.mock.calls)).not.toContain("private-");
  });
  it("does not consume streams or change authentication if logging fails",async()=>{
    const log=spy(),app=testApp();let controller!:ReadableStreamDefaultController;const stream=new ReadableStream({start(c){controller=c;}});app.get("*",()=>new Response(stream));
    app.post("*",c=>c.text("denied",401));
    const response=await app.request(endpoint);expect(response.bodyUsed).toBe(false);expect(records(log).at(-1).http_status).toBe(200);controller.close();
    log.mockImplementation(()=>{throw new Error("private-sink-canary");});expect((await app.request(endpoint,{method:"POST"})).status).toBe(401);
  });
  it.each(["/api/channels/private-canary/mcp/","/api/channels/private%20canary/mcp"])("captures rejected MCP path shapes without recording the segment %s",async path=>{
    const log=spy(),app=testApp();app.all("*",c=>c.text("missing",404));await app.request("https://commons.test"+path);
    expect(records(log)).toHaveLength(2);expect(records(log).at(-1)).toMatchObject({http_status:404,route:"/api/channels/:slug/mcp"});expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });
  it("ignores other routes and clamps unknown HTTP methods",async()=>{
    const log=spy(),app=testApp();app.all("*",c=>c.text("ok"));for(const path of ["/api/health","/oauth/token","/api/channels/dev/messages","/api/channels/dev/mcp/other"])await app.request("https://commons.test"+path);expect(records(log)).toHaveLength(0);
    const base=Date.now(),middleware=mcpRequestDiagnostics({from:()=>new Date(base).toISOString(),until:()=>new Date(base+1000).toISOString()});
    await middleware({req:{path:"/api/channels/dev/mcp",raw:{method:"PRIVATE-METHOD-CANARY",headers:new Headers()}},res:new Response("ok")} as unknown as Parameters<typeof middleware>[0],async()=>{});
    expect(records(log)[0].method).toBe("OTHER");expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE-METHOD-CANARY");
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
    const log = spy();
    const invoke = async (token?: string, body: unknown = init) => {
      const ctx = createExecutionContext();
      // Fresh controlled observer per call verifies real route classifications;
      // the separate sustained-traffic tests above exercise the shared budget.
      const observer = testApp();
      observer.all("*", c => worker.fetch(c.req.raw, env as unknown as AppEnv, ctx));
      const response = await observer.fetch(new Request(`https://commons.test/api/channels/${slug}/mcp?query-canary`, {
        method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }));
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
