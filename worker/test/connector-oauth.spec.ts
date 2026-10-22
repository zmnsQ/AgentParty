import {env,SELF,createExecutionContext,waitOnExecutionContext} from "cloudflare:test";
import {describe,expect,it} from "vitest";
import worker, {type AppEnv} from "../src/index";
import {createChannel,seedToken,uniq} from "./helpers";
import {sha256Hex} from "../src/auth";
import {enableMcpFixture} from "./mcp-test-helpers";
const SITE="https://commons.test";
const CALLBACK="https://chatgpt.com/connector_platform_oauth_redirect";
async function req(path:string,init:RequestInit={}){
  return SELF.fetch("http://commons.test"+path,{redirect:"manual",...init});
}
async function register(redirect=CALLBACK){
  return req("/oauth/register",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({client_name:"ChatGPT dot",redirect_uris:[redirect],token_endpoint_auth_method:"none"})});
}
async function setup(){
  const ownerName=uniq("oauth-human"),account=uniq("oauth-account");
  const human=await seedToken("human",ownerName,{owner:account});
  const slug=await createChannel(human.token),cookie=crypto.randomUUID().replaceAll("-","").repeat(2),sessionId=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO browser_account_security(account,github_id,login,enabled,version,last_step,updated_at) VALUES(?,?,?,0,0,-1,?)")
    .bind(account,uniq("github-id"),"test-account",Date.now()).run();
  await env.DB.prepare("INSERT INTO browser_sessions(id,cookie_hash,account,stage,auth_version,created_at,expires_at) VALUES(?,?,?,'ready',0,?,?)")
    .bind(sessionId,await sha256Hex(cookie),account,Date.now(),Date.now()+86_400_000).run();
  await enableMcpFixture(slug,account);
  const r=await register();expect(r.status).toBe(201);
  const clientId=(await r.json() as {client_id:string}).client_id;
  const resource=`${SITE}/api/channels/${slug}/mcp`;
  const verifier="v".repeat(48);
  const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier)));
  const challenge=btoa(String.fromCharCode(...hash)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  return {account,human,slug,cookie:"__Host-ap_session="+cookie,clientId,resource,verifier,challenge};
}
function matchHidden(html:string,key:string){
  const m=html.match(new RegExp('name="'+key+'" value="([^"]+)"'));expect(m).toBeTruthy();return m![1]!;
}
async function consent(c:Awaited<ReturnType<typeof setup>>,scope="group.read group.write group.events"){
  const qs=new URLSearchParams({client_id:c.clientId,redirect_uri:CALLBACK,response_type:"code",
    code_challenge:c.challenge,code_challenge_method:"S256",state:"oauth-test",scope,resource:c.resource});
  const path="/oauth/authorize?"+qs;
  const r=await req(path,{headers:{cookie:c.cookie}});
  expect(r.status).toBe(200);
  const html=await r.text();
  const body=new URLSearchParams({request_id:matchHidden(html,"request_id"),nonce:matchHidden(html,"nonce"),decision:"approve"});
  const approved=await req("/oauth/authorize",{method:"POST",headers:{origin:SITE,
    "sec-fetch-site":"same-origin",cookie:c.cookie,"content-type":"application/x-www-form-urlencoded"},body:body.toString()});
  expect(approved.status).toBe(302);
  const location=new URL(approved.headers.get("location")!);
  expect(location.origin).toBe("https://chatgpt.com");
  expect(location.searchParams.get("iss")).toBe(SITE);
  return {code:location.searchParams.get("code")!,html,body};
}
async function exchange(c:Awaited<ReturnType<typeof setup>>,code:string,verifier=c.verifier){
  return req("/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({grant_type:"authorization_code",client_id:c.clientId,code,
      redirect_uri:CALLBACK,code_verifier:verifier,resource:c.resource}).toString()});
}
describe("ChatGPT MCP OAuth 2.1 and scoped group consent",()=>{
  it("routes OAuth well-known and consent paths to the Worker even when SPA assets return HTTP 200",async()=>{
    const assets={
      fetch:async()=>new Response("<html>SPA fallback</html>",{
        status:200,headers:{"content-type":"text/html;charset=utf-8"}
      })
    };
    const serverEnv={...env,AUTH_PUBLIC_ORIGIN:SITE,ASSETS:assets} as unknown as AppEnv;
    const invoke=async(path:string)=>{
      const ctx=createExecutionContext();
      const response=await worker.fetch(new Request("http://commons.test"+path),serverEnv,ctx);
      await waitOnExecutionContext(ctx);
      return response;
    };
    const metadata=await invoke("/.well-known/oauth-authorization-server");
    expect(metadata.status).toBe(200);
    expect(metadata.headers.get("content-type")).toContain("application/json");
    expect(await metadata.json()).toMatchObject({issuer:SITE,token_endpoint:SITE+"/oauth/token"});
    const protectedResource=await invoke("/.well-known/oauth-protected-resource/api/channels/demo/mcp");
    expect(await protectedResource.json()).toMatchObject({
      resource:SITE+"/api/channels/demo/mcp",authorization_servers:[SITE]
    });
    const grants=await invoke("/oauth/grants");
    expect(grants.status).toBe(401);
    expect(await grants.json()).toMatchObject({error:"login_required"});
    const webpage=await invoke("/auth/setup");
    expect(webpage.headers.get("content-type")).toContain("text/html");
    expect(await webpage.text()).toContain("SPA fallback");
  });
  it.each([
    { header: "en-US,en;q=0.9", mark: "Current project author:", upstream: "originally created by" },
    { header: "zh-CN,zh;q=0.9", mark: "现项目作者：", upstream: "原作者：郭立" },
  ])("identifies zmnsQ and upstream AgentParty on localized OAuth consent: $header",async({header,mark,upstream})=>{
    const c=await setup();
    const qs=new URLSearchParams({client_id:c.clientId,redirect_uri:CALLBACK,response_type:"code",
      code_challenge:c.challenge,code_challenge_method:"S256",state:"author-credit",
      scope:"group.read",resource:c.resource});
    const result=await req("/oauth/authorize?"+qs,{headers:{cookie:c.cookie,"accept-language":header}});
    expect(result.status).toBe(200);
    const body=await result.text();
    expect(result.headers.get("content-security-policy")).toContain("style-src 'self'");
    expect(result.headers.get("content-security-policy")).not.toContain("unsafe-inline");
    expect(body).toContain('href="/commons-consent.css"');
    expect(body).toContain(mark);
    expect(body).toContain(upstream);
    expect(body).toContain('href="https://github.com/zmnsQ"');
    expect(body).toContain('href="https://github.com/leeguooooo/AgentParty"');
    expect(body).toContain('href="https://github.com/leeguooooo/AgentParty/blob/main/LICENSE"');
    expect(body).toContain("zmnsQ");
    expect(body).toContain("BUSL-1.1");
  });
  it("keeps the real Origin on native consent form POSTs without leaking referrers cross-site",async()=>{
    const c=await setup();
    const query=new URLSearchParams({client_id:c.clientId,redirect_uri:CALLBACK,response_type:"code",
      code_challenge:c.challenge,code_challenge_method:"S256",state:"native-form-origin",
      scope:"group.read",resource:c.resource});
    const response=await req("/oauth/authorize?"+query,{headers:{cookie:c.cookie}});
    expect(response.status).toBe(200);
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    const body=await response.text();
    expect(body).toContain('<meta name="referrer" content="same-origin">');
    expect(body).not.toContain('<meta name="referrer" content="no-referrer">');
    expect(response.headers.get("content-security-policy")).toContain("form-action 'self'");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(body).toContain('<form method="POST" action="/oauth/authorize">');
    const form=new URLSearchParams({request_id:matchHidden(body,"request_id"),nonce:matchHidden(body,"nonce"),decision:"approve"});
    const allowed=await req("/oauth/authorize",{method:"POST",headers:{origin:SITE,cookie:c.cookie,
      "sec-fetch-site":"same-origin","content-type":"application/x-www-form-urlencoded"},body:form.toString()});
    expect(allowed.status).toBe(302);
    // The cross-site callback keeps no-referrer: codes/state stay out of Referer.
    expect(allowed.headers.get("referrer-policy")).toBe("no-referrer");
    const callback=new URL(allowed.headers.get("location")!);
    expect(callback.origin).toBe("https://chatgpt.com");
    expect(callback.searchParams.get("state")).toBe("native-form-origin");
    expect(callback.searchParams.get("iss")).toBe(SITE);
    expect((await exchange(c,callback.searchParams.get("code")!)).status).toBe(200);
  });

  it.each([
    {label:"opaque null origin",origin:"null",site:"same-origin"},
    {label:"missing origin",origin:undefined,site:"same-origin"},
    {label:"foreign origin",origin:"https://attacker.test",site:"same-origin"},
    {label:"foreign origin with forged forwarded proto",origin:"https://attacker.test",site:"none"},
    {label:"cross-site metadata",origin:SITE,site:"cross-site"},
    {label:"lookalike subdomain",origin:"https://commons.test.attacker.test",site:"same-site"},
  ])("still rejects $label without consuming a legitimate one-time consent",async({origin,site})=>{
    const c=await setup();
    const query=new URLSearchParams({client_id:c.clientId,redirect_uri:CALLBACK,response_type:"code",
      code_challenge:c.challenge,code_challenge_method:"S256",state:"csrf-still-enforced",
      scope:"group.read",resource:c.resource});
    const page=await req("/oauth/authorize?"+query,{headers:{cookie:c.cookie}});
    expect(page.status).toBe(200);
    const html=await page.text();
    const form=new URLSearchParams({request_id:matchHidden(html,"request_id"),nonce:matchHidden(html,"nonce"),decision:"approve"});
    const headers:Record<string,string>={cookie:c.cookie,"content-type":"application/x-www-form-urlencoded",
      "sec-fetch-site":site,"x-forwarded-proto":"https","x-forwarded-host":"commons.test"};
    if(origin!==undefined)headers.origin=origin;
    const rejected=await req("/oauth/authorize",{method:"POST",headers,body:form.toString()});
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toMatchObject({error:"invalid_origin"});
    // Rejection precedes consuming a pending request. A new same-origin form POST
    // with the original session-bound nonce still succeeds, exactly once.
    const validHeaders={cookie:c.cookie,origin:SITE,"sec-fetch-site":"same-origin",
      "content-type":"application/x-www-form-urlencoded"};
    const approved=await req("/oauth/authorize",{method:"POST",headers:validHeaders,body:form.toString()});
    expect(approved.status).toBe(302);
    const replay=await req("/oauth/authorize",{method:"POST",headers:validHeaders,body:form.toString()});
    expect(replay.status).toBe(403);
    expect(await replay.json()).toMatchObject({error:"invalid_or_expired_consent"});
  });

  it("advertises discovery and rejects untrusted redirect clients",async()=>{
    const c=await setup();
    const doc=await(await req("/.well-known/oauth-authorization-server")).json() as any;
    expect(doc).toMatchObject({issuer:SITE,registration_endpoint:SITE+"/oauth/register",
      authorization_response_iss_parameter_supported:true,code_challenge_methods_supported:["S256"]});
    const meta=await(await req("/.well-known/oauth-protected-resource/api/channels/"+c.slug+"/mcp")).json() as any;
    expect(meta.resource).toBe(c.resource);
    const anon=await req("/api/channels/"+c.slug+"/mcp",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list"})});
    expect(anon.status).toBe(401);
    expect(anon.headers.get("www-authenticate")).toContain("oauth-protected-resource");
    for(const redirect of ["https://evil.test/callback","https://chatgpt.com.evil/callback",
      "http://chatgpt.com/connector_platform_oauth_redirect","https://chatgpt.com/wrong"])
      expect((await register(redirect)).status).toBe(400);
  });
  it("requires login, explicit one-time consent and S256 PKCE before issuing any agent token",async()=>{
    const c=await setup();
    const qs=new URLSearchParams({client_id:c.clientId,redirect_uri:CALLBACK,response_type:"code",
      code_challenge:c.challenge,code_challenge_method:"S256",state:"oauth-state",scope:"group.read",resource:c.resource});
    const r=await req("/oauth/authorize?"+qs);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toContain("/api/auth/github/start");
    const authorized=await consent(c);
    expect(authorized.html).toContain(c.slug);
    expect(authorized.html).toContain("AgentParty");
    expect((await req("/oauth/authorize",{method:"POST",
      headers:{origin:SITE,cookie:c.cookie,"content-type":"application/x-www-form-urlencoded"},
      body:authorized.body.toString()})).status).toBe(403);
    expect((await exchange(c,authorized.code,"bad".repeat(15))).status).toBe(400);
  });
  it("issues and rotates one group token for official tools, with old credentials revoked",async()=>{
    const c=await setup(),{code}=await consent(c);
    const first=await exchange(c,code);expect(first.status).toBe(200);
    const tokens=await first.json() as {access_token:string;refresh_token:string};
    expect(tokens.access_token).toMatch(/^ap_/);
    expect((await exchange(c,code)).status).toBe(400);
    const profile=async(token:string)=>req("/api/channels/"+c.slug+"/mcp",{method:"POST",
      headers:{"content-type":"application/json",authorization:"Bearer "+token,
        "mcp-protocol-version":"2026-07-28"},
      body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list"})});
    expect((await profile(tokens.access_token)).status).toBe(200);
    const refresh=async(token:string)=>req("/oauth/token",{method:"POST",
      headers:{"content-type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({grant_type:"refresh_token",client_id:c.clientId,
        refresh_token:token,resource:c.resource}).toString()});
    const second=await refresh(tokens.refresh_token);expect(second.status).toBe(200);
    const newer=await second.json() as {access_token:string;refresh_token:string};
    expect((await refresh(tokens.refresh_token)).status).toBe(400);
    expect((await profile(tokens.access_token)).status).toBe(401);
    expect((await profile(newer.access_token)).status).toBe(200);
  });
  it("enforces read-only vs write and events authorization at the MCP boundary",async()=>{
    const c=await setup();
    const {code}=await consent(c,"group.read");
    const result=await exchange(c,code);expect(result.status).toBe(200);
    const {access_token}=await result.json() as {access_token:string};
    const call=(method:string,params:Record<string,unknown>)=>req("/api/channels/"+c.slug+"/mcp",{
      method:"POST",headers:{"content-type":"application/json","mcp-protocol-version":"2026-07-28",
        authorization:"Bearer "+access_token},
      body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),
    });
    expect((await call("tools/list",{})).status).toBe(200);
    expect((await call("tools/call",{name:"party_send_message",arguments:{body:"Unauthorized",idempotency_key:"test"}})).status).toBe(403);
    expect((await call("events/subscribe",{name:"message.created"})).status).toBe(403);
    const direct=await req("/api/channels/"+c.slug+"/bridges/grok-automation",{method:"POST",
      headers:{authorization:"Bearer "+access_token,"content-type":"application/json"},
      body:JSON.stringify({request_id:"test-direct",prompt:"Privileged action"})});
    expect(direct.status).toBe(403);
    // MCP OAuth credentials cannot call unrelated account-wide REST endpoints.
    expect((await req("/api/me",{headers:{authorization:"Bearer "+access_token}})).status).toBe(403);
  });
  it("lists only an owner's connector grants and revokes both access and refresh credentials",async()=>{
    const c=await setup(),{code}=await consent(c);
    const result=await exchange(c,code);expect(result.status).toBe(200);
    const tokens=await result.json() as {access_token:string;refresh_token:string};
    const grants=await req("/oauth/grants",{headers:{cookie:c.cookie}});
    expect(grants.status).toBe(200);
    const data=await grants.json() as {connections:Array<{id:string;group:string;client_name:string}>};
    expect(data.connections).toHaveLength(1);
    expect(data.connections[0]!.group).toBe(c.slug);
    expect(data.connections[0]!.client_name).toBe("ChatGPT dot");
    const id=data.connections[0]!.id;
    const revoke=await req("/oauth/grants/revoke",{method:"POST",headers:{
      origin:SITE,cookie:c.cookie,"sec-fetch-site":"same-origin",
      "content-type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({grant_id:id}).toString()});
    expect(revoke.status).toBe(200);
    expect((await revoke.json() as {revoked:boolean}).revoked).toBe(true);
    const after=await req("/oauth/grants",{headers:{cookie:c.cookie}});
    expect((await after.json() as any).connections).toHaveLength(0);
    const again=await req("/oauth/token",{method:"POST",headers:{
      "content-type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({grant_type:"refresh_token",client_id:c.clientId,
        refresh_token:tokens.refresh_token,resource:c.resource}).toString()});
    expect(again.status).toBe(400);
    expect((await req("/api/channels/"+c.slug+"/mcp",{method:"POST",
      headers:{authorization:"Bearer "+tokens.access_token,
        "content-type":"application/json"},
      body:JSON.stringify({jsonrpc:"2.0",id:5,method:"tools/list"})})).status).toBe(401);
  });
  it("reduces an overbroad OAuth request to the group owner's read-only policy",async()=>{
    const c=await setup();
    await env.DB.prepare("UPDATE channel_mcp_security SET allow_write=0,allow_events=0 WHERE channel_slug=?").bind(c.slug).run();
    const {code,html}=await consent(c);
    expect(html).not.toContain("Post messages and work results");
    const response=await exchange(c,code);expect(response.status).toBe(200);
    const body=await response.json() as {scope:string;access_token:string};
    expect(body.scope).toBe("group.read");
    const direct=await req(`/api/channels/${c.slug}/messages`,{method:"POST",
      headers:{authorization:"Bearer "+body.access_token,"content-type":"application/json"},
      body:JSON.stringify({kind:"message",body:"not allowed",mentions:[],reply_to:null})});
    expect(direct.status).toBe(403);
  });
  it("closed group policy blocks live OAuth REST access and refresh, not only the MCP URL",async()=>{
    const c=await setup(),{code}=await consent(c);
    const issued=await exchange(c,code);expect(issued.status).toBe(200);
    const creds=await issued.json() as {access_token:string;refresh_token:string};
    await env.DB.prepare("UPDATE channel_mcp_security SET enabled=0 WHERE channel_slug=?").bind(c.slug).run();
    const read=await req(`/api/channels/${c.slug}/messages`,{headers:{authorization:"Bearer "+creds.access_token}});
    expect(read.status).toBe(403);
    const refresh=await req("/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({grant_type:"refresh_token",client_id:c.clientId,resource:c.resource,refresh_token:creds.refresh_token}).toString()});
    expect(refresh.status).toBe(400);
  });

});
