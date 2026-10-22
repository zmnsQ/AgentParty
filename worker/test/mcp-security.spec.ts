import {env,SELF} from "cloudflare:test";
import {describe,expect,it} from "vitest";
import {api,createChannel,seedToken,uniq,postMessage} from "./helpers";
import {enableMcpFixture,browserOwnerFixture} from "./mcp-test-helpers";
import {sha256Hex} from "../src/auth";
const rpc=(name="party_read_messages",args:Record<string,unknown>={})=>({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}});
const headers={"content-type":"application/json"};
async function fixture(){
  const account=uniq("security-owner");
  const owner=await seedToken("human",uniq("owner"),{owner:account});
  const slug=await createChannel(owner.token);
  const agent=await seedToken("agent",uniq("reader"),{owner:account,channelScope:slug});
  const mcp=`/api/channels/${slug}/mcp`,policy=`/api/channels/${slug}/mcp-security`;
  return {account,owner,slug,agent,mcp,policy};
}
const invoke=(path:string,token:string,body:unknown=rpc())=>api(path,token,{method:"POST",body:JSON.stringify(body)});
describe("MCP is not a secret-URL authorization scheme",()=>{
  it("knowing a REAL group ID, a query-string token, or forged bearer never authorizes reads or writes",async()=>{
    const f=await fixture();await enableMcpFixture(f.slug,f.account);
    await postMessage(f.slug,f.owner.token,"PRIVATE-CANARY-DO-NOT-LEAK");
    for(const target of [f.mcp,`${f.mcp}?token=${f.agent.token}`,`${f.mcp}?t=${f.agent.token}`]){
      const response=await SELF.fetch("http://ap.test"+target,{method:"POST",headers,body:JSON.stringify(rpc())});
      expect(response.status).toBe(401);expect(await response.text()).not.toContain("PRIVATE-CANARY");
    }
    const fake=await invoke(f.mcp,"ap_"+"0".repeat(64),rpc("party_send_message",{body:"BAD",idempotency_key:"unauth"}));
    expect(fake.status).toBe(401);
    expect((await SELF.fetch("http://ap.test/api/channels/"+f.slug+"/messages")).status).toBe(401);
    const anon=await SELF.fetch("http://ap.test"+f.mcp,{method:"POST",headers,body:JSON.stringify(rpc())});
    expect(anon.headers.get("www-authenticate")).toContain("resource_metadata");
  });
  it("rejects human tokens, unscoped tokens, other-group tokens, and revoked tokens",async()=>{
    const f=await fixture();await enableMcpFixture(f.slug,f.account);
    const broad=await seedToken("agent",uniq("broad"),{owner:f.account});
    const other=await seedToken("agent",uniq("other"),{owner:f.account,channelScope:"different-room"});
    for(const token of [f.owner.token,broad.token,other.token])expect((await invoke(f.mcp,token)).status).toBe(403);
    await env.DB.prepare("UPDATE tokens SET revoked_at=? WHERE hash=?").bind(Date.now(),await sha256Hex(f.agent.token)).run();
    expect((await invoke(f.mcp,f.agent.token)).status).toBe(401);
  });
  it("defaults closed and requires a real version-current MFA browser owner session to enable",async()=>{
    const f=await fixture();
    const status=await api(f.policy,f.owner.token);expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({policy:{enabled:false,allow_write:false,allow_events:false,require_mfa:true}});
    expect((await invoke(f.mcp,f.agent.token)).status).toBe(403);
    const data={enabled:true,allow_write:false,allow_events:false};
    expect((await api(f.policy,f.owner.token,{method:"PUT",body:JSON.stringify(data)})).status).toBe(403);
    const unverified=await browserOwnerFixture(f.account,false);
    const denied=await api(f.policy,unverified,{method:"PUT",body:JSON.stringify(data)});
    expect(denied.status).toBe(403);expect(await denied.json()).toMatchObject({error:{code:"mfa_required"}});
    const verified=await browserOwnerFixture(f.account,true);
    const allowed=await api(f.policy,verified,{method:"PUT",body:JSON.stringify(data)});
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({policy:{enabled:true,allow_write:false,owner_mfa_enabled:true}});
  });
  it("read-only access cannot send messages, upload files, propose code or subscribe to events",async()=>{
    const f=await fixture();await enableMcpFixture(f.slug,f.account,false,false);
    const read=await invoke(f.mcp,f.agent.token);expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({result:{isError:false}});
    const tools=await invoke(f.mcp,f.agent.token,{jsonrpc:"2.0",id:2,method:"tools/list"});
    const listing=await tools.json() as {result:{tools:Array<{name:string}>}};
    expect(listing.result.tools.some(t=>t.name==="party_read_messages")).toBe(true);
    expect(listing.result.tools.some(t=>t.name==="party_send_message")).toBe(false);
    for(const name of ["party_send_message","party_upload_file","party_propose_changes"])
      expect((await invoke(f.mcp,f.agent.token,rpc(name,{}))).status).toBe(403);
    const events=await invoke(f.mcp,f.agent.token,{jsonrpc:"2.0",id:1,method:"events/subscribe",params:{name:"message.created"}});
    expect(events.status).toBe(403);
  });
  it("changing the room ID cannot cross-read another private or public group",async()=>{
    const f=await fixture();await enableMcpFixture(f.slug,f.account);
    const other=await createChannel(f.owner.token);await enableMcpFixture(other,f.account);
    await env.DB.prepare("UPDATE channels SET visibility='public' WHERE slug=?").bind(other).run();
    const response=await invoke(`/api/channels/${other}/mcp`,f.agent.token);
    expect(response.status).toBe(403);
    expect((await api(`/api/channels/${other}/messages`,f.agent.token)).status).toBe(403);
  });
  it("MCP cannot change access policy, and disabling MCP blocks existing credentials",async()=>{
    const f=await fixture();await enableMcpFixture(f.slug,f.account);
    expect((await api(f.policy,f.agent.token,{method:"PUT",body:JSON.stringify({enabled:true,allow_write:true,allow_events:true})})).status).toBe(403);
    const browser=await browserOwnerFixture(f.account,true);
    expect((await invoke(f.mcp,f.agent.token,rpc("party_profile"))).status).toBe(200);
    const off=await api(f.policy,browser,{method:"PUT",body:JSON.stringify({enabled:false,allow_write:false,allow_events:false})});
    expect(off.status).toBe(200);
    expect((await invoke(f.mcp,f.agent.token,rpc("party_profile"))).status).toBe(403);
  });
  it("turning off the owner's MFA invalidates MCP access even while old tokens are unexpired",async()=>{
    const f=await fixture();await enableMcpFixture(f.slug,f.account);
    await env.DB.prepare("UPDATE browser_account_security SET enabled=0 WHERE account=?").bind(f.account).run();
    expect((await invoke(f.mcp,f.agent.token)).status).toBe(403);
  });
  it("bounds repeated authenticated calls per credential",async()=>{
    const f=await fixture();await enableMcpFixture(f.slug,f.account);
    await env.DB.prepare("INSERT INTO browser_auth_limits(key,window_at,attempts) VALUES(?,?,120)")
      .bind("mcp:"+await sha256Hex(f.agent.token),Date.now()).run();
    expect((await invoke(f.mcp,f.agent.token,rpc("party_profile"))).status).toBe(429);
  });
});
