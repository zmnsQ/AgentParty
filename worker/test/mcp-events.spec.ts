import { env } from "cloudflare:test";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { fetchMock } from "./fetch-mock";
import { api, createChannel, seedToken, uniq, WsClient, completeCapabilityHello } from "./helpers";
import { sha256Hex } from "../src/auth";
import { signMcpWebhook, enqueueMcpEvent, deliverMcpEvents, mcpEventReadiness } from "../src/collaboration/mcp-events";
import { handleChannelMcp } from "../src/collaboration/mcp";
import type { TokenIdentity } from "../src/auth";
import { enableMcpFixture } from "./mcp-test-helpers";

const CALLBACK="https://events.chatgpt.test/dot/callback";
const SECRET="whsec_"+btoa("dot-bridge-signing-key-12345678901234567890");
beforeEach(()=>{ fetchMock.activate();fetchMock.disableNetConnect(); });
afterEach(()=>{ try{fetchMock.assertNoPendingInterceptors();}finally{fetchMock.deactivate();} });
function rpc(method:string,params:unknown={}):Request {
  return new Request("https://commons.test/api/channels/demo/mcp",{
    method:"POST",headers:{"content-type":"application/json","mcp-protocol-version":"2026-07-28"},
    body:JSON.stringify({jsonrpc:"2.0",id:5,method,params}),
  });
}
const noForward=async()=>{throw new Error("no forward expected");};
async function group(){
  const account=uniq("event-account");
  const human=await seedToken("human",uniq("human"),{owner:account});
  const slug=await createChannel(human.token);
  await enableMcpFixture(slug,account);
  const agent=await seedToken("agent",uniq("dot"),{owner:account,channelScope:slug});
  const identity:TokenIdentity={name:agent.name,kind:"agent",role:"agent",hash:await sha256Hex(agent.token),owner:account,account,channel_scope:slug};
  return {account,human,slug,agent,identity};
}
async function mcp(identity:TokenIdentity,slug:string,method:string,params:unknown={},headers:Record<string,string>={}){
  return handleChannelMcp(new Request(`https://commons.test/api/channels/${slug}/mcp`,{
    method:"POST",headers:{"content-type":"application/json","mcp-protocol-version":"2026-07-28",...headers},
    body:JSON.stringify({jsonrpc:"2.0",id:5,method,params})}),slug,identity,noForward,env as never);
}
function verifyFixture(){
  fetchMock.get("https://events.chatgpt.test").intercept({path:"/dot/callback",method:"POST"}).reply(200,async req=>{
    const data=JSON.parse(req.body);
    expect(data).toMatchObject({type:"verification",challenge:expect.any(String)});
    expect(req.headers["webhook-signature"]).toBe(await signMcpWebhook(SECRET,req.headers["webhook-id"]!,req.headers["webhook-timestamp"]!,req.body));
    return {challenge:data.challenge};
  });
}
const subscribe=(slug:string,mentionOnly=true,secret=SECRET,url=CALLBACK)=>({
  name:"message.created",arguments:{channel_id:slug,mention_only:mentionOnly},
  delivery:{mode:"webhook",url,secret},ttlMs:86_400_000,cursor:null,
});
describe("MCP 2.0 dot event subscriptions and signed delivery",()=>{
  it("accepts ttlMs null and grants a bounded subscription expiry instead of failing task creation",async()=>{
    const {slug,identity}=await group();verifyFixture();const before=Date.now();
    const output=await(await mcp(identity,slug,"events/subscribe",{...subscribe(slug),ttlMs:null})).json() as any;
    expect(output.error).toBeUndefined();expect(output.result.id).toMatch(/^sub_/);
    const expiry=Date.parse(output.result.refreshBefore);
    expect(expiry).toBeGreaterThan(before+23*3600_000);expect(expiry).toBeLessThanOrEqual(Date.now()+86_400_000);
  });
  it("reports unconfigured callback policy without attempting a callback or leaking destination/secret",async()=>{
    const {slug,identity}=await group();const runtime={...env,COLLABORATION_EVENTS_ALLOWED_ORIGINS:"[]"};
    expect(mcpEventReadiness(runtime as never)).toEqual({callback_policy_configured:false});
    const output=await(await handleChannelMcp(rpc("events/subscribe",subscribe(slug)),slug,identity,noForward,runtime as never)).json() as any;
    expect(output.error).toMatchObject({code:-32015,message:"callback_origin_not_approved",data:{reason:"callback_origin_not_approved"}});
    expect(JSON.stringify(output)).not.toContain(SECRET);expect(JSON.stringify(output)).not.toContain(CALLBACK);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM mcp_event_subscriptions WHERE channel_slug=?").bind(slug).first()).toEqual({n:0});
  });
  it("readiness is only a configuration boolean, never approval of an arbitrary callback",()=>{
    for(const value of [undefined,"[]","broken",JSON.stringify(["*"]),JSON.stringify(["http://example.test"])])
      expect(mcpEventReadiness({...env,COLLABORATION_EVENTS_ALLOWED_ORIGINS:value} as never)).toEqual({callback_policy_configured:false});
    expect(mcpEventReadiness({...env,COLLABORATION_EVENTS_ALLOWED_ORIGINS:JSON.stringify(["https://events.chatgpt.test"])} as never))
      .toEqual({callback_policy_configured:true});
  });

  it("negotiates 2.0 events without changing the existing 2025 tools contract",async()=>{
    const {slug,identity}=await group();
    const d=await(await mcp(identity,slug,"server/discover")).json() as any;
    expect(d.result).toMatchObject({resultType:"complete",supportedVersions:["2026-07-28"],capabilities:{events:{}}});
    const e=await(await mcp(identity,slug,"events/list")).json() as any;
    expect(e.result.events[0].name).toBe("message.created");
    const init=await(await mcp(identity,slug,"initialize",{protocolVersion:"2026-07-28",clientInfo:{name:"dot",version:"1"},capabilities:{}})).json() as any;
    expect(init.result.protocolVersion).toBe("2026-07-28");
    expect(init.result.capabilities.events).toEqual({});
    const legacy=new Request(rpc("ping",{}),{headers:{"content-type":"application/json","mcp-protocol-version":"2025-06-18"}});
    const old=await handleChannelMcp(legacy,slug,identity,noForward);
    expect((await old.json() as any).result).toEqual({});
  });
  it("rejects non-approved callbacks, bad secrets and uncorrelated group filters before storing anything",async()=>{
    const {slug,identity}=await group();
    for (const url of ["http://events.chatgpt.test/dot/callback","https://127.0.0.1/cb",
      "https://evil.test/cb","https://events.chatgpt.test.evil.com/cb","https://events.chatgpt.test:9999/cb"]) {
      const r=await(await mcp(identity,slug,"events/subscribe",subscribe(slug,true,SECRET,url))).json() as any;
      expect(r.error.code).toBe(r.error.data?.reason==="callback_origin_not_approved"?-32015:-32602);
    }
    const wrong=await(await mcp(identity,slug,"events/subscribe",subscribe("another-group"))).json() as any;
    expect(wrong.error.code).toBe(-32602);
    const bad=await(await mcp(identity,slug,"events/subscribe",subscribe(slug,true,"whsec_invalid"))).json() as any;
    expect(bad.error.code).toBe(-32602);
    const row=await env.DB.prepare("SELECT COUNT(*) AS n FROM mcp_event_subscriptions WHERE channel_slug=?").bind(slug).first<{n:number}>();
    expect(row?.n).toBe(0);
  });
  it("verifies callbacks, saves encrypted subscription and emits a signed message reference only once",async()=>{
    const {slug,identity,human,agent}=await group();
    verifyFixture();
    const r=await(await mcp(identity,slug,"events/subscribe",subscribe(slug))).json() as any;
    expect(r.result).toMatchObject({id:expect.stringMatching(/^sub_/),cursor:null,truncated:false});
    const subid=r.result.id as string;
    const stored=await env.DB.prepare("SELECT * FROM mcp_event_subscriptions WHERE id=?").bind(subid).first() as any;
    expect(stored).toMatchObject({channel_slug:slug,agent_name:agent.name,revoked_at:null});
    expect(JSON.stringify(stored)).not.toContain(CALLBACK);
    expect(JSON.stringify(stored)).not.toContain(SECRET);
    fetchMock.get("https://events.chatgpt.test").intercept({path:"/dot/callback",method:"POST"}).reply(200,async req=>{
      const data=JSON.parse(req.body);
      expect(data.name).toBe("message.created");
      expect(data.data).toMatchObject({channel_id:slug,sender_name:human.name,message_seq:101 /* overwritten below */});
      return {};
    });
    // Run the durable event queue directly with a synthetic message reference to
    // avoid depending on DO background timing in this row ownership check.
    await enqueueMcpEvent(env as never,{slug,seq:101,sender:human.name,mentions:[agent.name]});
    await enqueueMcpEvent(env as never,{slug,seq:101,sender:human.name,mentions:[agent.name]});
    const pending=await env.DB.prepare("SELECT COUNT(*) AS n FROM mcp_event_outbox WHERE subscription_id=?").bind(subid).first<{n:number}>();
    expect(pending?.n).toBe(1);
    const delivered=await deliverMcpEvents(env as never,slug);
    expect(delivered).toEqual({attempted:1,delivered:1});
    expect(await deliverMcpEvents(env as never,slug)).toEqual({attempted:0,delivered:0});
    const eventRow=await env.DB.prepare("SELECT state FROM mcp_event_outbox WHERE subscription_id=?").bind(subid).first();
    expect(eventRow).toEqual({state:"delivered"});
  });
  it("keeps sender isolation, revocation, mention-only filters and unsubscribes idempotently",async()=>{
    const {slug,identity,human,agent}=await group();
    verifyFixture();
    expect((await mcp(identity,slug,"events/subscribe",subscribe(slug))).status).toBe(200);
    expect(await enqueueMcpEvent(env as never,{slug,seq:1,sender:human.name,mentions:[]})).toBe(0);
    expect(await enqueueMcpEvent(env as never,{slug,seq:2,sender:agent.name,mentions:[agent.name]})).toBe(0);
    const unsub=await mcp(identity,slug,"events/unsubscribe",{...subscribe(slug),delivery:{mode:"webhook",url:CALLBACK}});
    expect((await unsub.json() as any).result).toEqual({resultType:"complete"});
    expect(await enqueueMcpEvent(env as never,{slug,seq:3,sender:human.name,mentions:[agent.name]})).toBe(0);
    await mcp(identity,slug,"events/unsubscribe",{...subscribe(slug),delivery:{mode:"webhook",url:CALLBACK}});
  });
  it("does not mark a webhook delivered on a 503; defers its retry with the same event ID",async()=>{
    const {slug,identity,human,agent}=await group();
    verifyFixture();
    await mcp(identity,slug,"events/subscribe",subscribe(slug));
    const eventIds:string[]=[];
    fetchMock.get("https://events.chatgpt.test").intercept({path:"/dot/callback",method:"POST"}).reply(503,req=>{
      eventIds.push(req.headers["webhook-id"]!);return {error:"temporary"};
    });
    await enqueueMcpEvent(env as never,{slug,seq:1010,sender:human.name,mentions:[agent.name]});
    expect(await deliverMcpEvents(env as never,slug)).toEqual({attempted:1,delivered:0});
    expect(await deliverMcpEvents(env as never,slug)).toEqual({attempted:0,delivered:0});
    expect(eventIds).toHaveLength(1);
    expect(await env.DB.prepare("SELECT state,attempts FROM mcp_event_outbox WHERE channel_slug=?")
      .bind(slug).first()).toEqual({state:"pending",attempts:1});
  });

  it("uses the actual channel REST and WebSocket commit path for automatic mention wakeups",async()=>{
    const {slug,identity,human,agent}=await group();
    verifyFixture();
    await mcp(identity,slug,"events/subscribe",subscribe(slug));
    const bodySamples:number[]=[];
    fetchMock.get("https://events.chatgpt.test").intercept({path:"/dot/callback",method:"POST"}).reply(200,req=>{
      const data=JSON.parse(req.body);
      bodySamples.push(data.data.message_seq);
      expect(data.data.channel_id).toBe(slug);
      expect(data.data.sender_name).toBe(human.name);
      return {acknowledged:true};
    }).times(2);
    const first=await api(`/api/channels/${slug}/messages`,human.token,{
      method:"POST",body:JSON.stringify({kind:"message",body:"@dot take a look",mentions:[agent.name],reply_to:null}),
    });
    expect(first.status).toBe(200);
    const firstSeq=(await first.json() as {seq:number}).seq;
    const ws=await WsClient.open(slug,human.token);
    try {
      await completeCapabilityHello(ws);
      ws.send({type:"send",kind:"message",body:"@dot review this too",mentions:[agent.name],reply_to:null,idempotency_key:uniq("ws")});
      const sent=await ws.nextOfType("sent");
      expect(sent.seq).toBeGreaterThan(firstSeq);
      for(let i=0;i<40&&bodySamples.length<2;i++) await new Promise(resolve=>setTimeout(resolve,50));
      expect(bodySamples.sort((a,b)=>a-b)).toEqual([firstSeq,sent.seq]);
      const saved=await env.DB.prepare("SELECT COUNT(*) AS n FROM mcp_event_outbox WHERE channel_slug=? AND state='delivered'")
        .bind(slug).first<{n:number}>();
      expect(saved?.n).toBe(2);
    } finally {ws.close();}
  });
});
