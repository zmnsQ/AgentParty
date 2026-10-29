import {env} from 'cloudflare:test';
import {describe,it,expect} from 'vitest';
import {api,createChannel,seedToken,uniq} from './helpers';
import {enableMcpFixture} from './mcp-test-helpers';

describe('manual MCP diagnostic: authenticated route with synthetic credentials only',()=>{
 it('minting is not enabling; enabled policy permits complete read-only handshake',async()=>{
  const account=uniq('manual-diagnostic-owner'),owner=await seedToken('human',uniq('owner'),{owner:account});
  const slug=await createChannel(owner.token);
  const mint=await api('/api/agents',owner.token,{method:'POST',body:JSON.stringify({name:uniq('manual'),channel_scope:slug})});
  expect(mint.status).toBe(201);
  const credential=await mint.json() as {token:string;name:string};
  const endpoint=`/api/channels/${slug}/mcp`;
  const call=(message:unknown,version='2025-06-18')=>api(endpoint,credential.token,{method:'POST',headers:{accept:'application/json, text/event-stream','mcp-protocol-version':version},body:JSON.stringify(message)});
  const init={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'synthetic-manual-client',version:'1'}}};
  const denied=await call(init);expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({error:{code:-32001,message:'MCP disabled or owner two-step verification required'}});
  await enableMcpFixture(slug,account,false,false);
  const initialized=await call(init);expect(initialized.status).toBe(200);
  expect(initialized.headers.get('content-type')).toContain('application/json');
  expect(await initialized.json()).toMatchObject({result:{protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}}}});
  const notified=await call({jsonrpc:'2.0',method:'notifications/initialized'});expect(notified.status).toBe(202);expect(await notified.text()).toBe('');
  const listed=await call({jsonrpc:'2.0',id:2,method:'tools/list'});expect(listed.status).toBe(200);
  const tools=(await listed.json() as any).result.tools;
  expect(tools.some((t:any)=>t.name==='commons_profile')).toBe(true);
  expect(tools.every((t:any)=>!('securitySchemes' in t)&&t.annotations.readOnlyHint)).toBe(true);
  const profile=await call({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'commons_profile',arguments:{}}});
  expect(profile.status).toBe(200);expect(await profile.json()).toMatchObject({result:{isError:false,structuredContent:{name:credential.name,channel:slug}}});
  expect((await call(init,'2025-03-26')).status).toBe(400);
  await env.DB.prepare('UPDATE browser_account_security SET enabled=0 WHERE account=?').bind(account).run();
  expect((await call(init)).status).toBe(403);
 });
});
