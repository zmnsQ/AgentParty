import {env} from 'cloudflare:test';
import {describe,it,expect} from 'vitest';
import {api,seedToken,uniq} from './helpers';
async function fixture(){const owner=uniq('owner'),human=await seedToken('human',uniq('human'),{owner}),slug=uniq('readback');expect((await api('/api/channels',human.token,{method:'POST',body:JSON.stringify({slug,visibility:'public',kind:'standing'})})).status).toBe(201);const agent=await seedToken('agent',uniq('agent'),{owner,channelScope:slug});return{owner,human,slug,agent};}
const path=(slug:string,name:string)=>`/api/channels/${slug}/agents/${name}/access`;
describe('precise agent access readback',()=>{
 it('reads a revoked removed identity without secrets; still reads it after explicit restore, without reviving credentials',async()=>{
  const f=await fixture();expect((await api(`/api/channels/${f.slug}/agents/${f.agent.name}`,f.human.token,{method:'DELETE'})).status).toBe(200);
  const response=await api(path(f.slug,f.agent.name),f.human.token);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');const row=await response.json() as any;
  expect(row).toMatchObject({name:f.agent.name,owner:f.owner,access_status:'removed',credential_revoked:true,can_restore:true});
  expect(Object.keys(row).sort()).toEqual(['name','owner','channel_scope','created_at','credential_kind','credential_revoked','access_status','can_restore','removal_epoch'].sort());
  expect(JSON.stringify(row)).not.toContain(f.agent.token);
  expect((await api(`/api/channels/${f.slug}/agents/${f.agent.name}/restore`,f.human.token,{method:'POST',body:JSON.stringify({removal_epoch:row.removal_epoch,owner:'stale-owner'})})).status).toBe(409);
  expect((await api(`/api/channels/${f.slug}/agents/${f.agent.name}/restore`,f.human.token,{method:'POST',body:JSON.stringify({removal_epoch:row.removal_epoch,owner:f.owner})})).status).toBe(200);
  const after=await api(path(f.slug,f.agent.name),f.human.token);expect(after.status).toBe(200);expect(await after.json()).toMatchObject({access_status:'active',credential_revoked:true,can_restore:false});
  expect((await env.DB.prepare('SELECT revoked_at FROM tokens WHERE name=?').bind(f.agent.name).first<{revoked_at:number}>())!.revoked_at).not.toBeNull();
 });
 it('an ordinary owner can inspect its identity but only a moderator can restore it',async()=>{
  const f=await fixture(),other=uniq('other'),member=await seedToken('human',uniq('member'),{owner:other}),agent=await seedToken('agent',uniq('owned'),{owner:other,channelScope:f.slug});
  await env.DB.prepare("INSERT INTO channel_participant_removals(channel_slug,principal_type,principal,removed_at,removal_epoch,removed_by) VALUES(?,'name',?,?,?,?)").bind(f.slug,agent.name,Date.now(),crypto.randomUUID(),f.human.name).run();
  const res=await api(path(f.slug,agent.name),member.token);expect(res.status).toBe(200);expect(await res.json()).toMatchObject({access_status:'removed',can_restore:false});
  const mod=await api(path(f.slug,agent.name),f.human.token);expect(mod.status).toBe(200);expect(await mod.json()).toMatchObject({owner:other,can_restore:true});
  expect((await api(path(f.slug,f.agent.name),member.token)).status).toBe(404);
  expect((await api(path(f.slug,f.agent.name),f.agent.token)).status).toBe(403);
 });
 it('never crosses groups or offers child identities as ordinary restoration targets',async()=>{const f=await fixture(),g=await fixture();expect((await api(path(g.slug,f.agent.name),g.human.token)).status).toBe(404);await env.DB.prepare('UPDATE tokens SET parent_agent=? WHERE name=?').bind('parent',f.agent.name).run();expect((await api(path(f.slug,f.agent.name),f.human.token)).status).toBe(404);});
 it('a different removed name does not block creation of a fresh identity',async()=>{const f=await fixture();await env.DB.prepare("INSERT INTO channel_participant_removals(channel_slug,principal_type,principal,restore_account,removed_at,removal_epoch,removed_by) VALUES(?,'name',?,?,?,?,?)").bind(f.slug,f.agent.name,f.owner,Date.now(),crypto.randomUUID(),f.human.name).run();expect((await api('/api/agents',f.human.token,{method:'POST',body:JSON.stringify({name:uniq('fresh'),channel_scope:f.slug})})).status).toBe(201);});
});
