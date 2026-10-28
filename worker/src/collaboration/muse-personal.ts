import type { Context, Hono } from 'hono';
import type { AppContext, LoadedChannel } from '../index';
import type { TokenIdentity } from '../auth';
import { verifiedMfaOwner } from './mcp-security';
type Ctx=Context<AppContext>;
type Deps={access(c:Ctx,mode?:'read'|'manage'|'run'):Promise<Response|{slug:string;channel:LoadedChannel;identity:TokenIdentity}>};
export interface PersonalBinding {channel_slug:string;owner_account:string;binding_id:string;account_label:string;sidechat_label:string;last_checked_at:number|null;report_state:string|null;reason:string|null}
const fail=(code:string,status=400)=>Response.json({error:{code,message:code}},{status,headers:{'cache-control':'no-store'}});
export function personalStatus(enabled:boolean,row:PersonalBinding|null,now=Date.now()) {
 const stale=row?.last_checked_at==null || now-row.last_checked_at>120_000;
 return {enabled,configured:enabled&&row!==null,state:!enabled?'unconfigured':!row?'unconfigured':stale?'reconnect_required':row.report_state,
  binding:enabled&&row?{binding_id:row.binding_id,account_label:row.account_label,sidechat_label:row.sidechat_label}:null,
  last_checked_at:enabled?row?.last_checked_at??null:null,actual_account_verified:false,evidence:'bridge_reported',end_to_end_verified:false,
  reason:!enabled?'operator_setup_required':!row?'binding_required':stale?'fresh_report_required':row.reason};
}
export function bridgeKey(raw:string|undefined,slug:string):{secret:string;agent_name:string}|null {
 try {const v=JSON.parse(raw??'{}')[slug];return v&&typeof v.secret==='string'&&/^[A-Za-z0-9_-]{43,128}$/.test(v.secret)&&typeof v.agent_name==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v.agent_name)?v:null;}catch{return null;}
}
export async function verifyPersonalReport(secret:string,slug:string,timestamp:string,nonce:string,raw:string,signature:string,now=Date.now()){
 if(!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>60_000||!/^[A-Za-z0-9_-]{16,80}$/.test(nonce)||!/^[a-f0-9]{64}$/.test(signature))return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes=Uint8Array.from(signature.match(/../g)!,v=>parseInt(v,16));
 return crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(`muse-personal-v1\n${slug}\n${timestamp}\n${nonce}\n${raw}`));
}
const text=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
async function body(c:Ctx){
 if(c.req.header('content-type')?.split(';')[0]!=='application/json'||Number(c.req.header('content-length')??0)>2048)return null;
 const reader=c.req.raw.body?.getReader();if(!reader)return null;
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>2048)return null;chunks.push(item.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes),data=JSON.parse(raw);
  return data&&typeof data==='object'&&!Array.isArray(data)?{raw,data}:null;
 }catch{return null;}finally{void reader.cancel().catch(()=>{});}
}
export function registerMusePersonalRoutes(app:Hono<AppContext>,deps:Deps){
 const base='/api/channels/:slug/bridges/muse-personal';
 const safe=(fn:(c:Ctx)=>Promise<Response>)=>async(c:Ctx)=>{c.header('cache-control','no-store');try{return await fn(c);}catch{return fail('personal_bridge_unavailable',503);}};
 app.get(base,safe(async c=>{const a=await deps.access(c,'manage');if(a instanceof Response)return a;
  if(c.env.MUSE_PERSONAL_BRIDGE_ENABLED!=='true')return c.json(personalStatus(false,null));
  const row=await c.env.DB.prepare('SELECT * FROM muse_personal_bindings WHERE channel_slug=? AND owner_account=?').bind(a.slug,a.identity.account!).first<PersonalBinding>();
  return c.json(personalStatus(true,row));}));
 app.put(base,safe(async c=>{const a=await deps.access(c,'manage');if(a instanceof Response)return a;
  if(c.env.MUSE_PERSONAL_BRIDGE_ENABLED!=='true')return fail('operator_setup_required',503);
  if(!await verifiedMfaOwner(c.env.DB,a.identity))return fail('mfa_required',403);
  if(!bridgeKey(c.env.MUSE_PERSONAL_BRIDGE_KEYS,a.slug))return fail('reporter_not_configured',503);
  const b=await body(c);if(!b||Object.keys(b.data).some(k=>!['account_label','sidechat_label','sidechat_id'].includes(k))||!text(b.data.account_label,80)||!text(b.data.sidechat_label,80)||typeof b.data.sidechat_id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(b.data.sidechat_id))return fail('invalid_binding');
  const id=crypto.randomUUID();await c.env.DB.prepare(`INSERT INTO muse_personal_bindings(channel_slug,owner_account,binding_id,account_label,sidechat_label,sidechat_id) VALUES(?,?,?,?,?,?) ON CONFLICT(channel_slug) DO UPDATE SET owner_account=excluded.owner_account,binding_id=excluded.binding_id,account_label=excluded.account_label,sidechat_label=excluded.sidechat_label,sidechat_id=excluded.sidechat_id,last_checked_at=NULL,report_state=NULL,reason=NULL`).bind(a.slug,a.identity.account!,id,b.data.account_label.trim(),b.data.sidechat_label.trim(),b.data.sidechat_id).run();
  return c.json({binding_id:id,state:'reconnect_required',actual_account_verified:false,evidence:'bridge_reported',end_to_end_verified:false});}));
 app.delete(base,safe(async c=>{const a=await deps.access(c,'manage');if(a instanceof Response)return a;
  if(c.env.MUSE_PERSONAL_BRIDGE_ENABLED!=='true')return fail('operator_setup_required',503);
  if(!await verifiedMfaOwner(c.env.DB,a.identity))return fail('mfa_required',403);
  await c.env.DB.prepare('DELETE FROM muse_personal_bindings WHERE channel_slug=? AND owner_account=?').bind(a.slug,a.identity.account!).run();return c.json({removed:true,state:'local_disconnected',provider_session_revoked:false});}));
 app.post(base+'/report',safe(async c=>{const a=await deps.access(c,'read');if(a instanceof Response)return a;
  if(c.env.MUSE_PERSONAL_BRIDGE_ENABLED!=='true')return fail('operator_setup_required',503);
  const key=bridgeKey(c.env.MUSE_PERSONAL_BRIDGE_KEYS,a.slug);
  if(!key||!a.channel.owner_account||a.identity.account!==a.channel.owner_account||a.channel.archived_at!==null||a.identity.kind!=='agent'||a.identity.role!=='agent'||a.identity.channel_scope!==a.slug||a.identity.name!==key.agent_name)return fail('reporter_not_allowed',403);
  const b=await body(c),ts=c.req.header('x-muse-timestamp')??'',nonce=c.req.header('x-muse-nonce')??'';
  if(!b||!await verifyPersonalReport(key.secret,a.slug,ts,nonce,b.raw,c.req.header('x-muse-signature')??''))return fail('invalid_report_signature',401);
  const d=b.data;if(Object.keys(d).some(k=>!['binding_id','state','reason'].includes(k))||typeof d.binding_id!=='string'||!['auth_required','ready_readonly','polling','reconnect_required','submission_unknown','disconnected'].includes(d.state)||!['ready','session_unavailable','transport_error','pending_verification'].includes(d.reason))return fail('invalid_report');
  const row=await c.env.DB.prepare('SELECT * FROM muse_personal_bindings WHERE channel_slug=? AND binding_id=? AND owner_account=?').bind(a.slug,d.binding_id,a.identity.account??'').first<PersonalBinding>();
  if(!row||Number(ts)<=(row.last_checked_at??0))return fail('binding_changed_or_stale_report',409);
  // The replay insert and conditional update are atomic in D1. No external side effects.
  try{const result=await c.env.DB.batch([
   c.env.DB.prepare('DELETE FROM muse_personal_report_nonces WHERE expires_at<?').bind(Date.now()),
   c.env.DB.prepare('INSERT INTO muse_personal_report_nonces(channel_slug,nonce,expires_at) VALUES(?,?,?)').bind(a.slug,nonce,Date.now()+120_000),
   c.env.DB.prepare('UPDATE muse_personal_bindings SET last_checked_at=?,report_state=?,reason=? WHERE channel_slug=? AND binding_id=? AND owner_account=? AND (last_checked_at IS NULL OR last_checked_at<?)').bind(Number(ts),d.state,d.reason,a.slug,d.binding_id,a.identity.account??'',Number(ts))]);
   if(result[2].meta.changes!==1)return fail('binding_changed_or_stale_report',409);
  }catch{return fail('report_conflict',409);}
  return c.json({accepted:true,state:d.state,actual_account_verified:false,evidence:'bridge_reported',end_to_end_verified:false});
 }));
}
