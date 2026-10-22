/** Agent Commons by zmnsQ, based on AgentParty. BUSL-1.1.
 * Loopback-only callback transport. It never loads user tokens or signs events.
 * Resolve on every request, reject non-public DNS answers, and pin TLS to a
 * validated address while verifying the original DNS hostname. No redirects.
 */
import {createServer} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {lookup as dnsLookup} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import {timingSafeEqual,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const PORT=8798;
const MAX_BODY=262144,MAX_ENVELOPE=400000,MAX_REPLY=8192;
const denied4=new BlockList(),denied6=new BlockList(),global6=new BlockList();
// Conservatively exclude all IANA IPv4 special-purpose and multicast ranges.
for(const [ip,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
 ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],
 ['192.31.196.0',24],['192.52.193.0',24],['192.88.99.0',24],['192.168.0.0',16],
 ['192.175.48.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],
 ['224.0.0.0',4],['240.0.0.0',4]])denied4.addSubnet(ip,prefix,'ipv4');
denied4.addAddress('168.63.129.16','ipv4'); // Azure platform virtual IP, not a callback.
global6.addSubnet('2000::',3,'ipv6');
for(const [ip,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20],['2620:4f:8000::',48]])
 denied6.addSubnet(ip,prefix,'ipv6');
export class EgressError extends Error { constructor(code){super(code);this.name='EgressError';} }
const fail=code=>{throw new EgressError(code);};
export function publicIp(address){
 const family=isIP(address);
 return family===4?!denied4.check(address,'ipv4'):family===6&&global6.check(address,'ipv6')&&!denied6.check(address,'ipv6');
}
export function parseTarget(raw,policy){
 if(typeof raw!=='string'||raw.length>2048||/[\\\x00-\x20\x7f]/.test(raw))fail('invalid_callback_url');
 let u;try{u=new URL(raw);}catch{fail('invalid_callback_url');}
 if(u.protocol!=='https:'||u.username||u.password||u.hash||(u.port&&u.port!=='443')||
  isIP(u.hostname.replace(/^\[|\]$/g,''))||!u.hostname.includes('.')||u.hostname.endsWith('.')||
  !/^[a-z0-9.-]+$/.test(u.hostname)||u.hostname.split('.').some(s=>!s||s.length>63||s.startsWith('-')||s.endsWith('-'))||
  /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion|arpa)$/.test(u.hostname))fail('invalid_callback_url');
 if(policy.mode==='allowlist'){
  if(!policy.origins.includes(u.origin))fail('callback_origin_not_approved');
 }else if(policy.mode!=='public-https')fail('callback_policy_unconfigured');
 return u;
}
export async function pinnedDestination(url,lookup=dnsLookup){
 let timer;
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new EgressError('callback_dns_timeout')),2500);});
 let records;
 try {records=await Promise.race([lookup(url.hostname,{all:true,verbatim:true}),timeout]);}
 catch(e){if(e instanceof EgressError)throw e;fail('callback_dns_failed');}
 finally{clearTimeout(timer);}
 if(!Array.isArray(records)||records.length===0||records.length>64)fail('callback_dns_failed');
 // Reject mixed answers as well; never fall back to an unvalidated address.
 if(records.some(x=>!publicIp(x.address)||isIP(x.address)!==x.family))fail('callback_address_blocked');
 return records.find(x=>x.family===4)??records[0];
}
export function requestOptions(url,pin,headers){
 const pair=new BlockList();pair.addAddress(pin.address,pin.family===4?'ipv4':'ipv6');
 return {protocol:'https:',hostname:url.hostname,port:443,path:url.pathname+url.search,
  method:'POST',servername:url.hostname,rejectUnauthorized:true,agent:false,autoSelectFamily:false,
  headers:{...headers,host:url.host},
  // This closure NEVER performs another DNS resolution (prevents rebinding).
  lookup:(hostname,options,callback)=>{
   if(hostname!==url.hostname)return callback(new EgressError('callback_hostname_changed'));
   if(options?.all)return callback(null,[pin]);
   callback(null,pin.address,pin.family);
  },
  _peerMatches:socket=>publicIp(socket.remoteAddress??'')&&pair.check(socket.remoteAddress,
   isIP(socket.remoteAddress)===6?'ipv6':'ipv4'),
 };
}
export function validateEnvelope(value,policy){
 if(!value||typeof value!=='object'||Array.isArray(value)||
  Object.keys(value).some(k=>!['url','headers','body'].includes(k)))fail('invalid_envelope');
 const url=parseTarget(value.url,policy);
 if(typeof value.body!=='string'||Buffer.byteLength(value.body)>MAX_BODY)fail('callback_payload_too_large');
 let body;try{body=JSON.parse(value.body);}catch{fail('invalid_payload');}
 if(!body||typeof body!=='object'||Array.isArray(body))fail('invalid_payload');
 const verification=body.type==='verification';
 if(verification){
  if(typeof body.challenge!=='string'||body.challenge.length<16||body.challenge.length>128||
   Object.keys(body).some(k=>!['type','challenge'].includes(k)))fail('invalid_payload');
 }else if(body.name!=='message.created'||typeof body.eventId!=='string'||!body.data||typeof body.data!=='object')fail('invalid_payload');
 const expected=['content-type','webhook-id','webhook-timestamp','webhook-signature','x-mcp-subscription-id'];
 if(!value.headers||typeof value.headers!=='object'||Array.isArray(value.headers))fail('invalid_headers');
 const headers={};
 for(const [key,val]of Object.entries(value.headers)){
  const k=key.toLowerCase();
  if(!expected.includes(k)||k in headers||typeof val!=='string'||val.length>512||/[\r\n\x00]/.test(val))fail('invalid_headers');
  headers[k]=val;
 }
 if(Object.keys(headers).length!==expected.length||headers['content-type']!=='application/json'||
  !/^[A-Za-z0-9_-]{1,160}$/.test(headers['webhook-id'])||
  !/^sub_[A-Za-z0-9_-]{1,128}$/.test(headers['x-mcp-subscription-id'])||
  !/^\d{10,12}$/.test(headers['webhook-timestamp'])||
  !/^v1,[A-Za-z0-9+/]+={0,2}(?: v1,[A-Za-z0-9+/]+={0,2})?$/.test(headers['webhook-signature']))fail('invalid_headers');
 if(Math.abs(Date.now()/1000-Number(headers['webhook-timestamp']))>300)fail('invalid_timestamp');
 if(!verification&&headers['webhook-id']!==body.eventId)fail('invalid_event_id');
 return {url,headers,body:value.body,verification};
}
export async function deliver(envelope,policy,{lookup=dnsLookup,request=httpsRequest}={}){
 const valid=validateEnvelope(envelope,policy),pin=await pinnedDestination(valid.url,lookup);
 const { _peerMatches,...options}=requestOptions(valid.url,pin,valid.headers);
 return new Promise((resolve,reject)=>{
  let done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const req=request(options,res=>{
   const status=res.statusCode??502;
   if(status>=300&&status<400){res.destroy();finish(new EgressError('callback_redirect_blocked'));return;}
   const chunks=[];let size=0;
   res.on('data',chunk=>{size+=chunk.length;if(size>MAX_REPLY){res.destroy();finish(new EgressError('callback_response_too_large'));}else chunks.push(chunk);});
   res.on('end',()=>finish(null,{status,content_type:String(res.headers['content-type']??''),body:Buffer.concat(chunks).toString('utf8')}));
   res.on('error',()=>finish(new EgressError('callback_network_failed')));
  });
  const timer=setTimeout(()=>{req.destroy();finish(new EgressError('callback_timeout'));},6500);
  req.on('socket',socket=>socket.once('secureConnect',()=>{
   if(!socket.authorized||!_peerMatches(socket)){req.destroy();finish(new EgressError('callback_tls_peer_invalid'));}
  }));
  req.on('error',error=>finish(error instanceof EgressError?error:new EgressError('callback_network_failed')));
  req.end(valid.body);
 });
}
function authorized(actual,secret){
 if(typeof actual!=='string'||actual.length>256)return false;
 const hash=s=>createHash('sha256').update(s).digest();
 return timingSafeEqual(hash(actual),hash(secret));
}
function json(res,status,data){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));}
export function makeServer({token,policy,transport=deliver}){
 if(!/^[a-f0-9]{64}$/.test(token))throw new Error('event_egress_token_required');
 if(!['allowlist','public-https'].includes(policy.mode))throw new Error('event_egress_policy_required');
 let inflight=0;
 const server=createServer(async(req,res)=>{
  if(req.url==='/health'&&req.method==='GET'){json(res,200,{ok:true,transport:'dns-pinned-https',mode:policy.mode});return;}
  if(req.method!=='POST'||req.url!=='/deliver'){json(res,404,{error:'not_found'});return;}
  if(!authorized(req.headers['x-agentcommons-egress-token'],token)){json(res,401,{error:'unauthorized'});req.resume();return;}
  if(inflight>=4){json(res,429,{error:'callback_gateway_busy'});req.resume();return;}
  if(Number(req.headers['content-length']??0)>MAX_ENVELOPE){json(res,413,{error:'callback_payload_too_large'});req.resume();return;}
  if(req.headers['content-type']!=='application/json'){json(res,415,{error:'invalid_content_type'});req.resume();return;}
  inflight++;
  try{
   const chunks=[];let n=0;
   for await(const chunk of req){n+=chunk.length;if(n>MAX_ENVELOPE)fail('callback_payload_too_large');chunks.push(chunk);}
   let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('invalid_envelope');}
   const response=await transport(data,policy);
   json(res,200,response);
  }catch(error){
   const reason=error instanceof EgressError?error.message:'callback_gateway_failed';
   // Never print a destination URL, user content or any incoming/outgoing headers.
   console.warn(JSON.stringify({event:'mcp_callback_transport_rejected',reason}));
   if(!res.headersSent)json(res,502,{error:reason});else res.destroy();
  }finally{inflight--;}
 });
 server.requestTimeout=12000;server.headersTimeout=5000;server.keepAliveTimeout=1000;
 return server;
}
export async function drainOnce(token,fetcher=fetch){
 if(!/^[a-f0-9]{64}$/.test(token))throw Error('invalid_drain_credential');
 const response=await fetcher('http://127.0.0.1:8787/internal/mcp-events/drain',{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(24000),
  headers:{'x-agentcommons-egress-token':token,'content-type':'application/json'},body:'{}',
 });
 if(!response.ok)throw Error('event_drain_unavailable');
 const result=await response.json();
 if(!Number.isSafeInteger(result?.attempted)||!Number.isSafeInteger(result?.delivered))throw Error('event_drain_unavailable');
 return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const origins=JSON.parse(process.env.EVENT_EGRESS_ALLOWED_ORIGINS??'[]');
 if(!Array.isArray(origins)||origins.some(x=>typeof x!=='string'))throw Error('invalid_allowlist');
 const server=makeServer({token:process.env.EVENT_EGRESS_TOKEN??'',policy:{mode:process.env.EVENT_EGRESS_MODE??'allowlist',origins}});
 server.listen(PORT,'127.0.0.1',()=>console.log(JSON.stringify({event:'mcp_callback_transport_ready',port:PORT})));
 let inProgress=false,failures=0;
 const retryTimer=process.env.EVENT_DRAIN_ENABLED==='true'?setInterval(async()=>{
  if(inProgress)return;inProgress=true;
  try{const result=await drainOnce(process.env.EVENT_EGRESS_TOKEN);failures=0;
   if(result.attempted)console.log(JSON.stringify({event:'mcp_outbox_retry',...result}));
  }catch{if(++failures===1||failures%10===0)console.warn(JSON.stringify({event:'mcp_outbox_retry_unavailable'}));}
  finally{inProgress=false;}
 },30000):null;
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{if(retryTimer)clearInterval(retryTimer);server.close(()=>process.exit(0));});
}
