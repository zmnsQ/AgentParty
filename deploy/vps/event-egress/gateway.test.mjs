import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {publicIp,parseTarget,pinnedDestination,requestOptions,validateEnvelope,deliver,makeServer,EgressError,drainOnce} from './gateway.mjs';
const policy={mode:'public-https',origins:[]};
function envelope(url='https://callback.openai.com/events/abc%2Fdef?key=opaque'){
 return {url,body:JSON.stringify({type:'verification',challenge:'synthetic-challenge-123456789'}),headers:{
  'content-type':'application/json','webhook-id':'msg_verification_test',
  'webhook-timestamp':String(Math.floor(Date.now()/1000)),
  'webhook-signature':'v1,'+Buffer.alloc(32,1).toString('base64'),
  'x-mcp-subscription-id':'sub_test',
 }};
}
test('blocks private, local, metadata, documentation, multicast and IPv4-embedded IPv6 destinations',()=>{
 for(const ip of ['0.0.0.0','10.0.0.1','100.100.100.200','127.0.0.1','169.254.169.254','172.16.2.1',
  '192.168.1.1','192.0.0.9','192.0.2.1','198.18.1.2','198.51.100.1','203.0.113.5','224.0.0.1',
  '255.255.255.255','168.63.129.16','::','::1','::ffff:127.0.0.1','::ffff:8.8.8.8','fc00::1',
  'fe80::1','ff02::1','64:ff9b::808:808','2001:db8::1','2001::1','2002:0a00:0001::1','3fff::1','not-an-ip'])
  assert.equal(publicIp(ip),false,ip);
 for(const ip of ['1.1.1.1','8.8.8.8','104.18.32.7','2606:4700:4700::1111','2001:4860:4860::8888'])
  assert.equal(publicIp(ip),true,ip);
});
test('URL parser accepts genuine encoded callback paths, never IP literals, userinfo, non-HTTPS or nonstandard ports',()=>{
 assert.ok(parseTarget(envelope().url,policy).search.includes('key='));
 for(const u of ['http://callback.openai.com/events','https://callback.openai.com:8443/events','https://127.1/x',
  'https://2130706433/x','https://[::1]/x','https://user@callback.openai.com/x',
  'https://callback.openai.com/x#fragment','https://metadata.google.internal/x','https://localhost/x',
  'https://callback.openai.com./x','https://callback.openai.com\\@evil.com/x','https://foo.test/x'])
  assert.throws(()=>parseTarget(u,policy),EgressError,u);
 assert.throws(()=>parseTarget('https://callback.openai.com/x',{mode:'allowlist',origins:[]}),/not_approved/);
 assert.ok(parseTarget('https://callback.openai.com/x',{mode:'allowlist',origins:['https://callback.openai.com']}));
});
test('validates every DNS answer and pins the chosen address without a second lookup',async()=>{
 const url=parseTarget('https://callback.openai.com/events',policy);let calls=0;
 const pin=await pinnedDestination(url,async()=>{calls++;return[{address:'1.1.1.1',family:4}];});
 const opts=requestOptions(url,pin,{});
 assert.equal(opts.hostname,'callback.openai.com');assert.equal(opts.servername,'callback.openai.com');
 assert.equal(opts.rejectUnauthorized,true);assert.equal(opts.agent,false);
 const answer=await new Promise((resolve,reject)=>opts.lookup(url.hostname,{},(err,a,f)=>err?reject(err):resolve([a,f])));
 assert.deepEqual(answer,['1.1.1.1',4]);assert.equal(calls,1);
 assert.equal(opts._peerMatches({remoteAddress:'1.1.1.1'}),true);
 assert.equal(opts._peerMatches({remoteAddress:'127.0.0.1'}),false);
 assert.equal(opts._peerMatches({remoteAddress:'8.8.8.8'}),false);
 await assert.rejects(pinnedDestination(url,async()=>[{address:'1.1.1.1',family:4},{address:'10.0.0.5',family:4}]),/address_blocked/);
 await assert.rejects(pinnedDestination(url,async()=>[]),/dns_failed/);
});
test('never forwards human auth, cookies, proxy authorization, or caller-controlled host headers',()=>{
 for(const key of ['authorization','cookie','host','proxy-authorization','x-api-key']){
  const e=envelope();e.headers[key]='sensitive';assert.throws(()=>validateEnvelope(e,policy),/invalid_headers/);
 }
 const a=envelope();a.headers['webhook-id']='x\r\nAuthorization: secret';assert.throws(()=>validateEnvelope(a,policy),/invalid_headers/);
 assert.equal(validateEnvelope(envelope(),policy).verification,true);
});
test('only valid signed verification/event envelopes with bounded body and fresh timestamp are eligible',()=>{
 const e=envelope();e.headers['webhook-timestamp']='1000000000';assert.throws(()=>validateEnvelope(e,policy),/timestamp/);
 const x=envelope();x.body='A'.repeat(262145);assert.throws(()=>validateEnvelope(x,policy),/too_large/);
 const y=envelope();y.body=JSON.stringify({command:'arbitrary'});assert.throws(()=>validateEnvelope(y,policy),/invalid_payload/);
 const z=envelope();z.body=JSON.stringify({eventId:'different',name:'message.created',data:{}});assert.throws(()=>validateEnvelope(z,policy),/invalid_event_id/);
});
function fakeRequest(status,body,seen){
 return (opts,onResponse)=>{
  seen.push(opts);const req=new EventEmitter();req.destroy=()=>{};
  req.end=sent=>queueMicrotask(()=>{
   const socket=new EventEmitter();socket.authorized=true;socket.remoteAddress='1.1.1.1';
   req.emit('socket',socket);socket.emit('secureConnect');
   const res=new EventEmitter();res.statusCode=status;res.headers={'content-type':'application/json'};res.destroy=()=>{};
   onResponse(res);res.emit('data',Buffer.from(body));res.emit('end');
  });return req;
 };
}
test('delivery uses exactly one pinned TLS request and refuses redirects',async()=>{
 const seen=[],deps={lookup:async()=>[{address:'1.1.1.1',family:4}],request:fakeRequest(200,'{"challenge":"synthetic"}',seen)};
 assert.equal((await deliver(envelope(),policy,deps)).status,200);
 assert.equal(seen.length,1);assert.equal(seen[0].servername,'callback.openai.com');
 await assert.rejects(deliver(envelope(),policy,{...deps,request:fakeRequest(302,'',seen)}),/redirect_blocked/);
 assert.equal(seen.length,2); // No third request to the redirect Location.
});
test('loopback gateway authenticates before any network access and does not relay credentials',async()=>{
 const token='a'.repeat(64);let calls=0;
 const server=makeServer({token,policy,transport:async(value,pol)=>{calls++;validateEnvelope(value,pol);return{status:200,content_type:'application/json',body:'{"challenge":"synthetic"}'};}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await fetch(base+'/deliver',{method:'POST',body:'{}'})).status,401);
  assert.equal(calls,0);
  const result=await fetch(base+'/deliver',{method:'POST',headers:{'content-type':'application/json','x-agentcommons-egress-token':token},body:JSON.stringify(envelope())});
  assert.equal(result.status,200);assert.equal((await result.json()).status,200);assert.equal(calls,1);
  assert.equal((await fetch(base+'/anything')).status,404);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('drainer only requests queued-delivery maintenance, never source messages or new subscriptions',async()=>{
 const token='a'.repeat(64);let calls=0;
 const result=await drainOnce(token,async(url,options)=>{
  calls++;assert.equal(url,'http://127.0.0.1:8787/internal/mcp-events/drain');
  assert.equal(options.headers['x-agentcommons-egress-token'],token);assert.equal(options.body,'{}');
  assert.equal(options.redirect,'error');return Response.json({attempted:2,delivered:1});
 });assert.deepEqual(result,{attempted:2,delivered:1});assert.equal(calls,1);
});
