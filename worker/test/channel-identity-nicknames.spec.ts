import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { api, createChannel, postMessage, seedToken, uniq } from "./helpers";

async function identities(slug: string, token: string) {
  const response = await api(`/api/channels/${slug}/identities`, token);
  expect(response.status).toBe(200);
  return ((await response.json()) as { identities: {name:string;display:string;handle?:string;nickname?:string;connector_type?:string;kind?:string}[] }).identities;
}
async function nickname(name: string, label: string) {
  const now=Date.now();
  await env.DB.prepare(`INSERT INTO agent_nicknames(name,nickname,created_at,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(name) DO UPDATE SET nickname=excluded.nickname,updated_at=excluded.updated_at`).bind(name,label,now,now).run();
}

describe("channel identity current agent nicknames", () => {
  it("uses the current nickname after an older message, without changing its routing identity", async () => {
    const owner=await seedToken("human",uniq("owner"),{owner:uniq("account")});
    const slug=await createChannel(owner.token);
    const agent=await seedToken("agent",uniq("oauth-agent"),{channelScope:slug});
    await nickname(agent.name,uniq("旧昵称"));
    expect((await postMessage(slug,agent.token,"existing message")).status).toBe(200);
    const latest=uniq("新昵称"); await nickname(agent.name,latest);
    expect(await identities(slug,owner.token)).toContainEqual(expect.objectContaining({name:agent.name,kind:"agent",display:latest,handle:latest,nickname:latest}));
  });
  it("does not add unseen agents or infer a platform label from an opaque name", async () => {
    const owner=await seedToken("human",uniq("owner"),{owner:uniq("account")});
    const slug=await createChannel(owner.token);
    const unseen=await seedToken("agent",uniq("unseen"),{channelScope:slug});
    await nickname(unseen.name,uniq("hidden"));
    const plain=await seedToken("agent",uniq("muse-oauth"),{channelScope:slug});
    expect((await postMessage(slug,plain.token,"present")).status).toBe(200);
    const result=await identities(slug,owner.token);
    expect(result.find(i=>i.name===unseen.name)).toBeUndefined();
    expect(result).toContainEqual(expect.objectContaining({name:plain.name,display:plain.name}));
    expect(result.find(i=>i.name===plain.name)).not.toHaveProperty("nickname");
    expect(result.filter(i=>i.kind==="human").every(i=>!("nickname" in i))).toBe(true);
  });
  it.each(["same-id", "opaque", "generated"])("preserves explicit %s nickname authority without classifying its appearance", async (appearance) => {
    const owner=await seedToken("human",uniq("owner"),{owner:uniq("account")});
    const slug=await createChannel(owner.token);
    const agent=await seedToken("agent",uniq("agent"),{channelScope:slug});
    expect((await postMessage(slug,agent.token,"existing identity")).status).toBe(200);
    // Direct fixtures cover legacy/imported values too; display heuristics must
    // never erase a value that actually exists in the authoritative table.
    const label=appearance==="same-id"?agent.name:appearance==="opaque"?crypto.randomUUID():`lark-abcdef0123456789-${uniq("role")}`;
    await nickname(agent.name,label);
    expect((await identities(slug,owner.token)).find(i=>i.name===agent.name)).toMatchObject({name:agent.name,display:label,handle:label,nickname:label});
  });
  it.each(["github-default", "sso-default", "opaque", "manual"])("selects human display without exposing a %s handle as the preferred nickname", async (mode) => {
    const account=uniq("account");
    const owner=await seedToken("human",uniq("owner"),{owner:account});
    const slug=await createChannel(owner.token);
    const provider=mode==="github-default"?"github":"lark";
    const providerId=uniq("uid");
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`${provider}:${account}`));
    const hash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
    const handle=mode==="github-default"?`gh-${providerId}`:mode==="sso-default"?`${provider}-${hash.slice(0,10)}`:mode==="opaque"?`oidc-${uniq("raw")}`:uniq("myname");
    await env.DB.prepare(`INSERT INTO account_profiles(account,handle,display_name,provider,provider_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).bind(account,handle,"Provider name",provider,providerId,Date.now(),Date.now()).run();
    expect((await postMessage(slug,owner.token,"human present")).status).toBe(200);
    const result=(await identities(slug,owner.token)).find(i=>i.name===owner.name);
    expect(result).toMatchObject({display:mode==="manual"?handle:"Provider name",handle});
    const meResponse=await api('/api/me',owner.token);expect(meResponse.status).toBe(200);
    const me=await meResponse.json() as Record<string,unknown>;
    expect(me.preferred_display).toBe(result!.display);
    expect(me).not.toHaveProperty('provider_user_id');
    if(mode==='manual')expect(me.nickname).toBe(handle);else expect(me).not.toHaveProperty('nickname');
    if (mode === "manual") expect(result).toHaveProperty("nickname",handle);
    else expect(result).not.toHaveProperty("nickname");
  });
  it.each([
    ["https://agent.meta.ai/api/hatch/oauth/callback", "muse"],
    ["https://chatgpt.com/connector/oauth/abcdefgh", "chatgpt"],
    ["https://chatgpt.com/connector_platform_oauth_redirect", "chatgpt"],
    ["https://chatgpt.com.evil.test/connector/oauth/abcdefgh", undefined],
    ["https://unknown.example/callback", undefined],
  ])("projects only recognized OAuth connector callbacks (%s)", async (redirect, expected) => {
    const account=uniq("account");
    const owner=await seedToken("human",uniq("owner"),{owner:account});
    const slug=await createChannel(owner.token);
    const agent=await seedToken("agent",uniq("not-a-platform-name"),{owner:account,channelScope:slug});
    const unseen=await seedToken("agent",uniq("unseen"),{owner:account,channelScope:slug});
    const client=crypto.randomUUID(); const now=Date.now();
    await env.DB.prepare(`INSERT INTO connector_oauth_clients(client_id,name,redirects_json,created_at) VALUES(?,?,?,?)`).bind(client,"Muse ChatGPT",JSON.stringify([redirect]),now).run();
    for (const target of [agent,unseen]) await env.DB.prepare(`INSERT INTO connector_oauth_grants(id,client_id,account,channel_slug,agent_name,scopes_json,resource,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),client,target===agent?account:uniq("unseen-owner"),slug,target.name,'["group.read"]',"https://commons.test/mcp",now,now).run();
    expect((await postMessage(slug,agent.token,"present")).status).toBe(200);
    const rows=await identities(slug,owner.token); const row=rows.find(i=>i.name===agent.name);
    expect(rows.find(i=>i.name===unseen.name)).toBeUndefined();
    if(expected) expect(row).toHaveProperty("connector_type",expected);
    else expect(row).not.toHaveProperty("connector_type");
    expect(JSON.stringify(rows)).not.toContain(redirect);
    expect(row).not.toHaveProperty("provider_verified");
  });
  it("projects configured cloud type but omits revoked connections", async () => {
    const account=uniq("account"); const owner=await seedToken("human",uniq("owner"),{owner:account});
    const slug=await createChannel(owner.token); const agent=await seedToken("agent",uniq("cloud"),{channelScope:slug});
    const now=Date.now(); const id=crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO cloud_agent_connections(id,channel_slug,owner_account,provider,name,agent_name,endpoint,credential_ciphertext,agent_token_ciphertext,agent_token_hash,verified_at,created_at,updated_at) VALUES(?,?,?,'hermes',?,?,?,?,?,?,?,?,?)`).bind(id,slug,account,"Configured service",agent.name,"https://private.example","fixture-not-a-secret","fixture-not-a-token","fixturehash",now,now,now).run();
    expect((await postMessage(slug,agent.token,"present")).status).toBe(200);
    expect((await identities(slug,owner.token)).find(i=>i.name===agent.name)).toHaveProperty("connector_type","hermes");
    await env.DB.prepare("UPDATE cloud_agent_connections SET revoked_at=? WHERE id=? AND channel_slug=?").bind(now,id,slug).run();
    expect((await identities(slug,owner.token)).find(i=>i.name===agent.name)).not.toHaveProperty("connector_type");
  });
  it.each(["connector_oauth_private_clients", "cloud_agent_connections"])("keeps identities available when optional %s migration is absent", async (table) => {
    const owner=await seedToken("human",uniq("owner"),{owner:uniq("account")});
    const slug=await createChannel(owner.token); const agent=await seedToken("agent",uniq("legacy"),{channelScope:slug});
    const label=uniq("saved"); await nickname(agent.name,label);
    expect((await postMessage(slug,agent.token,"present")).status).toBe(200);
    // Isolated local test database only; always restore before the next test.
    await env.DB.prepare(`ALTER TABLE ${table} RENAME TO fixture_hidden_${table}`).run();
    try {
      const row=(await identities(slug,owner.token)).find(i=>i.name===agent.name);
      expect(row).toMatchObject({display:label,nickname:label});
      expect(row).not.toHaveProperty("connector_type");
    } finally {
      await env.DB.prepare(`ALTER TABLE fixture_hidden_${table} RENAME TO ${table}`).run();
    }
  });
  it("does not silently swallow a connector schema bug other than an absent optional table", async () => {
    const owner=await seedToken("human",uniq("owner"),{owner:uniq("account")});
    const slug=await createChannel(owner.token); const agent=await seedToken("agent",uniq("present"),{channelScope:slug});
    expect((await postMessage(slug,agent.token,"present")).status).toBe(200);
    await env.DB.prepare("ALTER TABLE connector_oauth_private_clients RENAME COLUMN provider TO fixture_provider").run();
    try {
      expect((await api(`/api/channels/${slug}/identities`,owner.token)).status).toBe(500);
    } finally {
      await env.DB.prepare("ALTER TABLE connector_oauth_private_clients RENAME COLUMN fixture_provider TO provider").run();
    }
  });
  it("me preferred display uses the agent nickname rather than its owner's profile",async()=>{
    const account=uniq('account');const agent=await seedToken('agent',uniq('agent'),{owner:account});
    const ownerHandle=uniq('owner');const now=Date.now();
    await env.DB.prepare('INSERT INTO account_profiles(account,handle,display_name,created_at,updated_at) VALUES(?,?,?,?,?)').bind(account,ownerHandle,'Owner display',now,now).run();
    const before=await (await api('/api/me',agent.token)).json() as Record<string,unknown>;
    expect(before.preferred_display).toBe(agent.name);expect(before).not.toHaveProperty('nickname');
    const label=uniq('AgentAlias');await nickname(agent.name,label);
    const after=await (await api('/api/me',agent.token)).json() as Record<string,unknown>;
    expect(after).toMatchObject({preferred_display:label,nickname:label,owner_handle:ownerHandle,owner_display_name:'Owner display',handle:ownerHandle,display_name:'Owner display'});
    expect(after).not.toHaveProperty('provider_user_id');
  });
  it.each(["name", "account"] as const)("keeps channel access checks and %s tombstones effective", async (principalType) => {
    const account=uniq("account");
    const owner=await seedToken("human",uniq("owner"),{owner:account});
    const slug=await createChannel(owner.token);
    const agentAccount=uniq("agentowner");
    const agent=await seedToken("agent",uniq("removed"),{owner:agentAccount,channelScope:slug});
    await nickname(agent.name,uniq("removednick"));
    expect((await postMessage(slug,agent.token,"before removal")).status).toBe(200);
    await env.DB.prepare(`INSERT INTO channel_participant_removals(channel_slug,principal_type,principal,removed_at,removal_epoch,removed_by) VALUES(?,?,?,?,?,?)`).bind(slug,principalType,principalType==="name"?agent.name:agentAccount,Date.now(),crypto.randomUUID(),owner.name).run();
    expect((await identities(slug,owner.token)).find(i=>i.name===agent.name)).toBeUndefined();
    const outsider=await seedToken("human",uniq("outsider"),{owner:uniq("other")});
    expect((await api(`/api/channels/${slug}/identities`,outsider.token)).status).toBe(403);
  });
});
