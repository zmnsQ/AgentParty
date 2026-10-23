import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {profileName} from './agentcommons.mjs';
const script=fileURLToPath(new URL('./agentcommons.mjs',import.meta.url)),token='ap_'+'q'.repeat(48);
const waitFor=async(predicate,message)=>{const end=Date.now()+8000;while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,25));}throw Error(message);};
const run=(args,env,input='')=>new Promise(resolve=>{const p=spawn(process.execPath,[script,...args],{env});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('exit',code=>resolve({code,out,err}));p.stdin.end(input);});
async function setup(fn){
 const home=mkdtempSync(join(tmpdir(),'commons-events-')),env={...process.env,HOME:home,USERPROFILE:home,AGENT_COMMONS_HOME:join(home,'.agentcommons')};delete env.AGENT_COMMONS_TOKEN;
 const calls=[],streams=[];let deny=false;
 const server=createServer(async(req,res)=>{let text='';for await(const b of req)text+=b;const message=text?JSON.parse(text):{};calls.push({url:req.url,method:message.method,params:message.params});
 if(req.url==='/api/me'){res.setHeader('content-type','application/json');res.end(JSON.stringify({name:'tester',kind:'agent',role:'agent',channel_scope:'group',owner:'owner'}));return;}
 if(message.method==='events/stream'){
  if(deny){res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({error:'denied'}));return;}
  res.writeHead(200,{'content-type':'text/event-stream'});const send=v=>res.write('event: message\ndata: '+JSON.stringify(v)+'\n\n');
  send({jsonrpc:'2.0',method:'notifications/events/active',params:{cursor:message.params.cursor??'cs_test_0',truncated:false}});streams.push({res,send,closed:false});req.on('close',()=>{const s=streams.find(s=>s.res===res);if(s)s.closed=true;});return;
 }
 res.setHeader('content-type','application/json');const result=message.method==='initialize'?{protocolVersion:'2025-06-18',serverInfo:{name:'agent-commons',version:'test'},capabilities:{tools:{}}}:message.method==='events/list'?{events:[{name:'message.mentioned',delivery:['push']}]}:message.method==='tools/list'?{tools:[{name:'commons_profile',inputSchema:{type:'object'},annotations:{readOnlyHint:true}},{name:'commons_read_messages',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:JSON.stringify({name:'tester',channel:'group',automatic_wake:false})}],structuredContent:{name:'tester',channel:'group',automatic_wake:false}};
 res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,profile=profileName({server:origin,channel:'group',name:'tester',client:'codebuddy'});
 const connect=async(mode='channel')=>{const r=await run(['connect','--server',origin,'--allow-localhost','--channel','group','--name','tester','--client','codebuddy','--manual','--events',mode,'--yes','--token-stdin'],env,token);assert.equal(r.code,0,r.err);};
 const children=[];
 const host=()=>{const child=spawn(process.execPath,[script,'mcp','--profile',profile],{env});children.push(child);const lines=[];let buf='',err='';child.stdout.on('data',b=>{buf+=b;let i;while((i=buf.indexOf('\n'))>=0){lines.push(JSON.parse(buf.slice(0,i)));buf=buf.slice(i+1);}});child.stderr.on('data',b=>err+=b);const send=m=>child.stdin.write(JSON.stringify(m)+'\n');send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'CodeBuddy',version:'test'}}});return {child,lines,send,errors:()=>err};};
 try{await fn({env,home,origin,profile,calls,streams,connect,host,deny:()=>{deny=true;}});}finally{for(const p of children){p.stdin.end();p.kill('SIGTERM');}for(const s of streams)s.res.end();await new Promise(r=>server.close(r));rmSync(home,{recursive:true,force:true});}
}
const event=(seq)=>({jsonrpc:'2.0',method:'notifications/events/event',params:{eventId:'group:'+seq,name:'message.mentioned',cursor:'cs_test_'+seq,timestamp:new Date().toISOString(),data:{channel_id:'group',message_seq:seq,sender_name:'owner',sender_kind:'human',message_url:'https://example.test/c/group?seq='+seq}}});
test('channel receives server-initiated SSE events, not message tool polling',()=>setup(async f=>{
 await f.connect();const h=f.host();await waitFor(()=>h.lines.some(x=>x.id===1),'initialize');assert.deepEqual(h.lines[0].result.capabilities.experimental,{'claude/channel':{}});
 h.send({jsonrpc:'2.0',method:'notifications/initialized'});await waitFor(()=>f.streams.length===1,'SSE opened');f.streams[0].send(event(1));
 await waitFor(()=>h.lines.some(x=>x.method==='notifications/claude/channel'),'channel notification');const pushed=h.lines.find(x=>x.method==='notifications/claude/channel');assert.equal(pushed.params.meta.message_seq,'1');assert.match(pushed.params.content,/does not grant/);
 f.streams[0].send(event(1));await new Promise(r=>setTimeout(r,100));assert.equal(h.lines.filter(x=>x.method==='notifications/claude/channel').length,1);
 assert.equal(f.calls.filter(x=>x.method==='events/stream').length,1);assert.equal(f.calls.filter(x=>x.method==='tools/call').length,0);assert.ok(!JSON.stringify(h.lines).includes(token));
 h.send({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'commons_event_status',arguments:{}}});await waitFor(()=>h.lines.some(x=>x.id===3),'status');assert.equal(h.lines.find(x=>x.id===3).result.structuredContent.connection,'active');
 const exited=new Promise(r=>h.child.once('exit',r));h.child.stdin.end();await exited;assert.equal(JSON.parse(readFileSync(join(f.env.AGENT_COMMONS_HOME,'events',f.profile+'.status.json'))).connection,'stopped');
}));
test('reconnection resumes a cursor and delivers only new event references',()=>setup(async f=>{
 await f.connect();const h=f.host();await waitFor(()=>h.lines.length,'initialize');h.send({jsonrpc:'2.0',method:'notifications/initialized'});await waitFor(()=>f.streams.length===1,'open');f.streams[0].send(event(1));await waitFor(()=>h.lines.some(x=>x.method==='notifications/claude/channel'),'first event');f.streams[0].res.end();await waitFor(()=>f.streams.length===2,'reconnect');assert.equal(f.calls.filter(x=>x.method==='events/stream')[1].params.cursor,'cs_test_1');f.streams[1].send(event(2));await waitFor(()=>h.lines.filter(x=>x.method==='notifications/claude/channel').length===2,'second event');
}));
test('disabled channel never opens a stream or claims host activation',()=>setup(async f=>{
 await f.connect('off');const h=f.host();await waitFor(()=>h.lines.length,'initialize');assert.equal(h.lines[0].result.capabilities.experimental,undefined);h.send({jsonrpc:'2.0',method:'notifications/initialized'});await new Promise(r=>setTimeout(r,150));assert.equal(f.streams.length,0);
}));
test('HTTP 403 stops the listener without retry, token leaks or model launch',()=>setup(async f=>{
 await f.connect();f.deny();const h=f.host();await waitFor(()=>h.lines.length,'initialize');h.send({jsonrpc:'2.0',method:'notifications/initialized'});await waitFor(()=>h.errors().includes('listener stopped'),'denied');await new Promise(r=>setTimeout(r,200));assert.equal(f.calls.filter(x=>x.method==='events/stream').length,1);assert.ok(!h.errors().includes(token));assert.equal(h.lines.some(x=>x.method==='notifications/claude/channel'),false);
}));
test('existing profiles can enable delivery explicitly without rotating credentials',()=>setup(async f=>{
 await f.connect('off');const p=join(f.env.AGENT_COMMONS_HOME,'profiles',f.profile+'.json');const before=JSON.parse(readFileSync(p));
 const no=await run(['events','enable','--profile',f.profile],f.env);assert.equal(no.code,1);
 const yes=await run(['events','enable','--profile',f.profile,'--yes','--senders','owner,reviewer'],f.env);assert.equal(yes.code,0,yes.err);const after=JSON.parse(readFileSync(p));assert.equal(after.token,before.token);assert.deepEqual(after.events,{mode:'channel',senders:['owner','reviewer']});assert.equal(f.streams.length,0);
}));
