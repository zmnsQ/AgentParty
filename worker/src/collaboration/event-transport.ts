import type {AppEnv} from '../index';

export const EGRESS_URL='http://127.0.0.1:8798/deliver';
const reasons=new Set(['invalid_callback_url','callback_origin_not_approved','callback_policy_unconfigured',
 'callback_dns_timeout','callback_dns_failed','callback_address_blocked','callback_redirect_blocked',
 'callback_response_too_large','callback_network_failed','callback_timeout','callback_tls_peer_invalid',
 'callback_gateway_busy','callback_payload_too_large','callback_gateway_failed']);
export function hasPinnedCallbackTransport(env:AppEnv):boolean {
 return env.COLLABORATION_EVENTS_EGRESS_URL===EGRESS_URL &&
  /^[a-f0-9]{64}$/.test(env.COLLABORATION_EVENTS_EGRESS_TOKEN??'') &&
  env.COLLABORATION_EVENTS_EGRESS_POLICY==='public-https';
}
/** Authorizing a callback is separate from establishing the authenticated,
 * DNS-pinned network connection. Never guess an OpenAI callback hostname.
 * Public HTTPS mode is opt-in and only works through the protected gateway.
 */
export function validateCallbackTarget(input:unknown,env:AppEnv):string {
 if(typeof input!=='string'||input.length>2048||/[\\\x00-\x20\x7f]/.test(input))throw Error('invalid_callback_url');
 let u:URL;try{u=new URL(input);}catch{throw Error('invalid_callback_url');}
 if(u.protocol!=='https:'||u.username||u.password||u.hash||(u.port&&u.port!=='443')||
  !u.hostname.includes('.')||u.hostname.includes(':')||/^[\d.]+$/.test(u.hostname)||
  /\.(?:localhost|local|internal|lan|home|arpa)$/.test(u.hostname)||u.hostname.endsWith('.'))throw Error('invalid_callback_url');
 if(hasPinnedCallbackTransport(env))return u.href;
 // An incomplete relay config must never silently fall back to direct fetch.
 if(env.COLLABORATION_EVENTS_EGRESS_URL||env.COLLABORATION_EVENTS_EGRESS_TOKEN||env.COLLABORATION_EVENTS_EGRESS_POLICY)
  throw Error('callback_policy_unconfigured');
 let origins:unknown;try{origins=JSON.parse(env.COLLABORATION_EVENTS_ALLOWED_ORIGINS??'[]');}catch{ /* fail closed */ }
 if(!Array.isArray(origins)||!origins.includes(u.origin))throw Error('callback_origin_not_approved');
 return u.href;
}
async function boundedJson(response:Response):Promise<unknown>{
 const reader=response.body?.getReader();if(!reader)throw Error('callback_gateway_failed');
 const chunks:Uint8Array[]=[];let length=0;
 try{
  while(true){const r=await reader.read();if(r.done)break;length+=r.value.length;
   if(length>20_000)throw Error('callback_gateway_failed');chunks.push(r.value);}
 }finally{await reader.cancel().catch(()=>undefined);}
 const bytes=new Uint8Array(length);let off=0;for(const c of chunks){bytes.set(c,off);off+=c.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw Error('callback_gateway_failed');}
}
export async function postSignedCallback(env:AppEnv,url:string,init:RequestInit):Promise<Response>{
 validateCallbackTarget(url,env);
 if(!hasPinnedCallbackTransport(env))return fetch(url,{...init,redirect:'manual'});
 const headers=Object.fromEntries(new Headers(init.headers));
 if(init.method!=='POST'||typeof init.body!=='string')throw Error('callback_gateway_failed');
 let response:Response;
 try {response=await fetch(EGRESS_URL,{method:'POST',redirect:'manual',signal:init.signal,
  headers:{'content-type':'application/json','x-agentcommons-egress-token':env.COLLABORATION_EVENTS_EGRESS_TOKEN!},
  body:JSON.stringify({url,headers,body:init.body})});}
 catch(e){if(e instanceof Error&&e.name==='AbortError')throw e;throw Error('callback_gateway_failed');}
 const data=await boundedJson(response) as {status?:unknown;content_type?:unknown;body?:unknown;error?:unknown}|null;
 if(!response.ok){
  throw Error(data&&typeof data.error==='string'&&reasons.has(data.error)?data.error:'callback_gateway_failed');
 }
 if(!data||!Number.isInteger(data.status)||(data.status as number)<200||(data.status as number)>599||
  typeof data.body!=='string'||data.body.length>8192||typeof data.content_type!=='string'||data.content_type.length>256)
  throw Error('callback_gateway_failed');
 return new Response([204,205,304].includes(data.status as number)?null:data.body,
  {status:data.status as number,headers:{'content-type':data.content_type}});
}
