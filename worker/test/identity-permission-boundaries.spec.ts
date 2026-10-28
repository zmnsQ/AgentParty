import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { api, createChannel, seedToken, uniq } from "./helpers";
const put=(path:string,token:string,body:unknown)=>api(path,token,{method:"PUT",body:JSON.stringify(body)});
describe("identity permission boundaries",()=>{
 it.each([false,true])("an owned agent cannot edit its human owner's global handle (scoped=%s)",async(scoped)=>{
  const account=uniq("account");const human=await seedToken("human",uniq("human"),{owner:account});
  const slug=await createChannel(human.token);const original=uniq("human-label");
  expect((await put("/api/me/handle",human.token,{handle:original})).status).toBe(200);
  const agent=await seedToken("agent",uniq("agent"),{owner:account,...(scoped?{channelScope:slug}:{})});
  expect((await put("/api/me/handle",agent.token,{handle:uniq("takeover")})).status).toBe(403);
  expect((await env.DB.prepare("SELECT handle FROM account_profiles WHERE account=?").bind(account).first<{handle:string}>())?.handle).toBe(original);
  const nickname=uniq("own-nick");
  expect((await put("/api/me/nickname",agent.token,{nickname})).status).toBe(200);
  expect((await env.DB.prepare("SELECT nickname FROM agent_nicknames WHERE name=?").bind(agent.name).first<{nickname:string}>())?.nickname).toBe(nickname);
 });
 it("readonly and revoked agent sessions cannot mutate the owner's profile",async()=>{
  const account=uniq("account");const human=await seedToken("human",uniq("human"),{owner:account});
  const slug=await createChannel(human.token);const original=uniq("owner-label");
  expect((await put("/api/me/handle",human.token,{handle:original})).status).toBe(200);
  const readonly=await seedToken("readonly",uniq("reader"),{owner:account,channelScope:slug});
  expect((await put("/api/me/handle",readonly.token,{handle:uniq("bad")})).status).toBe(403);
  const agent=await seedToken("agent",uniq("deleted"),{owner:account,channelScope:slug});
  expect((await api(`/api/channels/${slug}/agents/${agent.name}`,human.token,{method:"DELETE"})).status).toBe(200);
  expect((await put("/api/me/handle",agent.token,{handle:uniq("bad")})).status).toBe(401);
  expect((await env.DB.prepare("SELECT handle FROM account_profiles WHERE account=?").bind(account).first<{handle:string}>())?.handle).toBe(original);
  const updated=uniq("human-updated");expect((await put("/api/me/handle",human.token,{handle:updated})).status).toBe(200);
 });
 it.each(["system","SYSTEM","System"])("keeps reserved handle %s unavailable without changing the profile",async(handle)=>{
  const account=uniq("account");const human=await seedToken("human",uniq("human"),{owner:account});
  const original=uniq("saved");expect((await put("/api/me/handle",human.token,{handle:original})).status).toBe(200);
  expect((await put("/api/me/handle",human.token,{handle})).status).toBe(409);
  expect((await env.DB.prepare("SELECT handle FROM account_profiles WHERE account=?").bind(account).first<{handle:string}>())?.handle).toBe(original);
 });
 it("channel ownership does not authorize renaming another owner's agent or crossing its scope",async()=>{
  const owner=await seedToken("human",uniq("human"),{owner:uniq("owner")});const slug=await createChannel(owner.token);
  const foreign=await seedToken("agent",uniq("foreign"),{owner:uniq("other-owner"),channelScope:slug});
  expect((await put(`/api/channels/${slug}/agents/${foreign.name}/nickname`,owner.token,{nickname:uniq("forbidden")})).status).toBe(404);
  const other=await createChannel(owner.token);const own=await seedToken("agent",uniq("own"),{owner:(await env.DB.prepare("SELECT owner FROM tokens WHERE name=?").bind(owner.name).first<{owner:string}>())!.owner,channelScope:slug});
  expect((await put(`/api/channels/${other}/agents/${own.name}/nickname`,owner.token,{nickname:uniq("wrong-group")})).status).toBe(404);
  expect(await env.DB.prepare("SELECT 1 FROM agent_nicknames WHERE name IN (?,?)").bind(foreign.name,own.name).first()).toBeNull();
 });
});
