import type { Hono, Context } from "hono";
import type { AppContext, AppEnv } from "../index";
import type { TokenIdentity } from "../auth";
import { readBrowserSession } from "../browser-auth/session";
import { sha256Hex } from "../auth";

type Ctx=Context<AppContext>;
const ACCESS_MS=10*60_000;
const REFRESH_MS=7*24*3600_000;
const EXPIRY_MS=10*60_000;
const SLUG=/^[a-z0-9][a-z0-9-]{0,63}$/;
const ID=/^accli_[a-f0-9]{64}$/;
const CHALLENGE=/^[A-Za-z0-9_-]{43}$/;
const STATE=/^[A-Za-z0-9_.~!$&'()*+,;=:@/?%-]{1,512}$/;
const ALL_SCOPES=["group.read","group.write","group.events"] as const;
const CURRENT="2026-07-28";

function simple(code:string,status=400){return Response.json({error:code},{status,headers:{"cache-control":"no-store","referrer-policy":"no-referrer"}});}
function random(){return [...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,"0")).join("");}
function uri(env:AppEnv):string{
  const u=new URL(env.AUTH_PUBLIC_ORIGIN??"");
  if(u.protocol!=="https:"||u.username||u.password||u.hash||u.search||u.pathname!=="/")
    throw new Error("auth_public_origin_required");
  return u.origin;
}
function validRedirect(value:unknown,env:AppEnv):value is string{
  if(typeof value!=="string"||value.length>1000||/[\\\s%]/.test(value))return false;
  let u:URL;try{u=new URL(value);}catch{return false;}
  if(u.protocol!=="https:"||u.username||u.password||u.hash||u.search||u.pathname==="/")return false;
  const trusted=["https://chatgpt.com","https://platform.openai.com"];
  // Other providers are deliberately opt-in by deployment administrators.
  let allowlist:unknown;
  try{allowlist=JSON.parse(env.COLLABORATION_OAUTH_REDIRECT_ORIGINS??"[]");}catch{return false;}
  if(Array.isArray(allowlist))for(const item of allowlist)if(typeof item==="string"&&item.startsWith("https://"))trusted.push(item);
  if(!trusted.includes(u.origin))return false;
  if(u.origin==="https://chatgpt.com"&&!(/^\/connector\/oauth\/[A-Za-z0-9_-]{8,100}$/.test(u.pathname)||
    u.pathname==="/connector_platform_oauth_redirect"))return false;
  return true;
}
function isExpectedOrigin(req:Request,env:AppEnv):boolean{
  const expected=uri(env);
  const got=req.headers.get("origin");
  const source=new URL(req.url);
  return (got===expected||(
    source.protocol==="http:"&&source.host===new URL(expected).host&&got===source.origin
  ))&&req.headers.get("sec-fetch-site")!=="cross-site";
}
function escape(s:string):string{return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));}
function definedScopes(raw:string):string[]|null{
  const list=[...new Set(raw.trim().split(/\s+/).filter(Boolean))];
  return list.length&&list.every(x=>(ALL_SCOPES as readonly string[]).includes(x))?list.sort():null;
}
function form(req:Request):Promise<URLSearchParams>{
  if(req.headers.get("content-type")?.split(";")[0]?.trim()!=="application/x-www-form-urlencoded")
    throw new Error("invalid_request");
  if(Number(req.headers.get("content-length")||0)>12_000)throw new Error("invalid_request");
  return req.text().then(s=>{if(s.length>12_000)throw new Error("invalid_request");return new URLSearchParams(s);});
}
function noCache(body:unknown,status=200):Response{
  return Response.json(body,{status,headers:{"cache-control":"no-store","pragma":"no-cache","referrer-policy":"no-referrer"}});
}
interface RegisteredClient{id:string;client_id:string;name:string;redirects_json:string;disabled_at:number|null;}
interface Pending{
 id:string; nonce_hash:string; browser_session_id:string;account:string;client_id:string;
 channel_slug:string;redirect_uri:string;state:string;code_challenge:string;
 scopes_json:string;resource:string;expires_at:number;
}
interface Code{
 code_hash:string; pending_id:string; client_id:string;account:string;channel_slug:string;
 redirect_uri:string;code_challenge:string;scopes_json:string;resource:string;expires_at:number;
}
interface Grant{
 id:string;client_id:string;account:string;channel_slug:string;agent_name:string;
 scopes_json:string;resource:string;access_hash:string|null;access_expires_at:number;
 refresh_hash:string|null;refresh_expires_at:number;revoked_at:number|null;
}
function channelFromResource(value:string,env:AppEnv):string|null{
  let target:URL;try{target=new URL(value);}catch{return null;}
  const root=uri(env);
  if(target.origin!==root||target.search||target.hash)return null;
  const m=/^\/api\/channels\/([a-z0-9][a-z0-9-]{0,63})\/mcp$/.exec(target.pathname);
  return m?.[1]??null;
}
async function client(db:D1Database,id:string):Promise<RegisteredClient|null>{
  return db.prepare("SELECT client_id,name,redirects_json,disabled_at FROM connector_oauth_clients WHERE client_id=? AND disabled_at IS NULL")
    .bind(id).first<RegisteredClient>();
}
async function groupOwned(db:D1Database,slug:string,account:string):Promise<boolean>{
  return !!await db.prepare("SELECT slug FROM channels WHERE slug=? AND owner_account=? AND archived_at IS NULL")
    .bind(slug,account).first();
}
async function validCodeChallenge(input:string,challenge:string):Promise<boolean>{
  if(!/^[A-Za-z0-9._~-]{43,128}$/.test(input))return false;
  const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(input)));
  const out=btoa(String.fromCharCode(...hash)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  if(out.length!==challenge.length)return false;
  let delta=0;for(let i=0;i<out.length;i++)delta|=out.charCodeAt(i)^challenge.charCodeAt(i);
  return delta===0;
}
type ConsentLocale = "en" | "zh";
function consentPage(params:{
  id:string;nonce:string;clientName:string;group:string;scopes:string[];account:string
}, locale:ConsentLocale):Response {
  const zh = locale==="zh";
  const phrases = zh ? {
    title:"Agent Commons — 授权云端 Agent",
    heading:"授权 Agent Commons 群组连接",
    github:"当前 GitHub 账号",
    wants:"申请访问群组",
    scope:"申请的操作权限",
    explanation:"授权后将为这个群组创建独立、可随时撤销的 Agent 身份，不会提供你的 GitHub 仓库凭据或私人 ChatGPT 对话。",
    approve:"允许访问此群组",
    deny:"拒绝授权",
    current:"现项目作者：",
    derived:"本项目基于原项目",
    upstream:"二次开发，原作者：郭立（Guo Li / leeguoo）及贡献者。这是独立衍生项目，非原作者官方版本。",
    license:"原项目 BUSL-1.1 许可证",
    source:"Agent Commons 项目源码",
  } : {
    title:"Agent Commons — Connect an agent",
    heading:"Authorize an Agent Commons connection",
    github:"Authenticated GitHub account",
    wants:"requests access to group",
    scope:"Requested operations",
    explanation:"Granting access creates a dedicated, revocable agent identity for this group. It does not give the agent your GitHub repository credentials or personal ChatGPT conversations.",
    approve:"Allow access to this group",
    deny:"Deny",
    current:"Current project author: ",
    derived:"This project is independently developed based on",
    upstream:"originally created by Guo Li (leeguoo) and contributors. This is not an official upstream release.",
    license:"Original BUSL-1.1 license",
    source:"Agent Commons source",
  };
  const scopes=params.scopes.map(scope=>`<li>${escape(scope)}</li>`).join("");
  const html=`<!DOCTYPE html><html lang="${zh?"zh-CN":"en"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">
<meta name="author" content="zmnsQ"><title>${phrases.title}</title></head><body>
<main><h1>${phrases.heading}</h1><p>${phrases.github}: <strong>${escape(params.account)}</strong></p>
<p><strong>${escape(params.clientName)}</strong> ${phrases.wants} <strong>#${escape(params.group)}</strong>.</p>
<p>${phrases.scope}:</p><ul>${scopes}</ul><p>${phrases.explanation}</p>
<form method="POST" action="/oauth/authorize">
<input type="hidden" name="request_id" value="${escape(params.id)}">
<input type="hidden" name="nonce" value="${escape(params.nonce)}">
<button name="decision" value="approve" type="submit">${phrases.approve}</button>
<button name="decision" value="deny" type="submit">${phrases.deny}</button></form>
<footer><p><strong>${phrases.current}<a href="https://github.com/zmnsQ" rel="author noopener noreferrer">zmnsQ</a></strong></p>
<p>${phrases.derived} <a href="https://github.com/leeguooooo/AgentParty">AgentParty</a>,
${phrases.upstream}</p><p><a href="https://github.com/leeguooooo/AgentParty/blob/main/LICENSE">${phrases.license}</a>
· <a href="https://github.com/zmnsQ/AgentParty">${phrases.source}</a></p></footer></main></body></html>`;
  return new Response(html,{headers:{"content-type":"text/html; charset=utf-8",
    "content-security-policy":"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none';",
    "referrer-policy":"no-referrer","cache-control":"no-store"}});
}
function redirectResult(clientUrl:string,value:Record<string,string>):Response{
  const out=new URL(clientUrl);
  for(const [key,item]of Object.entries(value))out.searchParams.set(key,item);
  return new Response(null,{status:302,headers:{location:out.toString(),"referrer-policy":"no-referrer","cache-control":"no-store"}});
}
async function parseBody(req:Request):Promise<URLSearchParams>{
  if(req.headers.get("content-type")?.split(";")[0]?.trim()!=="application/x-www-form-urlencoded")throw new Error("invalid_request");
  const text=await req.text();
  if(text.length>12_000)throw new Error("invalid_request");
  return new URLSearchParams(text);
}
async function issueToken(db:D1Database,from:Code|Grant,clientId:string,
  isRefresh=false):Promise<Record<string,unknown>>{
  const now=Date.now();
  const scope=JSON.parse(from.scopes_json) as string[];
  const account=from.account,slug=from.channel_slug;
  const grantId=await sha256Hex(JSON.stringify([clientId,account,slug]));
  const agentName="ac-oauth-"+grantId.slice(0,25);
  const newToken="ap_"+random();
  const refreshToken="acr_"+random();
  const tokenHash=await sha256Hex(newToken);
  const refreshHash=await sha256Hex(refreshToken);
  if(isRefresh){
    const prior=from as Grant;
    // Revocation or loss of group ownership must stop refresh even when a token
    // has not yet expired. A public group is not a fallback capability.
    if(!await groupOwned(db,slug,account))throw new Error("invalid_grant");
    // CAS the old refresh grant and agent credential within one D1 batch.
    const updated=await db.batch([
      db.prepare(`UPDATE connector_oauth_grants SET access_hash=?,access_expires_at=?,refresh_hash=?,refresh_expires_at=?,updated_at=?
        WHERE id=? AND client_id=? AND refresh_hash=? AND revoked_at IS NULL AND refresh_expires_at>? AND resource=?`)
        .bind(tokenHash,now+ACCESS_MS,refreshHash,now+REFRESH_MS,now,prior.id,clientId,prior.refresh_hash,now,prior.resource),
      db.prepare(`UPDATE tokens SET hash=?,child_expires_at=?,revoked_at=NULL WHERE name=? AND owner=?
        AND EXISTS(SELECT 1 FROM connector_oauth_grants WHERE id=? AND access_hash=?)`)
        .bind(tokenHash,now+ACCESS_MS,agentName,account,grantId,tokenHash),
    ]);
    if(updated[0]!.meta.changes!==1||updated[1]!.meta.changes!==1)throw new Error("invalid_grant");
  }else{
    if(!await groupOwned(db,slug,account))throw new Error("invalid_grant");
    const existing=await db.prepare("SELECT name FROM tokens WHERE name=? AND owner=? AND role='agent'")
      .bind(agentName,account).first();
    const batches=[
      db.prepare(`INSERT INTO connector_oauth_grants(id,client_id,account,channel_slug,agent_name,scopes_json,resource,access_hash,
        access_expires_at,refresh_hash,refresh_expires_at,created_at,updated_at,revoked_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)
        ON CONFLICT(id) DO UPDATE SET scopes_json=excluded.scopes_json,resource=excluded.resource,access_hash=excluded.access_hash,
          access_expires_at=excluded.access_expires_at,refresh_hash=excluded.refresh_hash,refresh_expires_at=excluded.refresh_expires_at,
          updated_at=excluded.updated_at,revoked_at=NULL`)
        .bind(grantId,clientId,account,slug,agentName,JSON.stringify(scope),from.resource,tokenHash,
          now+ACCESS_MS,refreshHash,now+REFRESH_MS,now,now),
      existing?
        db.prepare("UPDATE tokens SET hash=?,child_expires_at=?,revoked_at=NULL WHERE name=? AND owner=? AND role='agent'")
          .bind(tokenHash,now+ACCESS_MS,agentName,account):
        db.prepare(`INSERT INTO tokens(hash,name,role,owner,channel_scope,created_at,child_expires_at) VALUES(?,?,'agent',?,?,?,?)`)
          .bind(tokenHash,agentName,account,slug,now,now+ACCESS_MS),
    ];
    const result=await db.batch(batches);
    if(result.some(x=>x.meta.changes!==1))throw new Error("invalid_grant");
  }
  return {access_token:newToken,token_type:"Bearer",expires_in:ACCESS_MS/1000,
    refresh_token:refreshToken,scope:scope.join(" "),resource:from.resource};
}
function publicUrlForSlug(env:AppEnv,slug:string){return `${uri(env)}/api/channels/${slug}/mcp`;}
export function oauthResourceMetadata(env:AppEnv,slug?:string){
  const home=uri(env);
  return {resource:slug?publicUrlForSlug(env,slug):home,authorization_servers:[home],
    scopes_supported:[...ALL_SCOPES],resource_documentation:`${home}/docs`};
}
export async function oauthPermission(identity:TokenIdentity,env:AppEnv,slug:string,needed:string):Promise<boolean>{
  if(!identity.name.startsWith("ac-oauth-"))return true;
  const row=await env.DB.prepare(`SELECT scopes_json FROM connector_oauth_grants WHERE channel_slug=? AND account=? AND agent_name=?
    AND access_hash=? AND access_expires_at>? AND revoked_at IS NULL`).bind(slug,identity.account??"",identity.name,identity.hash,Date.now()).first<{scopes_json:string}>();
  if(!row)return false;
  try{return (JSON.parse(row.scopes_json) as string[]).includes(needed);}catch{return false;}
}
/** OAuth-issued access tokens must not become general bearer API credentials.
 * The MCP server may forward only these fixed tool-backed REST actions.
 * All other API/WS/admin routes are denied even if their ACL would allow a
 * regular channel-scoped agent token. */
export async function oauthRestPermission(identity:TokenIdentity,env:AppEnv,path:string,method:string):Promise<boolean>{
  if(!identity.name.startsWith("ac-oauth-"))return true;
  const slug=identity.channel_scope;
  if(!slug||!SLUG.test(slug))return false;
  const base="/api/channels/"+slug+"/";
  if(!path.startsWith(base))return false;
  const suffix=path.slice(base.length);
  if(method==="POST"&&suffix==="mcp")return oauthPermission(identity,env,slug,"group.read");
  const reads=suffix==="messages"||suffix==="files"||suffix==="tasks"||suffix==="repositories"||
    /^repositories\/[a-zA-Z0-9_-]+\/(?:pulls|commits|snapshot|files|file|proposals|proposals\/[a-zA-Z0-9_-]+)$/.test(suffix)||
    /^attachments\/[A-Za-z0-9_%./-]+$/.test(suffix);
  const writes=suffix==="messages"||suffix==="attachments"||
    /^repositories\/[a-zA-Z0-9_-]+\/proposals$/.test(suffix);
  if(method==="GET"&&reads)return oauthPermission(identity,env,slug,"group.read");
  if(method==="POST"&&writes)return oauthPermission(identity,env,slug,"group.write");
  return false;
}
export function registerConnectorOauth(app:Hono<AppContext>):void{
  app.get("/.well-known/oauth-protected-resource", c=>{
    try{return noCache(oauthResourceMetadata(c.env));}catch{return simple("not_configured",503);}
  });
  app.get("/.well-known/oauth-protected-resource/api/channels/:slug/mcp",c=>{
    const slug=c.req.param("slug");
    if(!SLUG.test(slug))return simple("invalid_resource");
    try{return noCache(oauthResourceMetadata(c.env,slug));}catch{return simple("not_configured",503);}
  });
  app.get("/.well-known/oauth-authorization-server",c=>{
    let root:string;try{root=uri(c.env);}catch{return simple("not_configured",503);}
    return noCache({issuer:root,authorization_endpoint:root+"/oauth/authorize",
      token_endpoint:root+"/oauth/token",registration_endpoint:root+"/oauth/register",
      authorization_response_iss_parameter_supported:true,
      response_types_supported:["code"],grant_types_supported:["authorization_code","refresh_token"],
      token_endpoint_auth_methods_supported:["none"],code_challenge_methods_supported:["S256"],
      client_id_metadata_document_supported:false,scopes_supported:[...ALL_SCOPES]});
  });
  app.post("/oauth/register",async c=>{
    let input:unknown;
    try{const raw=await c.req.text();if(raw.length>10_000)return simple("invalid_client_metadata");input=JSON.parse(raw);}
    catch{return simple("invalid_client_metadata");}
    if(!input||typeof input!=="object"||Array.isArray(input))return simple("invalid_client_metadata");
    const item=input as Record<string,unknown>;
    if(!Array.isArray(item.redirect_uris)||!item.redirect_uris.length||item.redirect_uris.length>5||
      item.redirect_uris.some(x=>!validRedirect(x,c.env))||
      item.token_endpoint_auth_method!==undefined&&item.token_endpoint_auth_method!=="none")return simple("invalid_redirect_uri");
    // DCR is intentionally available to public MCP clients, but it must not
    // provide an unbounded D1 write primitive to anonymous internet traffic.
    const now=Date.now();
    const clientIp=await sha256Hex(c.req.header("cf-connecting-ip")??"unknown");
    const rate=await c.env.DB.prepare(`INSERT INTO browser_auth_limits(key,window_at,attempts) VALUES(?,?,1)
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_at<? THEN 1 ELSE attempts+1 END,
      window_at=CASE WHEN window_at<? THEN excluded.window_at ELSE window_at END RETURNING attempts`)
      .bind("oauth-dcr:"+clientIp,now,now-600_000,now-600_000).first<{attempts:number}>();
    if(!rate||rate.attempts>20)return simple("rate_limited",429);
    const clientId="accli_"+random();
    const name=typeof item.client_name==="string"?item.client_name.slice(0,80):"ChatGPT MCP client";
    try {
      await c.env.DB.prepare("INSERT INTO connector_oauth_clients(client_id,name,redirects_json,created_at) VALUES(?,?,?,?)")
        .bind(clientId,name,JSON.stringify(item.redirect_uris),Date.now()).run();
    }catch{return simple("temporarily_unavailable",503);}
    return noCache({client_id:clientId,client_id_issued_at:Math.floor(Date.now()/1000),
      client_name:name,redirect_uris:item.redirect_uris,grant_types:["authorization_code","refresh_token"],
      response_types:["code"],token_endpoint_auth_method:"none"},201);
  });
  app.get("/oauth/authorize",async c=>{
    const p=c.req.query();
    const clientId=p.client_id??"",redirect=p.redirect_uri??"",resource=p.resource??"",scope=p.scope??"";
    const scopes=definedScopes(scope),slug=channelFromResource(resource,c.env);
    const target=await client(c.env.DB,clientId);
    if(!target||!slug||!scopes||p.response_type!=="code"||p.code_challenge_method!=="S256"||
      !CHALLENGE.test(p.code_challenge??"")||!STATE.test(p.state??"")||
      !JSON.parse(target.redirects_json).includes(redirect))return simple("invalid_authorization_request");
    const current=await readBrowserSession(c.env.DB,c.req.raw);
    if(!current||current.stage!=="ready"){
      const path="/oauth/authorize?"+new URLSearchParams(p).toString();
      const url=`${uri(c.env)}/api/auth/github/start?return_to=${encodeURIComponent(path)}`;
      return new Response(null,{status:302,headers:{location:url,"cache-control":"no-store","referrer-policy":"no-referrer"}});
    }
    if(!await groupOwned(c.env.DB,slug,current.account))return simple("group_owner_required",403);
    const nonce=random(),id="request_"+random();
    await c.env.DB.prepare(`INSERT INTO connector_oauth_pending
      (id,nonce_hash,browser_session_id,account,client_id,channel_slug,redirect_uri,state,code_challenge,scopes_json,resource,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,await sha256Hex(nonce),current.id,current.account,clientId,
      slug,redirect,p.state,p.code_challenge,JSON.stringify(scopes),resource,Date.now()+EXPIRY_MS).run();
    const language=(c.req.header("accept-language")??"").trim().toLowerCase().startsWith("zh")?"zh":"en";
    return consentPage({id,nonce,clientName:target.name,group:slug,scopes,account:current.account},language);
  });
  app.post("/oauth/authorize",async c=>{
    if(!isExpectedOrigin(c.req.raw,c.env))return simple("invalid_origin",403);
    let params:URLSearchParams;try{params=await parseBody(c.req.raw);}catch{return simple("invalid_request");}
    const id=params.get("request_id")??"",nonce=params.get("nonce")??"",decision=params.get("decision");
    if(!/^request_[a-f0-9]{64}$/.test(id)||!/^[a-f0-9]{64}$/.test(nonce)||!["approve","deny"].includes(decision??""))return simple("invalid_request");
    const current=await readBrowserSession(c.env.DB,c.req.raw);
    if(!current||current.stage!=="ready")return simple("login_required",401);
    const pending=await c.env.DB.prepare(`DELETE FROM connector_oauth_pending WHERE id=? AND nonce_hash=? AND browser_session_id=?
      AND account=? AND expires_at>? RETURNING *`)
      .bind(id,await sha256Hex(nonce),current.id,current.account,Date.now()).first<Pending>();
    if(!pending)return simple("invalid_or_expired_consent",403);
    const issuer=uri(c.env);
    if(decision==="deny")return redirectResult(pending.redirect_uri,{error:"access_denied",state:pending.state,iss:issuer});
    if(!await groupOwned(c.env.DB,pending.channel_slug,current.account))return simple("group_owner_required",403);
    const code="acco_"+random();
    await c.env.DB.prepare(`INSERT INTO connector_oauth_codes(code_hash,pending_id,client_id,account,channel_slug,redirect_uri,
      code_challenge,scopes_json,resource,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .bind(await sha256Hex(code),pending.id,pending.client_id,current.account,pending.channel_slug,
        pending.redirect_uri,pending.code_challenge,pending.scopes_json,pending.resource,Date.now()+EXPIRY_MS).run();
    return redirectResult(pending.redirect_uri,{code,state:pending.state,iss:issuer});
  });
  app.post("/oauth/token",async c=>{
    let p:URLSearchParams;try{p=await parseBody(c.req.raw);}catch{return simple("invalid_request");}
    const clientId=p.get("client_id")??"",resource=p.get("resource")??"";
    if(!ID.test(clientId)||!await client(c.env.DB,clientId))return simple("invalid_client",401);
    const slug=channelFromResource(resource,c.env);
    if(!slug)return simple("invalid_target_resource");
    try{
      if(p.get("grant_type")==="authorization_code"){
        const code=p.get("code")??"",redirect=p.get("redirect_uri")??"";
        const verifier=p.get("code_verifier")??"";
        if(!/^acco_[a-f0-9]{64}$/.test(code))return simple("invalid_grant");
        const row=await c.env.DB.prepare(`DELETE FROM connector_oauth_codes
          WHERE code_hash=? AND client_id=? AND resource=? AND redirect_uri=? AND expires_at>? RETURNING *`)
          .bind(await sha256Hex(code),clientId,resource,redirect,Date.now()).first<Code>();
        if(!row||row.channel_slug!==slug||!await validCodeChallenge(verifier,row.code_challenge))return simple("invalid_grant");
        return noCache(await issueToken(c.env.DB,row,clientId));
      }
      if(p.get("grant_type")==="refresh_token"){
        const old=p.get("refresh_token")??"";
        if(!/^acr_[a-f0-9]{64}$/.test(old))return simple("invalid_grant");
        const row=await c.env.DB.prepare(`SELECT * FROM connector_oauth_grants
          WHERE refresh_hash=? AND client_id=? AND resource=? AND channel_slug=? AND revoked_at IS NULL AND refresh_expires_at>?`)
          .bind(await sha256Hex(old),clientId,resource,slug,Date.now()).first<Grant>();
        if(!row)return simple("invalid_grant");
        return noCache(await issueToken(c.env.DB,row,clientId,true));
      }
      return simple("unsupported_grant_type");
    }catch{return simple("invalid_grant");}
  });
  app.get("/oauth/grants",async c=>{
    const current=await readBrowserSession(c.env.DB,c.req.raw);
    if(!current||current.stage!=="ready")return simple("login_required",401);
    const grants=await c.env.DB.prepare(
      "SELECT g.id,g.channel_slug,g.agent_name,g.scopes_json,g.updated_at,c.name AS client_name " +
      "FROM connector_oauth_grants g JOIN connector_oauth_clients c ON c.client_id=g.client_id " +
      "WHERE g.account=? AND g.revoked_at IS NULL AND g.refresh_expires_at>? ORDER BY g.updated_at DESC LIMIT 50"
    ).bind(current.account,Date.now()).all<{
      id:string;channel_slug:string;agent_name:string;scopes_json:string;updated_at:number;client_name:string;
    }>();
    return noCache({connections:grants.results.map(x=>({
      id:x.id,group:x.channel_slug,agent_name:x.agent_name,client_name:x.client_name,
      scopes:JSON.parse(x.scopes_json),updated_at:x.updated_at,
    }))});
  });
  app.post("/oauth/grants/revoke",async c=>{
    if(!isExpectedOrigin(c.req.raw,c.env))return simple("invalid_origin",403);
    const current=await readBrowserSession(c.env.DB,c.req.raw);
    if(!current||current.stage!=="ready")return simple("login_required",401);
    let p:URLSearchParams;try{p=await parseBody(c.req.raw);}catch{return simple("invalid_request");}
    const grantId=p.get("grant_id")??"";
    if(!/^[a-f0-9]{64}$/.test(grantId))return simple("invalid_request");
    const currentGrant=await c.env.DB.prepare(
      "SELECT agent_name FROM connector_oauth_grants WHERE id=? AND account=? AND revoked_at IS NULL"
    ).bind(grantId,current.account).first<{agent_name:string}>();
    if(!currentGrant)return simple("not_found",404);
    const now=Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE connector_oauth_grants SET revoked_at=?,updated_at=? WHERE id=? AND account=? AND revoked_at IS NULL"
      ).bind(now,now,grantId,current.account),
      c.env.DB.prepare("UPDATE tokens SET revoked_at=? WHERE name=? AND owner=? AND role='agent'")
        .bind(now,currentGrant.agent_name,current.account),
    ]);
    return noCache({revoked:true});
  });
}
