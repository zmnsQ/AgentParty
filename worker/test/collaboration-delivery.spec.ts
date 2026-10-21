import type { IdentityExportData } from "@agentparty/shared";
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ChannelDO } from "../src/do";
import { WsClient, api, completeCapabilityHello, createChannel, seedToken, uniq } from "./helpers";

async function fixture() {
  const owner = await seedToken("human", uniq("owner"), { owner: `${uniq("account")}@example.com` });
  const slug = await createChannel(owner.token);
  await api(`/api/channels/${slug}/messages`, owner.token);
  return { owner, slug };
}
function inChannel<T>(slug: string, run: (instance: ChannelDO, state: DurableObjectState) => T | Promise<T>) {
  return runInDurableObject(env.CHANNELS.get(env.CHANNELS.idFromName(slug)), run);
}
function send(slug: string, token: string, key: string, body = "Durable collaboration result") {
  return api(`/api/channels/${slug}/messages`, token, { method: "POST",
    body: JSON.stringify({ kind: "message", body, mentions: [], reply_to: null, idempotency_key: key }) });
}
async function sequence(response: Response) {
  expect(response.status).toBe(200);
  return ((await response.json()) as { seq: number }).seq;
}
async function count(slug: string, key: string) {
  return inChannel(slug, (_instance, state) => ({
    messages: Number(state.storage.sql.exec("SELECT COUNT(*) AS n FROM messages WHERE idempotency_key = ?", key).one().n),
    receipts: Number(state.storage.sql.exec("SELECT COUNT(*) AS n FROM collaboration_message_receipts WHERE idempotency_key = ?", key).one().n),
  }));
}

describe("durable collaboration message receipts", () => {
  for (const prefix of ["cloud-run", "code-proposal", "code-published"]) {
    it(`${prefix}: retries after the ordinary ten-minute window keep the original sequence`, async () => {
      const { owner, slug } = await fixture();
      const key = `${prefix}:${crypto.randomUUID()}`;
      const original = await sequence(await send(slug, owner.token, key));
      await inChannel(slug, (_instance, state) => {
        state.storage.sql.exec("UPDATE messages SET ts = ? WHERE seq = ?", Date.now() - 86_400_000, original);
      });
      expect(await sequence(await send(slug, owner.token, key))).toBe(original);
      expect(await count(slug, key)).toEqual({ messages: 1, receipts: 1 });
    });
  }

  it("a pruned message is acknowledged without recreating its body or broadcasting it again", async () => {
    const { owner, slug } = await fixture();
    const key = `cloud-run:${crypto.randomUUID()}`;
    const ws = await WsClient.open(slug, owner.token);
    await completeCapabilityHello(ws);
    try {
      const original = await sequence(await send(slug, owner.token, key));
      expect((await ws.nextOfType("msg")).body).toBe("Durable collaboration result");
      await inChannel(slug, (instance, state) => {
        state.storage.sql.exec("DELETE FROM messages WHERE seq = ?", original);
        instance.onStart(); // Rehydrate schema/state with only the durable receipt left.
      });
      expect(await sequence(await send(slug, owner.token, key))).toBe(original);
      expect(await count(slug, key)).toEqual({ messages: 0, receipts: 1 });
      await expect(ws.nextOfType("msg", 500)).rejects.toThrow();
    } finally { ws.close(); }
  });

  it("upgrades an aged retained legacy message without duplicating it", async () => {
    const { owner, slug } = await fixture();
    const key = `cloud-run:${crypto.randomUUID()}`;
    const original = await sequence(await send(slug, owner.token, key));
    await inChannel(slug, (_instance, state) => {
      state.storage.sql.exec("DELETE FROM collaboration_message_receipts WHERE message_seq = ?", original);
      state.storage.sql.exec("UPDATE messages SET ts = ? WHERE seq = ?", Date.now() - 86_400_000, original);
    });
    expect(await sequence(await send(slug, owner.token, key))).toBe(original);
    expect(await count(slug, key)).toEqual({ messages: 1, receipts: 1 });
  });

  it("does not change the ordinary window for non-reserved or malformed collaboration keys", async () => {
    const { owner, slug } = await fixture();
    for (const key of [crypto.randomUUID(), "cloud-run:not-an-operation-uuid"]) {
      const original = await sequence(await send(slug, owner.token, key));
      await inChannel(slug, (_instance, state) => {
        state.storage.sql.exec("UPDATE messages SET ts = ? WHERE seq = ?", Date.now() - 86_400_000, original);
      });
      expect(await sequence(await send(slug, owner.token, key))).toBeGreaterThan(original);
      expect(await count(slug, key)).toEqual({ messages: 2, receipts: 0 });
    }
  });

  for (const durable of [false, true]) {
    it(`${durable ? "durable" : "ordinary"}: fences concurrent sends that both passed the initial lookup`, async () => {
      const { owner, slug } = await fixture();
      const key = durable ? `cloud-run:${crypto.randomUUID()}` : crypto.randomUUID();
      let restore = () => {};
      await inChannel(slug, (instance) => {
        const runtime = instance as unknown as { routeMentionsForDelivery: (...args: unknown[]) => Promise<unknown> };
        const original = runtime.routeMentionsForDelivery.bind(runtime);
        let arrivals = 0;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        runtime.routeMentionsForDelivery = async (...args) => {
          const routed = await original(...args);
          if (++arrivals === 2) release();
          await gate;
          return routed;
        };
        restore = () => { runtime.routeMentionsForDelivery = original; release(); };
      });
      try {
        const replies = await Promise.all([send(slug, owner.token, key), send(slug, owner.token, key)]);
        const seqs = await Promise.all(replies.map(sequence));
        expect(seqs[0]).toBe(seqs[1]);
        expect(await count(slug, key)).toEqual({ messages: 1, receipts: durable ? 1 : 0 });
      } finally { await inChannel(slug, () => restore()); }
    });
  }

  it("commits the receipt and message atomically under an injected storage failure", async () => {
    const { owner, slug } = await fixture();
    const key = `cloud-run:${crypto.randomUUID()}`;
    await inChannel(slug, (_instance, state) => {
      state.storage.sql.exec(`CREATE TRIGGER fail_collaboration_receipt BEFORE INSERT ON collaboration_message_receipts
        BEGIN SELECT RAISE(ABORT, 'injected collaboration receipt failure'); END`);
    });
    let rejected = false;
    let response: Response | undefined;
    try { response = await send(slug, owner.token, key); } catch { rejected = true; }
    expect(rejected || (response !== undefined && !response.ok)).toBe(true);
    expect(await count(slug, key)).toEqual({ messages: 0, receipts: 0 });
    await inChannel(slug, (_instance, state) => { state.storage.sql.exec("DROP TRIGGER fail_collaboration_receipt"); });
    await sequence(await send(slug, owner.token, key));
    expect(await count(slug, key)).toEqual({ messages: 1, receipts: 1 });
  });

  for (const durable of [false, true]) {
    it(`${durable ? "durable" : "ordinary"}: a reused display name cannot inherit another owner's acknowledgement`, async () => {
      const { owner, slug } = await fixture();
      const key = durable ? `cloud-run:${crypto.randomUUID()}` : crypto.randomUUID();
      const original = await sequence(await send(slug, owner.token, key));
      // Simulate retained data from an earlier principal that used the same name.
      await inChannel(slug, (_instance, state) => {
        state.storage.sql.exec("UPDATE messages SET sender_owner = 'previous@example.com' WHERE seq = ?", original);
        state.storage.sql.exec("UPDATE collaboration_message_receipts SET sender_owner = 'previous@example.com' WHERE message_seq = ?", original);
      });
      expect(await sequence(await send(slug, owner.token, key))).toBeGreaterThan(original);
      expect(await count(slug, key)).toEqual({ messages: 2, receipts: durable ? 2 : 0 });
    });
  }

  it("requires current authorization even for a known durable receipt", async () => {
    const { owner, slug } = await fixture();
    const key = `cloud-run:${crypto.randomUUID()}`;
    await sequence(await send(slug, owner.token, key));
    await env.DB.prepare("UPDATE tokens SET role = 'readonly' WHERE name = ?").bind(owner.name).run();
    const response = await send(slug, owner.token, key);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await count(slug, key)).toEqual({ messages: 1, receipts: 1 });
  });

  it("exports receipt metadata without content and erases it with the sender identity", async () => {
    const { owner, slug } = await fixture();
    const key = `cloud-run:${crypto.randomUUID()}`;
    const seq = await sequence(await send(slug, owner.token, key));
    const path = `/api/channels/${slug}/identity/${encodeURIComponent(owner.name)}/data`;
    const data = await (await api(path, owner.token)).json() as IdentityExportData;
    expect(data.collaboration_receipts).toEqual([expect.objectContaining({ idempotency_key: key, message_seq: seq })]);
    expect(JSON.stringify(data.collaboration_receipts)).not.toContain("Durable collaboration result");
    const after = await (await api(`${path}?receipt_after=${seq}`, owner.token)).json() as IdentityExportData;
    expect(after.collaboration_receipts ?? []).toHaveLength(0);
    expect((await api(path, owner.token, { method: "DELETE" })).status).toBe(200);
    expect(await count(slug, key)).toEqual({ messages: 0, receipts: 0 });
  });
});
