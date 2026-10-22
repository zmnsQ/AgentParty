import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { api, seedToken, uniq } from "./helpers";

const create = (token:string, body:Record<string,unknown>) =>
  api("/api/channels",token,{method:"POST",body:JSON.stringify(body)});

describe("server-generated opaque channel identifiers", () => {
  it("creates opaque unique IDs for identical human-friendly names and stores exact name", async () => {
    const account=uniq("account");
    const owner=await seedToken("human",uniq("creator"),{owner:account});
    const payload={title:"AI Agent 协作测试群",visibility:"private",mode:"normal"};
    const first=await create(owner.token,payload);
    const second=await create(owner.token,payload);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a=await first.json() as {slug:string;title:string;visibility:string};
    const b=await second.json() as {slug:string;title:string;visibility:string};
    expect(a.slug).toMatch(/^ch-[0-9a-f]{32}$/);
    expect(b.slug).toMatch(/^ch-[0-9a-f]{32}$/);
    expect(a.slug).not.toBe(b.slug);
    expect(a).toMatchObject({title:payload.title,visibility:"private"});
    expect(b.title).toBe(payload.title);
    const stored=await env.DB.prepare(
      "SELECT slug,title,owner_account FROM channels WHERE slug=? OR slug=? ORDER BY slug"
    ).bind(a.slug,b.slug).all<{slug:string;title:string;owner_account:string}>();
    expect(stored.results).toHaveLength(2);
    for(const row of stored.results){
      expect(row.title).toBe(payload.title);
      expect(row.owner_account).toBe(account);
    }
    const listing=await api("/api/channels",owner.token);
    expect(listing.status).toBe(200);
    const channels=(await listing.json() as {channels:Array<{slug:string;title:string}>}).channels;
    for(const slug of [a.slug,b.slug])expect(channels).toContainEqual(expect.objectContaining({slug,title:payload.title}));
  });

  it("rejects blank or oversized names and explicit malformed slugs; no silent fallback", async () => {
    const owner=await seedToken("human",uniq("author"),{owner:uniq("account")});
    for(const invalid of ["","    ","a".repeat(81)]){
      const response=await create(owner.token,{title:invalid});
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({error:{code:"bad_request"}});
    }
    for(const slug of ["",null,"A_BAD_SLUG"]){
      expect((await create(owner.token,{title:"New Group",slug})).status).toBe(400);
    }
    expect((await create(owner.token,{title:"   Chinese 中文  ",visibility:"private"})).status).toBe(201);
  });

  it("never allows scoped agent to create a random room outside its scope", async () => {
    const account=uniq("account");
    const token=await seedToken("agent",uniq("scoped"),{owner:account,channelScope:"only-scope"});
    const result=await create(token.token,{title:"Cannot break scope"});
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({error:{code:"forbidden"}});
  });

  it("keeps explicit legacy channel slugs and 409/auto_suffix API contracts", async () => {
    const human=await seedToken("human",uniq("legacy"),{owner:uniq("account")});
    const slug=uniq("legacy-room");
    expect((await create(human.token,{slug,title:"Legacy room"})).status).toBe(201);
    const duplicate=await create(human.token,{slug,title:"Other name"});
    expect(duplicate.status).toBe(409);
    const second=await create(human.token,{slug,title:"Other name",auto_suffix:true});
    expect(second.status).toBe(201);
    expect((await second.json() as {slug:string}).slug).toBe(slug+"-2");
  });

  it("preserves visibility and party mode when auto-assigning an ID", async () => {
    const owner=await seedToken("human",uniq("owner"),{owner:uniq("account")});
    const response=await create(owner.token,{title:"Project Party",visibility:"public_watch",mode:"party"});
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({title:"Project Party",kind:"standing",mode:"party",visibility:"public_watch"});
  });
});
