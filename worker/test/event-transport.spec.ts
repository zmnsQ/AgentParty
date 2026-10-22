import {env,createExecutionContext,waitOnExecutionContext} from 'cloudflare:test';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {fetchMock} from './fetch-mock';
import {seedToken,createChannel,uniq} from './helpers';
import {enableMcpFixture} from './mcp-test-helpers';
import {sha256Hex,type TokenIdentity} from '../src/auth';
import worker,{type AppEnv} from '../src/index';
import {mcpEventMethod,enqueueMcpEvent,deliverMcpEvents,mcpEventReadiness} from '../src/collaboration/mcp-events';
import {EGRESS_URL,hasPinnedCallbackTransport,validateCallbackTarget,postSignedCallback} from '../src/collaboration/event-transport';

const TOKEN='a'.repeat(64),CALLBACK='https://hooks.openai.com/events/callback%2Fid?opaque=fixture';
const SECRET='whsec_'+btoa('fixture-key-with-32-characters!!!');
const configured={...env,COLLABORATION_EVENTS_EGRESS_URL:EGRESS_URL,COLLABORATION_EVENTS_EGRESS_TOKEN:TOKEN,
 COLLABORATION_EVENTS_EGRESS_POLICY:'public-https',COLLABORATION_EVENTS_ALLOWED_ORIGINS:'[]'} as AppEnv;
beforeEach(()=>{fetchMock.activate();fetchMock.disableNetConnect();});
afterEach(()=>{try{fetchMock.assertNoPendingInterceptors();}finally{fetchMock.deactivate();}});
async function group(){
 const account=uniq('relay-owner'),human=await seedToken('human',uniq('h'),{owner:account});
 const slug=await createChannel(human.token);await enableMcpFixture(slug,account);
 const agent=await seedToken('agent',uniq('relay-agent'),{owner:account,channelScope:slug});
 const identity:TokenIdentity={name:agent.name,kind:'agent',role:'agent',hash:await sha256Hex(agent.token),owner:account,account,channel_scope:slug};
 return {slug,identity,human};
}
const params=(slug:string)=>({name:'message.created',arguments:{channel_id:slug},ttlMs:null,
 delivery:{mode:'webhook',url:CALLBACK,secret:SECRET}});
function verification(){
 fetchMock.get('http://127.0.0.1:8798').intercept({path:'/deliver',method:'POST'}).reply(200,request=>{
  expect(request.headers['x-agentcommons-egress-token']).toBe(TOKEN);
  const p=JSON.parse(request.body),body=JSON.parse(p.body);
  expect(p.url).toBe(CALLBACK);expect(p.headers['authorization']).toBeUndefined();
  expect(p.headers['x-agentcommons-egress-token']).toBeUndefined();
  expect(body.type).toBe('verification');
  return {status:200,content_type:'application/json',body:JSON.stringify({challenge:body.challenge})};
 });
}
async function drain(config:AppEnv,supplied?:string){
 const ctx=createExecutionContext();
 const response=await worker.fetch(new Request('http://127.0.0.1:8787/internal/mcp-events/drain',{
  method:'POST',headers:{'content-type':'application/json',...(supplied?{'x-agentcommons-egress-token':supplied}:{})},body:'{}'}),config,ctx);
 await waitOnExecutionContext(ctx);return response;
}
describe('secure DNS-pinned MCP callback relay',()=>{
 it('requires complete explicit configuration; never falls back after incomplete relay settings',()=>{
  expect(hasPinnedCallbackTransport(configured)).toBe(true);
  expect(mcpEventReadiness(configured)).toEqual({callback_policy_configured:true,callback_transport:'dns-pinned-https'});
  expect(validateCallbackTarget(CALLBACK,configured)).toBe(CALLBACK);
  const wrong={...configured,COLLABORATION_EVENTS_EGRESS_URL:'https://attacker.example/deliver'};
  expect(hasPinnedCallbackTransport(wrong)).toBe(false);
  expect(()=>validateCallbackTarget(CALLBACK,wrong)).toThrow('callback_policy_unconfigured');
  expect(()=>validateCallbackTarget(CALLBACK,{...configured,COLLABORATION_EVENTS_EGRESS_TOKEN:''})).toThrow();
  for(const value of ['http://example.org/x','https://127.1/x','https://[::1]/x','https://example.org:8443/x','https://a@b.com/x'])
   expect(()=>validateCallbackTarget(value,configured)).toThrow('invalid_callback_url');
 });
 it('creates a real stored subscription only after successful signed challenge via the internal relay',async()=>{
  const {slug,identity}=await group();verification();
  const result=await mcpEventMethod('events/subscribe',params(slug),slug,identity,configured) as {id:string;refreshBefore:string};
  expect(result.id).toMatch(/^sub_/);expect(Date.parse(result.refreshBefore)).toBeGreaterThan(Date.now());
  const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM mcp_event_subscriptions WHERE channel_slug=?').bind(slug).first<{n:number}>();
  expect(count?.n).toBe(1);
 });
 it('preserves DNS and redirect errors without leaking URL, secret, payload or transport credentials',async()=>{
  const {slug,identity}=await group();
  for(const reason of ['callback_address_blocked','callback_redirect_blocked']){
   fetchMock.get('http://127.0.0.1:8798').intercept({path:'/deliver',method:'POST'}).reply(502,{error:reason});
   const result=await mcpEventMethod('events/subscribe',params(slug),slug,identity,configured) as {error:{code:number;data:{reason:string}}};
   expect(result.error.code).toBe(-32015);expect(result.error.data.reason).toBe(reason);
   for(const secret of [SECRET,CALLBACK,TOKEN])expect(JSON.stringify(result)).not.toContain(secret);
  }
  const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM mcp_event_subscriptions WHERE channel_slug=?').bind(slug).first<{n:number}>();
  expect(count?.n).toBe(0);
 });
 it('does not accept mismatched echo or malformed relay response',async()=>{
  const {slug,identity}=await group();
  fetchMock.get('http://127.0.0.1:8798').intercept({path:'/deliver',method:'POST'}).reply(200,{status:200,content_type:'application/json',body:'{"challenge":"wrong"}'});
  const result=await mcpEventMethod('events/subscribe',params(slug),slug,identity,configured) as {error:{code:number}};
  expect(result.error.code).toBe(-32015);
  fetchMock.get('http://127.0.0.1:8798').intercept({path:'/deliver',method:'POST'}).reply(200,{body:'not-a-valid-envelope'});
  await expect(postSignedCallback(configured,CALLBACK,{method:'POST',headers:{},body:'{}'})).rejects.toThrow('callback_gateway_failed');
 });
 it('keeps the drain endpoint secret-authenticated and independent of regular user/OAuth credentials',async()=>{
  expect((await drain(configured)).status).toBe(401);
  expect((await drain(configured,'b'.repeat(64))).status).toBe(401);
  expect((await drain(env as AppEnv,TOKEN)).status).toBe(401);
 });
 it('retries already queued events with the same event ID, not by polling messages or creating a subscription',async()=>{
  const {slug,identity,human}=await group();verification();
  await mcpEventMethod('events/subscribe',params(slug),slug,identity,configured);
  await enqueueMcpEvent(configured,{slug,seq:876,sender:human.name,mentions:[identity.name]});
  const ids:string[]=[];
  fetchMock.get('http://127.0.0.1:8798').intercept({path:'/deliver',method:'POST'}).reply(200,req=>{
   const p=JSON.parse(req.body);ids.push(JSON.parse(p.body).eventId);return{status:503,content_type:'application/json',body:'{}'};
  });
  expect(await deliverMcpEvents(configured,slug,2)).toEqual({attempted:1,delivered:0});
  await env.DB.prepare('UPDATE mcp_event_outbox SET next_attempt_at=? WHERE channel_slug=?').bind(Date.now()-1,slug).run();
  fetchMock.get('http://127.0.0.1:8798').intercept({path:'/deliver',method:'POST'}).reply(200,req=>{
   const p=JSON.parse(req.body);ids.push(JSON.parse(p.body).eventId);return{status:200,content_type:'application/json',body:'{}'};
  });
  const response=await drain(configured,TOKEN);expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({attempted:1,delivered:1});expect(ids[0]).toBe(ids[1]);
  const row=await env.DB.prepare('SELECT state,attempts FROM mcp_event_outbox WHERE channel_slug=?').bind(slug).first();
  expect(row).toEqual({state:'delivered',attempts:2});
 });
});
