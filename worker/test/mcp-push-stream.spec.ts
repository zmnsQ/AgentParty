import {env} from 'cloudflare:test';
import {describe,it,expect} from 'vitest';
import {api,createChannel,seedToken,uniq} from './helpers';
import {enableMcpFixture} from './mcp-test-helpers';
import {pushMatches,pushArguments,pushSocketUrl} from '../src/collaboration/mcp-event-stream';
import {nativeCliRedirect} from '../src/collaboration/native-cli';
async function fixture(){const account=uniq('push-owner'),owner=await seedToken('human',uniq('owner'),{owner:account});const slug=await createChannel(owner.token);await enableMcpFixture(slug,account);const agent=await seedToken('agent',uniq('push-agent'),{owner:account,channelScope:slug});return {account,owner,slug,agent};}
async function open(f:Awaited<ReturnType<typeof fixture>>,cursor?:string,extra:Record<string,unknown>={}){
 const res=await api(`/api/channels/${f.slug}/mcp`,f.agent.token,{method:'POST',headers:{accept:'text/event-stream','mcp-protocol-version':'2026-07-28'},body:JSON.stringify({jsonrpc:'2.0',id:'push-test',method:'events/stream',params:{name:'message.mentioned',arguments:{channel_id:f.slug,...extra},...(cursor?{cursor}:{})}})});
 expect(res.status).toBe(200);expect(res.headers.get('content-type')).toContain('text/event-stream');const reader=res.body!.getReader();const decoder=new TextDecoder();let buffer='';
 const next=async():Promise<any>=>{for(;;){const at=buffer.indexOf('\n\n');if(at>=0){const raw=buffer.slice(0,at);buffer=buffer.slice(at+2);const data=raw.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5)).join('\n');if(data)return JSON.parse(data);continue;}const part=await reader.read();if(part.done)throw Error('Stream ended');buffer+=decoder.decode(part.value,{stream:true});}};
 return {next,close:()=>reader.cancel()};
}
const mention=async(f:Awaited<ReturnType<typeof fixture>>,body='reference only')=>{const r=await api(`/api/channels/${f.slug}/messages`,f.owner.token,{method:'POST',body:JSON.stringify({kind:'message',body,mentions:[f.agent.name],reply_to:null})});expect(r.status).toBe(200);return await r.json() as {seq:number};};
describe('actual DO WebSocket to MCP event stream',()=>{
 it('activates without history, pushes a new mention and does not expose message text',async()=>{const f=await fixture();await mention(f,'OLD-PRIVATE-BODY');const stream=await open(f);try{const active=await stream.next();expect(active.method).toBe('notifications/events/active');const posted=await mention(f,'NEW-PRIVATE-BODY');const event=await stream.next();expect(event.method).toBe('notifications/events/event');expect(event.params.data.channel_id).toBe(f.slug);expect(event.params.data.sender_name).toBe(f.owner.name);expect(event.params._meta['io.modelcontextprotocol/subscriptionId']).toBe('push-test');expect(JSON.stringify(event)).not.toContain('PRIVATE-BODY');expect(event.params.cursor).not.toBe(active.params.cursor);}finally{await stream.close();}});
 it('resumes missed references from its cursor, but refuses another group cursor',async()=>{const f=await fixture();const first=await open(f);const active=await first.next();await first.close();await mention(f);const second=await open(f,active.params.cursor);try{expect((await second.next()).method).toBe('notifications/events/active');expect((await second.next()).method).toBe('notifications/events/event');}finally{await second.close();}const g=await fixture();const r=await api(`/api/channels/${g.slug}/mcp`,g.agent.token,{method:'POST',headers:{accept:'text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:3,method:'events/stream',params:{name:'message.mentioned',arguments:{channel_id:g.slug},cursor:active.params.cursor}})});expect(r.status).toBe(400);});
 it('checks event permission before opening and revocation before each delivery',async()=>{const f=await fixture();await env.DB.prepare('UPDATE channel_mcp_security SET allow_events=0 WHERE channel_slug=?').bind(f.slug).run();const denied=await api(`/api/channels/${f.slug}/mcp`,f.agent.token,{method:'POST',headers:{accept:'text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'events/stream',params:{name:'message.mentioned',arguments:{channel_id:f.slug}}})});expect(denied.status).toBe(403);await env.DB.prepare('UPDATE channel_mcp_security SET allow_events=1 WHERE channel_slug=?').bind(f.slug).run();const stream=await open(f);try{await stream.next();await env.DB.prepare('UPDATE channel_mcp_security SET allow_events=0 WHERE channel_slug=?').bind(f.slug).run();await mention(f);const last=await stream.next();expect(last.error.code).toBe(-32001);}finally{await stream.close();}});
 it('makes progress through a retained backlog larger than its bounded event batch',async()=>{
 const f=await fixture(),initial=await open(f);let cursor=(await initial.next()).params.cursor;await initial.close();
 // Historical backlogs can contain many independently authenticated sessions;
 // do not disable the production per-sender burst limiter to generate a fixture.
 let writer=f.owner;
 for(let i=0;i<70;i++){if(i%5===0)writer=await seedToken('human',uniq('backlog-session'),{owner:f.account});const r=await api(`/api/channels/${f.slug}/messages`,writer.token,{method:'POST',body:JSON.stringify({kind:'message',body:'backlog '+i,mentions:[],reply_to:null})});expect(r.status,r.status===200?'':await r.text()).toBe(200);}
 await mention(f,'LAST-REFERENCE');let delivered=false;
 for(let attempt=0;attempt<3&&!delivered;attempt++){const stream=await open(f,cursor);try{await stream.next();for(;;){const frame=await stream.next();if(frame.params?.cursor)cursor=frame.params.cursor;if(frame.method==='notifications/events/event'){delivered=true;break;}}}catch(e){if(!(e instanceof Error)||e.message!=='Stream ended')throw e;}finally{await stream.close();}}
 expect(delivered).toBe(true);
 });
 it('advertises push independently of webhook and keeps legacy tools callable',async()=>{const f=await fixture();const rpc=async(method:string,params={})=>(await api(`/api/channels/${f.slug}/mcp`,f.agent.token,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})).json() as Promise<any>;
 const catalog=await rpc('events/list');expect(catalog.result.events.some((e:any)=>e.name==='message.mentioned'&&e.delivery.includes('push'))).toBe(true);expect(catalog.result.events.some((e:any)=>e.name==='message.created'&&e.delivery.includes('webhook'))).toBe(true);
 const tools=await rpc('tools/list');expect(tools.result.tools.some((t:any)=>t.name==='commons_profile')).toBe(true);
 for(const name of ['commons_profile','party_profile'])expect((await rpc('tools/call',{name,arguments:{}})).result.structuredContent.channel).toBe(f.slug);
 });
});
describe('push sender and callback security',()=>{
 it('keeps the public host in internal WebSocket requests so existing webhook links are not overwritten',()=>{expect(pushSocketUrl('https://commons.test','group')).toBe('https://commons.test/api/channels/group/ws');});
 const frame={type:'msg',kind:'message',seq:1,mentions:['target'],sender:{name:'human-session',kind:'human',owner:'owner'}};
 it('defaults to exact owner-human mentions and blocks self, outsiders and text-only mentions',()=>{
 expect(pushMatches(frame,'target','owner',[])).toBe(true);expect(pushMatches(frame,'target','other',[])).toBe(false);
 expect(pushMatches({...frame,sender:{name:'target',kind:'agent',owner:'owner'}},'target','owner',['target'])).toBe(false);
 expect(pushMatches({...frame,mentions:[],body:'@target'},'target','owner',[])).toBe(false);
 expect(pushMatches({...frame,sender:{name:'other-agent',kind:'agent',owner:'owner'}},'target','owner',[])).toBe(false);
 expect(pushMatches({...frame,sender:{name:'other-agent',kind:'agent',owner:'owner'}},'target','owner',['other-agent'])).toBe(true);
 });
 it('rejects wildcard filters, another room and arbitrary extra parameters',()=>{for(const params of [{name:'message.mentioned',arguments:{channel_id:'other'}},{name:'message.mentioned',arguments:{channel_id:'group',mention_only:false}},{name:'message.mentioned',arguments:{channel_id:'group',sender_names:[]}},{name:'message.mentioned',arguments:{channel_id:'group'},delivery:{url:'http://internal'}}])expect(pushArguments(params,'group')).toBeNull();});
 it('accepts exact loopback native callbacks only, not local-network or lookalike hosts',()=>{
 for(const u of ['http://127.0.0.1:54321/callback','http://[::1]:1234/callback','http://localhost:1111/callback/abc'])expect(nativeCliRedirect(u)).toBe(true);
 for(const u of ['http://127.0.0.1.evil.test/callback','http://192.168.1.1/callback','http://user@localhost:3/callback','http://localhost:3/','http://localhost:3/callback?x=1','http://localhost:3/callback#x','http://127.1/callback','http://localhost./callback','http://localhost:3/not-callback'])expect(nativeCliRedirect(u)).toBe(false);
 });
});
