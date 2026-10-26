import {env} from "cloudflare:test";
import {Hono} from "hono";
import {afterEach,describe,expect,it,vi} from "vitest";
import type {AppContext,AppEnv} from "../src/index";
import {sha256Hex} from "../src/auth";
import {registerConnectorOauth} from "../src/collaboration/oauth";
import {diagnoseRefreshFailure} from "../src/collaboration/oauth-diagnostics";
import {MUSE_NATIVE_REDIRECT} from "../src/collaboration/muse-native";
import {createChannel,seedToken,uniq} from "./helpers";
import {enableMcpFixture} from "./mcp-test-helpers";

const SITE="https://commons.test";
const app=new Hono<AppContext>();
registerConnectorOauth(app);
afterEach(()=>vi.restoreAllMocks());

async function fixture(){
  const account=uniq("diagnostic-private-account"),human=await seedToken("human",uniq("diagnostic-human"),{owner:account});
  const slug=await createChannel(human.token);
  await enableMcpFixture(slug,account);
  const clientId="accli_"+await sha256Hex(crypto.randomUUID());
  const refresh="acr_"+await sha256Hex(crypto.randomUUID());
  const id=await sha256Hex(JSON.stringify([clientId,account,slug])),agentName="ac-oauth-"+id.slice(0,25);
  const agent=await seedToken("agent",agentName,{owner:account,channelScope:slug,childExpiresAt:Date.now()+600_000});
  const resource=SITE+`/api/channels/${slug}/mcp`,now=Date.now();
  await env.DB.prepare("INSERT INTO connector_oauth_clients(client_id,name,redirects_json,created_at) VALUES(?,?,?,?)")
    .bind(clientId,"private-client-name",JSON.stringify([MUSE_NATIVE_REDIRECT]),now).run();
  await env.DB.prepare(`INSERT INTO connector_oauth_grants(id,client_id,account,channel_slug,agent_name,scopes_json,
    resource,access_hash,access_expires_at,refresh_hash,refresh_expires_at,created_at,updated_at)
    VALUES(?,?,?,?,?,'["group.read"]',?,?,?,?,?,?,?)`)
    .bind(id,clientId,account,slug,agentName,resource,await sha256Hex(agent.token),now+600_000,await sha256Hex(refresh),now+86_400_000,now,now).run();
  const params=new URLSearchParams({grant_type:"refresh_token",client_id:clientId,refresh_token:refresh});
  return {id,account,slug,clientId,refresh,agent,resource,params};
}

function invoke(params:URLSearchParams,db:D1Database=env.DB,headers:Record<string,string>={}){
  return app.fetch(new Request(SITE+"/oauth/token?private-url-canary",{
    method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",...headers},body:params.toString(),
  }),{...env,DB:db,AUTH_PUBLIC_ORIGIN:SITE} as unknown as AppEnv);
}

describe("OAuth token diagnostics",()=>{
  it("classifies real hashed grants without treating unknown or rotated hashes as revoked",async()=>{
    const c=await fixture();
    expect(await diagnoseRefreshFailure(env.DB,c.refresh,c.clientId,c.resource+"/wrong")).toBe("refresh_resource_mismatch");
    await env.DB.prepare("UPDATE connector_oauth_grants SET refresh_expires_at=? WHERE id=?").bind(Date.now()-1,c.id).run();
    expect(await diagnoseRefreshFailure(env.DB,c.refresh,c.clientId)).toBe("refresh_expired");
    await env.DB.prepare("UPDATE connector_oauth_grants SET revoked_at=? WHERE id=?").bind(Date.now(),c.id).run();
    expect(await diagnoseRefreshFailure(env.DB,c.refresh,null)).toBe("refresh_revoked");
    expect(await diagnoseRefreshFailure(env.DB,"acr_"+"f".repeat(64),c.clientId)).toBe("refresh_unknown_or_rotated");
    const broken={prepare(){throw new Error("private-db-error-canary");}} as unknown as D1Database;
    expect(await diagnoseRefreshFailure(broken,c.refresh,c.clientId)).toBe("diagnostic_unavailable");
  });

  it.each(["expired","revoked","rotated"] as const)("identifies %s refresh behind native resource inference without changing its error",async kind=>{
    const c=await fixture();
    if(kind==="expired")await env.DB.prepare("UPDATE connector_oauth_grants SET refresh_expires_at=? WHERE id=?").bind(Date.now()-1,c.id).run();
    if(kind==="revoked")await env.DB.prepare("UPDATE connector_oauth_grants SET revoked_at=? WHERE id=?").bind(Date.now(),c.id).run();
    if(kind==="rotated")await env.DB.prepare("UPDATE connector_oauth_grants SET refresh_hash=? WHERE id=?").bind(await sha256Hex(crypto.randomUUID()),c.id).run();
    const log=vi.spyOn(console,"warn").mockImplementation(()=>{});
    const response=await invoke(c.params);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({error:"invalid_target_resource"});
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0]![1] as string)).toMatchObject({
      reason:kind==="rotated"?"refresh_unknown_or_rotated":"refresh_"+kind,resource_present:false,http_status:400,
    });
  });

  it("preserves client inference, success response and TTL while logging no credential or identity values",async()=>{
    const c=await fixture();c.params.delete("client_id");
    const log=vi.spyOn(console,"warn").mockImplementation(()=>{});
    const response=await invoke(c.params),body=await response.json() as {access_token:string;refresh_token:string;expires_in:number};
    expect(response.status).toBe(200);expect(body.expires_in).toBe(600);
    expect(log).toHaveBeenCalledTimes(1);
    const record=JSON.parse(log.mock.calls[0]![1] as string);
    expect(record).toEqual({reason:"refreshed",client_kind:"muse_native",grant_kind:"refresh_token",parsed_form:true,
      client_id_present:false,resource_present:false,refresh_token_present:true,client_secret_present:false,authorization_present:false,http_status:200});
    const output=JSON.stringify(log.mock.calls);
    for(const sensitive of [c.account,c.slug,c.clientId,c.refresh,c.agent.token,c.id,c.resource,
      await sha256Hex(c.refresh),body.access_token,body.refresh_token,"private-url-canary"])
      expect(output).not.toContain(sensitive);
  });

  it("classifies expired refresh during omitted-client lookup without changing its 401",async()=>{
    const c=await fixture();c.params.delete("client_id");
    await env.DB.prepare("UPDATE connector_oauth_grants SET refresh_expires_at=? WHERE id=?").bind(Date.now()-1,c.id).run();
    const log=vi.spyOn(console,"warn").mockImplementation(()=>{}),response=await invoke(c.params);
    expect(response.status).toBe(401);expect(await response.json()).toEqual({error:"invalid_client"});
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0]![1] as string)).toMatchObject({reason:"refresh_expired",client_id_present:false,http_status:401});
  });

  it("never emits untrusted fields, unknown grant types or authentication failures verbatim",async()=>{
    const log=vi.spyOn(console,"warn").mockImplementation(()=>{});
    const params=new URLSearchParams({client_id:"private-client-canary",client_secret:"private-secret-canary",
      grant_type:"private-grant-canary",refresh_token:"private-refresh-canary",resource:"https://private-resource-canary",code:"private-code-canary"});
    const response=await invoke(params,env.DB,{authorization:"Bearer private-header-canary"});
    expect(response.status).toBe(401);expect(await response.json()).toEqual({error:"invalid_client"});
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-");
    expect(JSON.parse(log.mock.calls[0]![1] as string)).toMatchObject({reason:"client_auth_rejected",grant_kind:"other"});
  });

  it("logging failures cannot change successful or rejected exchanges",async()=>{
    const c=await fixture();
    vi.spyOn(console,"warn").mockImplementation(()=>{throw new Error("private-log-error-canary");});
    expect((await invoke(c.params)).status).toBe(200);
    c.params.append("client_id",c.clientId);
    const response=await invoke(c.params);
    expect(response.status).toBe(400);expect(await response.json()).toEqual({error:"invalid_request"});
  });

  it.each([[0,0,"refresh_cas_not_applied"],[1,0,"identity_update_not_applied"]] as const)("distinguishes batch results %s/%s",async(first,second,reason)=>{
    const c=await fixture(),log=vi.spyOn(console,"warn").mockImplementation(()=>{});
    const db={prepare:env.DB.prepare.bind(env.DB),batch:async()=>[{meta:{changes:first}},{meta:{changes:second}}]} as unknown as D1Database;
    const response=await invoke(c.params,db);
    expect(response.status).toBe(400);expect(await response.json()).toEqual({error:"invalid_grant"});
    expect(JSON.parse(log.mock.calls[0]![1] as string)).toMatchObject({reason,http_status:400});
  });

  it("keeps policy denial distinct from invalid refresh credentials",async()=>{
    const c=await fixture();
    await env.DB.prepare("UPDATE channel_mcp_security SET enabled=0 WHERE channel_slug=?").bind(c.slug).run();
    const log=vi.spyOn(console,"warn").mockImplementation(()=>{}),response=await invoke(c.params);
    expect(response.status).toBe(400);expect(await response.json()).toEqual({error:"invalid_grant"});
    expect(JSON.parse(log.mock.calls[0]![1] as string)).toMatchObject({reason:"policy_denied"});
  });
});
