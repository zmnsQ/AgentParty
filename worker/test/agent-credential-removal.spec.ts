import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { api, seedToken, uniq } from './helpers';
import { enableMcpFixture } from './mcp-test-helpers';
async function setup() {
 const owner=uniq('account'), human=await seedToken('human',uniq('human'),{owner}), slug=uniq('credential');
 expect((await api('/api/channels',human.token,{method:'POST',body:JSON.stringify({slug,kind:'standing',visibility:'public'})})).status).toBe(201);
 return {owner,human,slug};
}
const mint=(token:string,slug:string,name:string)=>api('/api/agents',token,{method:'POST',body:JSON.stringify({name,channel_scope:slug})});
const hash=(name:string)=>env.DB.prepare('SELECT hash, revoked_at FROM tokens WHERE name=?').bind(name).first();
describe('removed agent credentials',()=>{
 it('strict restore permits the same live MCP credential while revoked credentials remain 401',async()=>{
  const {owner,human,slug}=await setup(),name=uniq('mcp-live');
  await enableMcpFixture(slug,owner,false,false);
  const issued=await (await mint(human.token,slug,name)).json() as {token:string};
  const epoch=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO channel_participant_removals(channel_slug,principal_type,principal,removed_at,removal_epoch,removed_by) VALUES(?,'name',?,?,?,?)").bind(slug,name,Date.now(),epoch,human.name).run();
  const invoke=(method:string,params:unknown={})=>api(`/api/channels/${slug}/mcp`,issued.token,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const denied=await invoke('initialize');expect(denied.status).toBe(403);expect(await denied.json()).toMatchObject({error:{code:'participant_removed'}});
  const before=await hash(name);
  const members=()=>env.DB.prepare('SELECT account,added_at FROM channel_members WHERE channel_slug=? ORDER BY account').bind(slug).all();
  const membershipBefore=await members();
  const restore=(removal_epoch:string)=>api(`/api/channels/${slug}/agents/${name}/restore`,human.token,{method:'POST',body:JSON.stringify({removal_epoch})});
  expect((await restore(epoch)).status).toBe(200);expect(await hash(name)).toEqual(before);expect(await members()).toEqual(membershipBefore);
  const audit=await env.DB.prepare("SELECT actor_account,action,result,metadata_json FROM management_audit WHERE channel=? AND resource=? ORDER BY id DESC LIMIT 1")
    .bind(slug,`channel/${slug}/agents/${name}`).first<{actor_account:string;action:string;result:string;metadata_json:string}>();
  expect(audit).toMatchObject({actor_account:owner,action:'channel.member.add',result:'success'});
  expect(JSON.parse(audit!.metadata_json)).toEqual({participant_kind:'agent',restored:true});
  const init=await invoke('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'isolated-fixture',version:'1'}});
  expect(init.status).toBe(200);expect(await init.json()).toMatchObject({result:{serverInfo:{name:'agent-commons'}}});
  expect((await invoke('tools/list')).status).toBe(200);
  const profile=await invoke('tools/call',{name:'commons_profile',arguments:{}});expect(profile.status).toBe(200);expect(await profile.json()).toMatchObject({result:{structuredContent:{name,channel:slug}}});
  expect((await api(`/api/channels/${slug}/agents/${name}`,human.token,{method:'DELETE'})).status).toBe(200);
  expect((await invoke('initialize')).status).toBe(401);
  const tombstone=await env.DB.prepare("SELECT removal_epoch FROM channel_participant_removals WHERE channel_slug=? AND principal_type='name' AND principal=?").bind(slug,name).first<{removal_epoch:string}>();
  expect((await restore(tombstone!.removal_epoch)).status).toBe(200);expect((await invoke('initialize')).status).toBe(401);
  expect((await mint(human.token,slug,name)).status).toBe(201);expect((await invoke('initialize')).status).toBe(401);
 });
 it('rejects re-mint after deletion, preserves tombstone, allows explicit moderator restore',async()=>{
  const {owner,human,slug}=await setup(), name=uniq('agent');
  expect((await mint(human.token,slug,name)).status).toBe(201);
  expect((await api(`/api/channels/${slug}/agents/${name}`,human.token,{method:'DELETE'})).status).toBe(200);
  const before=await hash(name), denied=await mint(human.token,slug,name);
  expect(denied.status).toBe(403);expect(await denied.json()).toMatchObject({error:{code:'participant_removed'}});
  expect(await hash(name)).toEqual(before);
  expect(await env.DB.prepare("SELECT 1 FROM channel_participant_removals WHERE channel_slug=? AND principal_type='name' AND principal=?").bind(slug,name).first()).not.toBeNull();
  expect((await api(`/api/channels/${slug}/members/${encodeURIComponent(owner)}`,human.token,{method:'PUT',body:JSON.stringify({name})})).status).toBe(200);
  expect((await mint(human.token,slug,name)).status).toBe(201);
 });
 it('rejects rotation without changing hash and projects only existing owned rows',async()=>{
  const {owner,human,slug}=await setup(),name=uniq('agent');
  expect((await mint(human.token,slug,name)).status).toBe(201);
  const foreign=await seedToken('agent',uniq('foreign'),{owner:uniq('other'),channelScope:slug});
  expect((await api(`/api/channels/${slug}/kick`,human.token,{method:'POST',body:JSON.stringify({name,mode:'remove'})})).status).toBe(200);
  // Reproduce the pre-fix remint state: a live credential with an enduring removal tombstone.
  await env.DB.prepare('UPDATE tokens SET revoked_at=NULL WHERE name=?').bind(name).run();
  const before=await hash(name),denied=await api(`/api/channels/${slug}/agents/${name}/rotate`,human.token,{method:'POST'});
  expect(denied.status).toBe(403);expect(await denied.json()).toMatchObject({error:{code:'participant_removed'}});expect(await hash(name)).toEqual(before);
  const listed=await api(`/api/channels/${slug}/agents`,human.token);expect(listed.status).toBe(200);
  const body=await listed.json() as {agents:Array<Record<string,unknown>>};
  expect(body.agents).toContainEqual(expect.objectContaining({name,owner,access_status:'removed',can_restore:true}));
  expect(body.agents.some(a=>a.name===foreign.name)).toBe(false);
 });
 it('does not offer moderator restore to an ordinary agent owner',async()=>{
  const {human,slug}=await setup(),owner=uniq('member');
  const member=await seedToken('human',uniq('memberhuman'),{owner}),name=uniq('memberagent');
  expect((await mint(member.token,slug,name)).status).toBe(201);
  // A name-only historical tombstone does not remove the owner's human account.
  await env.DB.prepare("INSERT INTO channel_participant_removals(channel_slug,principal_type,principal,restore_account,removed_at,removal_epoch,removed_by) VALUES(?,'name',?,?,?,?,?)").bind(slug,name,owner,Date.now(),crypto.randomUUID(),human.name).run();
  const listed=await api(`/api/channels/${slug}/agents`,member.token);
  expect(listed.status).toBe(200);
  expect((await listed.json() as {agents:unknown[]}).agents).toContainEqual(expect.objectContaining({name,access_status:'removed',can_restore:false}));
 });
 it('restores only the exact name epoch, never credentials, other names, membership, or account bans',async()=>{
  const {owner,human,slug}=await setup(), name=uniq('restore'), other=uniq('otheragent');
  expect((await mint(human.token,slug,name)).status).toBe(201);
  const epoch=crypto.randomUUID();
  for (const principal of [name,other]) await env.DB.prepare("INSERT INTO channel_participant_removals(channel_slug,principal_type,principal,restore_account,removed_at,removal_epoch,removed_by) VALUES(?,'name',?,?,?,?,?)").bind(slug,principal,owner,Date.now(),epoch,human.name).run();
  const before=await hash(name);
  const restore=(token:string,e=epoch,group=slug)=>api(`/api/channels/${group}/agents/${name}/restore`,token,{method:'POST',body:JSON.stringify({removal_epoch:e})});
  const stranger=await seedToken('human',uniq('stranger'),{owner:uniq('strangeracct')});
  expect((await restore(stranger.token)).status).toBe(403);
  expect((await restore(human.token,'stale')).status).toBe(409);
  const second=await setup();expect((await restore(second.human.token,epoch,second.slug)).status).toBe(404);
  await env.DB.prepare('INSERT INTO channel_account_bans(channel_slug,account,banned_by,banned_at) VALUES(?,?,?,?)').bind(slug,owner,human.name,Date.now()).run();
  expect((await restore(human.token)).status).toBe(403);
  await env.DB.prepare('DELETE FROM channel_account_bans WHERE channel_slug=? AND account=?').bind(slug,owner).run();
  await env.DB.prepare("INSERT INTO channel_participant_removals(channel_slug,principal_type,principal,removed_at,removal_epoch,removed_by) VALUES(?,'account',?,?,?,?)").bind(slug,owner,Date.now(),crypto.randomUUID(),human.name).run();
  expect((await restore(human.token)).status).toBe(403);
  await env.DB.prepare("DELETE FROM channel_participant_removals WHERE channel_slug=? AND principal_type='account' AND principal=?").bind(slug,owner).run();
  await env.DB.prepare('UPDATE tokens SET parent_agent=? WHERE name=?').bind(other,name).run();
  expect((await restore(human.token)).status).toBe(404);
  await env.DB.prepare('UPDATE tokens SET parent_agent=NULL WHERE name=?').bind(name).run();
  const res=await restore(human.token);expect(res.status).toBe(200);expect(await res.json()).toEqual({restored:true,name});
  expect(await hash(name)).toEqual(before);
  expect(await env.DB.prepare("SELECT 1 FROM channel_participant_removals WHERE channel_slug=? AND principal=?").bind(slug,other).first()).not.toBeNull();
  expect((await restore(human.token)).status).toBe(409);
 });
 it('restores a deleted name without unrevoking its credential and permits subsequent explicit mint',async()=>{
  const {human,slug}=await setup(),name=uniq('deleted');expect((await mint(human.token,slug,name)).status).toBe(201);
  expect((await api(`/api/channels/${slug}/agents/${name}`,human.token,{method:'DELETE'})).status).toBe(200);
  const listed=await (await api(`/api/channels/${slug}/agents`,human.token)).json() as {agents:Array<{name:string;removal_epoch:string;credential_revoked:boolean;can_restore:boolean}>};
  const row=listed.agents.find(a=>a.name===name)!;expect(row).toMatchObject({credential_revoked:true,can_restore:true});
  const before=await hash(name);
  expect((await api(`/api/channels/${slug}/agents/${name}/restore`,human.token,{method:'POST',body:JSON.stringify({removal_epoch:row.removal_epoch})})).status).toBe(200);
  expect(await hash(name)).toEqual(before);expect((await mint(human.token,slug,name)).status).toBe(201);
 });
 it('rejects banned owner mint while ordinary creation remains active',async()=>{
  const {owner,human,slug}=await setup(),name=uniq('normal');expect((await mint(human.token,slug,name)).status).toBe(201);
  const listed=await (await api(`/api/channels/${slug}/agents`,human.token)).json() as {agents:unknown[]};
  expect(listed.agents).toContainEqual(expect.objectContaining({name,access_status:'active',can_restore:false}));
  await env.DB.prepare('INSERT INTO channel_account_bans(channel_slug,account,banned_by,banned_at) VALUES(?,?,?,?)').bind(slug,owner,human.name,Date.now()).run();
  const denied=await mint(human.token,slug,uniq('blocked'));expect(denied.status).toBe(403);expect(await denied.json()).toMatchObject({error:{code:'participant_removed'}});
 });
});
