import {env,SELF} from "cloudflare:test";
import {describe,it,expect} from "vitest";
import {createChannel,seedToken,uniq} from "./helpers";
import {enableMcpFixture,browserOwnerFixture} from "./mcp-test-helpers";
import {sha256Hex} from "../src/auth";
import {MUSE_NATIVE_REDIRECT} from "../src/collaboration/muse-native";
const SITE="https://commons.test",CALLBACK=MUSE_NATIVE_REDIRECT;
let ip=100;
const req=(path:string,init:RequestInit={})=>SELF.fetch("http://commons.test"+path,{redirect:"manual",...init});
async function register(redirect=CALLBACK,method="none"){
 return req("/oauth/register",{method:"POST",headers:{"content-type":"application/json","cf-connecting-ip":`198.51.100.${++ip}`},body:JSON.stringify({client_name:"Muse native QA",redirect_uris:[redirect],token_endpoint_auth_method:method})});
}
async function setup(){
 const account=uniq("muse-native-account"),human=await seedToken("human",uniq("muse-native-human"),{owner:account});
 const slug=await createChannel(human.token),raw=crypto.randomUUID().replaceAll("-","").repeat(2);
 await env.DB.prepare("INSERT INTO browser_account_security(account,github_id,login,enabled,version,last_step,updated_at) VALUES(?,?,?,0,0,-1,?)").bind(account,uniq("github"),"muse-qa",Date.now()).run();
 await env.DB.prepare("INSERT INTO browser_sessions(id,cookie_hash,account,stage,auth_version,created_at,expires_at) VALUES(?,?,?,'ready',0,?,?)").bind(crypto.randomUUID(),await sha256Hex(raw),account,Date.now(),Date.now()+3600000).run();
 await enableMcpFixture(slug,account);
 const browserAccess=await browserOwnerFixture(account,true);
 const registered=await register();expect(registered.status).toBe(201);
 const client=(await registered.json() as {client_id:string}).client_id;
 const verifier="v".repeat(48),hash=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier)));
 const challenge=btoa(String.fromCharCode(...hash)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
 const params=new URLSearchParams({client_id:client,redirect_uri:CALLBACK,response_type:"code",scope:"mcp:read mcp:write",state:"eyJtc2ciOiJxdW90ZSJ9+opaque/state=",code_challenge:challenge,code_challenge_method:"S256"});
 return {account,human,browserAccess,slug,client,verifier,params,cookie:"__Host-ap_session="+raw,resource:SITE+`/api/channels/${slug}/mcp`};
}
function hidden(html:string,key:string){const m=html.match(new RegExp(`name="${key}" value="([^"]+)"`));expect(m).toBeTruthy();return m![1]!;}
async function approve(c:Awaited<ReturnType<typeof setup>>,client=c.client){
 const params=new URLSearchParams(c.params);params.set("resource",c.resource);params.set("client_id",client);
 const page=await req("/oauth/authorize?"+params,{headers:{cookie:c.cookie}});expect(page.status).toBe(200);
 const html=await page.text();expect(html).toContain("group.read");expect(html).not.toContain('value="'+c.verifier+'"');
 const body=new URLSearchParams({request_id:hidden(html,"request_id"),nonce:hidden(html,"nonce"),decision:"approve"});
 const response=await req("/oauth/authorize",{method:"POST",headers:{cookie:c.cookie,origin:SITE,"sec-fetch-site":"same-origin","content-type":"application/x-www-form-urlencoded"},body:body.toString()});
 expect(response.status).toBe(302);const url=new URL(response.headers.get("location")!);expect(url.origin).toBe("https://agent.meta.ai");expect(url.pathname).toBe("/api/hatch/oauth/callback");expect(url.searchParams.get("state")).toBe(c.params.get("state"));
 return url.searchParams.get("code")!;
}
const exchange=(client:string,code:string,verifier:string,resource?:string)=>req("/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",client_id:client,code,redirect_uri:CALLBACK,code_verifier:verifier,...(resource===undefined?{}:{resource})}).toString()});
describe("Muse native MCP compatibility retains scoped consent",()=>{
 it("accepts the exact native callback and reports unsupported authentication accurately",async()=>{
  expect((await register()).status).toBe(201);
  const bad=await register(CALLBACK,"client_secret_post");expect(bad.status).toBe(400);expect(await bad.json()).toEqual({error:"invalid_client_metadata"});
 });
 it.each(["https://agent.meta.ai.evil.test/api/hatch/oauth/callback","https://evil.test/api/hatch/oauth/callback","https://agent.meta.ai/other","https://agent.meta.ai/api/hatch/oauth/callback?next=https://evil.test","https://agent.meta.ai/api/hatch/oauth/callback#fragment","http://agent.meta.ai/api/hatch/oauth/callback","https://agent.meta.ai@evil.test/api/hatch/oauth/callback"])("rejects callback substitution %s",async url=>{expect((await register(url)).status).toBe(400);});
 it("missing resource offers only owned groups, grants nothing, and requires explicit consent",async()=>{
  const c=await setup();const page=await req("/oauth/authorize?"+c.params,{headers:{cookie:c.cookie}});expect(page.status).toBe(200);
  const html=await page.text();expect(html).toContain('name="resource"');expect(html).toContain(c.resource);expect(html).not.toContain('name="nonce"');
  const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM connector_oauth_grants WHERE client_id=?").bind(c.client).first<{n:number}>();expect(count?.n).toBe(0);
  const other=await seedToken("human",uniq("stranger"),{owner:uniq("stranger-account")}),otherSlug=await createChannel(other.token);
  const params=new URLSearchParams(c.params);params.set("resource",SITE+`/api/channels/${otherSlug}/mcp`);
  expect((await req("/oauth/authorize?"+params,{headers:{cookie:c.cookie}})).status).toBe(403);
 });
 it("complete native authorization, PKCE exchange without resource, read-only tool and refresh work",async()=>{
  const c=await setup(),code=await approve(c),response=await exchange(c.client,code,c.verifier);expect(response.status).toBe(200);
  const grant=await response.json() as {access_token:string;refresh_token:string;resource:string};expect(grant.resource).toBe(c.resource);
  const init=await req(`/api/channels/${c.slug}/mcp`,{method:"POST",headers:{authorization:`Bearer ${grant.access_token}`,"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"Muse QA",version:"1"}}})});
  expect(init.status).toBe(200);expect(await init.json()).toHaveProperty("result.protocolVersion");
  const refresh=await req("/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"refresh_token",client_id:c.client,refresh_token:grant.refresh_token}).toString()});expect(refresh.status).toBe(200);expect(await refresh.json()).toHaveProperty("resource",c.resource);
  const replay=await exchange(c.client,code,c.verifier);expect(replay.status).toBe(400);
 });
 it("wrong PKCE and explicit different audiences remain rejected",async()=>{
  const c=await setup(),code=await approve(c);expect((await exchange(c.client,code,"x".repeat(48))).status).toBe(400);
  const second=await approve(c);expect((await exchange(c.client,second,c.verifier,SITE+"/api/channels/wrong/mcp")).status).toBe(400);
  expect((await exchange(c.client,second,c.verifier)).status).toBe(200);
 });
 it("owner-prepared Client ID is public, group-bound, idempotent, and not an authorization",async()=>{
  const c=await setup(),path=`/api/channels/${c.slug}/bridges/muse/native-client`;
  const call=()=>req(path,{method:"POST",headers:{authorization:`Bearer ${c.browserAccess}`,"content-type":"application/json"},body:"{}"});
  const r=await call();expect(r.status).toBe(201);const native=await r.json() as {client_id:string};expect(native).not.toHaveProperty("client_secret");expect(native).toHaveProperty("authorized",false);
  expect(await (await call()).json()).toHaveProperty("client_id",native.client_id);
  const params=new URLSearchParams(c.params);params.set("client_id",native.client_id);
  const page=await req("/oauth/authorize?"+params,{headers:{cookie:c.cookie}});expect(page.status).toBe(200);expect(await page.text()).toContain('name="nonce"');
  const grant=await exchange(native.client_id,await approve(c,native.client_id),c.verifier);expect(grant.status).toBe(200);
  const state=await req(`/api/channels/${c.slug}/bridges/muse`,{headers:{authorization:`Bearer ${c.browserAccess}`}});expect(await state.json()).toMatchObject({native_client_id:native.client_id,native_authorized:true});
 });
});
