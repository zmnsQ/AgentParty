import {MUSE_NATIVE_REDIRECT,MUSE_PUBLIC_PKCE} from "./muse-native";
import type {Context,Hono} from 'hono';
import type {AppContext,LoadedChannel} from '../index';
import type {TokenIdentity} from '../auth';
import {sha256Hex} from '../auth';
import {verifiedMfaOwner,mcpSecurity} from './mcp-security';
import {COLLABORATION_MCP_TOOLS} from './mcp';

type Ctx=Context<AppContext>;
type Granted={slug:string;channel:LoadedChannel;identity:TokenIdentity};
type Deps={access(c:Ctx,mode?:'read'|'manage'|'run'):Promise<Response|Granted>};
const secret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const fail=(code:string,status=400)=>Response.json({error:{code,message:code}},{status,headers:{'cache-control':'no-store'}});
/** Never invent a Muse callback. The owner pastes the exact value from Meta's portal.
 * Host ownership checks are boundary-aware; registration does not make an outbound request. */
export function validMuseRedirect(value:unknown):value is string {
 if(typeof value!=='string'||value.length>1400||/[\\\x00-\x20\x7f]/.test(value))return false;
 let u:URL;try{u=new URL(value);}catch{return false;}
 return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&!u.search&&u.pathname!=='/'&&
  !u.hostname.endsWith('.')&&['muse.ai','meta.ai'].some(host=>u.hostname===host||u.hostname.endsWith('.'+host));
}
export function museReviewManifest(origin:string,slug:string){
 const safe=new URL(origin);if(safe.protocol!=='https:')throw Error('public_origin_required');
 const base=safe.origin;
 return {schema_version:1,product:'Agent Commons',developer:'zmnsQ',provider:'Muse',
  based_on:{project:'AgentParty',source:'https://github.com/leeguooooo/AgentParty',license:'BUSL-1.1'},
  endpoint:`${base}/api/channels/${slug}/mcp`,
  authentication:{type:'OAuth 2.1',authorization_endpoint:base+'/oauth/authorize',token_endpoint:base+'/oauth/token',
   client_authentication:['client_secret_basic','client_secret_post'],pkce:'S256 required',
   resource:`${base}/api/channels/${slug}/mcp`,scopes:['group.read','group.write','group.events'],read_only_available:true},
  review_status:'not_submitted',review_status_source:'No verified platform decision is stored by this application.',
  permissions:COLLABORATION_MCP_TOOLS.map(tool=>({name:tool.name,description:tool.description,
   input_schema:tool.inputSchema,classification:tool.annotations.readOnlyHint?'read':'sensitive_write',
   approval:tool.annotations.readOnlyHint?'Muse read permission':'Ask on each use; do not bypass Muse approval',
   scopes:tool.annotations.readOnlyHint?['group.read']:['group.read','group.write']})),
  data:{scope:'Only the one explicitly authorized group; no private Muse history is imported.',
   encryption:'HTTPS; client secrets are stored as SHA-256 hashes, provider credentials encrypted at rest.',
   revoke:'Disable this client to revoke grants, pending consent, tokens and subscriptions.',
   retention:'Uses the configured group retention policy. The operator must document its actual retention period.'},
  required_submission_materials:['Verified organization or developer identity','Operator-approved privacy policy and product terms',
    'Support and security contacts','Dedicated review account with MFA and representative test data','End-to-end demo'],
  submission_url:'https://platform.muse.ai/login?return_to=%2Fsubmission',
  official_guidelines:'https://platform.muse.ai/docs',
  gadget_wake:{transport:'Official musegadget send-user-msg, per-group side-chat session',
   requires:'Explicit device pairing and an isolated, least-privilege Linux host',
   status:'Requires your real paired device; SDK availability does not prove a live personal session'},
 };
}
export function registerMuseConnectorRoutes(app:Hono<AppContext>,deps:Deps){
 const base='/api/channels/:slug/bridges/muse';
 app.get(base,async c=>{
  const a=await deps.access(c,'manage');if(a instanceof Response)return a;
  const origin=c.env.AUTH_PUBLIC_ORIGIN;if(!origin)return fail('public_origin_required',503);
  const clients=await c.env.DB.prepare(`SELECT c.client_id,c.name,c.redirects_json,c.disabled_at,p.created_at,p.secret_hash,
    (SELECT COUNT(*) FROM connector_oauth_grants g WHERE g.client_id=c.client_id AND g.revoked_at IS NULL AND g.refresh_expires_at>?) AS active_grants
    FROM connector_oauth_private_clients p JOIN connector_oauth_clients c ON c.client_id=p.client_id
    WHERE p.channel_slug=? AND p.owner_account=? AND p.provider='muse' ORDER BY p.created_at DESC LIMIT 10`)
    .bind(Date.now(),a.slug,a.identity.account!).all<{client_id:string;name:string;redirects_json:string;disabled_at:number|null;created_at:number;secret_hash:string;active_grants:number}>();
  const checkedAt=Date.now();
  const native=await c.env.DB.prepare(`SELECT COUNT(*) AS grants,
    SUM(CASE WHEN g.refresh_expires_at>? AND EXISTS(SELECT 1 FROM tokens t WHERE t.name=g.agent_name
      AND t.owner=g.account AND t.hash=g.access_hash AND t.role='agent' AND t.channel_scope=g.channel_slug AND t.revoked_at IS NULL)
      THEN 1 ELSE 0 END) AS refreshable,
    SUM(CASE WHEN g.refresh_expires_at>? AND g.access_expires_at>? AND EXISTS(SELECT 1 FROM tokens t
      WHERE t.name=g.agent_name AND t.owner=g.account AND t.hash=g.access_hash AND t.role='agent'
      AND t.channel_scope=g.channel_slug AND t.revoked_at IS NULL AND t.child_expires_at>?)
      THEN 1 ELSE 0 END) AS usable
    FROM connector_oauth_grants g JOIN connector_oauth_clients c ON c.client_id=g.client_id
    WHERE g.channel_slug=? AND g.account=? AND g.revoked_at IS NULL AND c.disabled_at IS NULL AND c.redirects_json=?`)
    .bind(checkedAt,checkedAt,checkedAt,checkedAt,a.slug,a.identity.account!,JSON.stringify([MUSE_NATIVE_REDIRECT]))
    .first<{grants:number;refreshable:number;usable:number}>();
  // Grant validity is not evidence that Muse saved/refreshes a credential or can wake.
  const nativeStatus=(native?.usable??0)>0?'access_valid':(native?.refreshable??0)>0?'refresh_required':
    (native?.grants??0)>0?'reauthorization_required':'not_authorized';
  c.header('cache-control','no-store');
  return c.json({native_authorized:(native?.refreshable??0)>0,native_oauth:{status:nativeStatus,checked_at:checkedAt,client_verified:false},policy:await mcpSecurity(c.env.DB,a.slug),can_configure:await verifiedMfaOwner(c.env.DB,a.identity),
   native_client_id:clients.results.find(x=>!x.disabled_at&&x.secret_hash===MUSE_PUBLIC_PKCE)?.client_id??null,
   clients:clients.results.map(x=>({client_id:x.client_id,name:x.name,redirect_uris:JSON.parse(x.redirects_json),
    disabled:x.disabled_at!==null,created_at:x.created_at,active_grants:x.active_grants})),
   configuration:museReviewManifest(origin,a.slug).authentication,
   mcp_endpoint:`${new URL(origin).origin}/api/channels/${a.slug}/mcp`,
   platform_review:{status:'not_submitted',verified:false},personal_wake:{status:'requires_device_pairing',verified:false}});
 });
 app.post(base+'/native-client',async c=>{
  const a=await deps.access(c,'manage');if(a instanceof Response)return a;
  if(!await verifiedMfaOwner(c.env.DB,a.identity))return fail('mfa_required',403);
  const existing=await c.env.DB.prepare(`SELECT c.client_id FROM connector_oauth_private_clients p
    JOIN connector_oauth_clients c ON c.client_id=p.client_id WHERE p.owner_account=? AND p.channel_slug=?
    AND p.provider='muse' AND p.secret_hash=? AND c.disabled_at IS NULL LIMIT 1`)
    .bind(a.identity.account!,a.slug,MUSE_PUBLIC_PKCE).first<{client_id:string}>();
  if(existing)return c.json({client_id:existing.client_id,token_endpoint_auth_method:'none',authorized:false});
  const id='accli_'+secret(),now=Date.now();
  const count=await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM connector_oauth_private_clients p JOIN connector_oauth_clients c ON c.client_id=p.client_id WHERE p.channel_slug=? AND c.disabled_at IS NULL`)
    .bind(a.slug).first<{n:number}>();if((count?.n??0)>=3)return fail('client_limit_reached',409);
  await c.env.DB.batch([
   c.env.DB.prepare('INSERT INTO connector_oauth_clients(client_id,name,redirects_json,created_at) VALUES(?,?,?,?)')
    .bind(id,'Muse native MCP',JSON.stringify([MUSE_NATIVE_REDIRECT]),now),
   c.env.DB.prepare("INSERT INTO connector_oauth_private_clients(client_id,provider,owner_account,channel_slug,secret_hash,created_at) VALUES(?,'muse',?,?,?,?)")
    .bind(id,a.identity.account!,a.slug,MUSE_PUBLIC_PKCE,now),
  ]);
  c.header('cache-control','no-store');
  return c.json({client_id:id,token_endpoint_auth_method:'none',authorized:false},201);
 });
 app.post(base+'/oauth-client',async c=>{
  const a=await deps.access(c,'manage');if(a instanceof Response)return a;
  if(!await verifiedMfaOwner(c.env.DB,a.identity))return fail('mfa_required',403);
  if(c.req.header('content-type')?.split(';')[0]!=='application/json')return fail('invalid_content_type',415);
  const raw=await c.req.text();if(raw.length>4000)return fail('request_too_large',413);
  let body:unknown;try{body=JSON.parse(raw);}catch{return fail('invalid_json');}
  const input=body as {redirect_uri?:unknown};if(!input||!validMuseRedirect(input.redirect_uri))return fail('invalid_muse_redirect');
  const count=await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM connector_oauth_private_clients p
    JOIN connector_oauth_clients c ON c.client_id=p.client_id WHERE p.channel_slug=? AND c.disabled_at IS NULL`)
    .bind(a.slug).first<{n:number}>();if((count?.n??0)>=3)return fail('client_limit_reached',409);
  const id='accli_'+secret(),key='acs_'+secret(),now=Date.now();
  await c.env.DB.batch([
   c.env.DB.prepare('INSERT INTO connector_oauth_clients(client_id,name,redirects_json,created_at) VALUES(?,?,?,?)')
    .bind(id,'Muse Cloud',JSON.stringify([input.redirect_uri]),now),
   c.env.DB.prepare("INSERT INTO connector_oauth_private_clients(client_id,provider,owner_account,channel_slug,secret_hash,created_at) VALUES(?,'muse',?,?,?,?)")
    .bind(id,a.identity.account!,a.slug,await sha256Hex(key),now),
  ]);
  c.header('cache-control','no-store');
  return c.json({client_id:id,client_secret:key,redirect_uri:input.redirect_uri,
   token_endpoint_auth_method:'client_secret_basic',pkce:'S256',secret_shown_once:true,authorized:false},201);
 });
 app.get(base+'/review-package',async c=>{
  const a=await deps.access(c,'manage');if(a instanceof Response)return a;
  if(!c.env.AUTH_PUBLIC_ORIGIN)return fail('public_origin_required',503);
  c.header('cache-control','no-store');c.header('content-disposition','attachment; filename="agent-commons-muse-review.json"');
  return c.json(museReviewManifest(c.env.AUTH_PUBLIC_ORIGIN,a.slug));
 });
 app.delete(base+'/oauth-client/:clientId',async c=>{
  const a=await deps.access(c,'manage');if(a instanceof Response)return a;
  if(!await verifiedMfaOwner(c.env.DB,a.identity))return fail('mfa_required',403);
  const id=c.req.param('clientId');
  const p=await c.env.DB.prepare('SELECT client_id FROM connector_oauth_private_clients WHERE client_id=? AND owner_account=? AND channel_slug=?')
   .bind(id,a.identity.account!,a.slug).first();if(!p)return fail('not_found',404);
  const now=Date.now();
  await c.env.DB.batch([
   c.env.DB.prepare('UPDATE connector_oauth_clients SET disabled_at=? WHERE client_id=?').bind(now,id),
   c.env.DB.prepare('UPDATE tokens SET revoked_at=? WHERE name IN (SELECT agent_name FROM connector_oauth_grants WHERE client_id=?)').bind(now,id),
   c.env.DB.prepare('UPDATE connector_oauth_grants SET revoked_at=?,updated_at=? WHERE client_id=?').bind(now,now,id),
   c.env.DB.prepare('DELETE FROM connector_oauth_pending WHERE client_id=?').bind(id),
   c.env.DB.prepare('DELETE FROM connector_oauth_codes WHERE client_id=?').bind(id),
   c.env.DB.prepare('UPDATE mcp_event_subscriptions SET revoked_at=? WHERE agent_name IN (SELECT agent_name FROM connector_oauth_grants WHERE client_id=?)').bind(now,id),
  ]);
  return c.json({revoked:true});
 });
}
