import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchMock } from "./fetch-mock";
import { api, createChannel, seedToken, uniq } from "./helpers";
import { grokSignature } from "../src/collaboration/grok-automation";

const ORIGIN = "https://hooks.grok.test";
const SECRET = "whsec_" + btoa("a".repeat(32));
const INPUT = { name: "Grok research automation", endpoint: ORIGIN + "/trigger/active", signing_secret: SECRET };
beforeEach(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => { try { fetchMock.assertNoPendingInterceptors(); } finally { fetchMock.deactivate(); } });
async function setup() {
  const owner = await seedToken("human", uniq("grok-owner"), { owner: uniq("grok-account") });
  const slug = await createChannel(owner.token);
  const path = `/api/channels/${slug}/bridges/grok-automation`;
  return { owner, slug, path };
}
describe("official Grok Automations webhook bridge", () => {
  it("rejects bearer scope escalation and unapproved/private outbound destinations", async () => {
    const { owner, slug, path } = await setup();
    const agent = await seedToken("agent", uniq("other-agent"), { owner: uniq("owner"), channelScope: slug });
    const outsider = await seedToken("human", uniq("outside"), { owner: uniq("outside") });
    expect((await api(path, agent.token, { method: "PUT", body: JSON.stringify(INPUT) })).status).toBe(403);
    expect((await api(path, outsider.token)).status).toBe(403);
    for (const endpoint of ["http://hooks.grok.test/trigger", "https://localhost/trigger",
      "https://evil.example/trigger", "https://hooks.grok.test@evil.example/trigger",
      "https://hooks.grok.test:8888/trigger", "https://hooks.grok.test/trigger?secret=plain"]) {
      const r = await api(path, owner.token, { method: "PUT", body: JSON.stringify({ ...INPUT, endpoint }) });
      expect(r.status).toBe(400);
    }
    expect((await api(path, owner.token, { method: "PUT", body: JSON.stringify({ ...INPUT, signing_secret: "weak" }) })).status).toBe(400);
    expect((await api(path + "/dispatch", owner.token, { method: "POST", body: JSON.stringify({ request_id: uniq("id"), prompt: "task" }) })).status).toBe(409);
  });
  it("saves encrypted trigger, signs exact delivery body, accepts 202 and deduplicates request ID", async () => {
    const { owner, slug, path } = await setup();
    const r = await api(path, owner.token, { method: "PUT", body: JSON.stringify(INPUT) });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ configured: true, name: INPUT.name, delivery: "explicit-human-trigger" });
    const raw = await env.DB.prepare("SELECT endpoint_ciphertext,secret_ciphertext FROM grok_automation_connections WHERE channel_slug=?")
      .bind(slug).first<{ endpoint_ciphertext: string; secret_ciphertext: string }>();
    expect(raw!.endpoint_ciphertext).toMatch(/^v1\./);
    expect(raw!.secret_ciphertext).toMatch(/^v1\./);
    expect(JSON.stringify(raw)).not.toContain(INPUT.endpoint);
    expect(JSON.stringify(raw)).not.toContain(SECRET);
    let delivered = 0;
    fetchMock.get(ORIGIN).intercept({ path: "/trigger/active", method: "POST" }).reply(202, async request => {
      delivered++;
      const data = JSON.parse(request.body);
      expect(data).toMatchObject({ event: "agentcommons.task_assigned", channel_id: slug, request_id: "same-42", prompt: "Review this issue" });
      expect(request.headers["webhook-signature"]).toBe(await grokSignature(SECRET,
        request.headers["webhook-id"]!, request.headers["webhook-timestamp"]!, request.body));
      return {};
    });
    const request = { request_id: "same-42", prompt: "Review this issue" };
    const dispatch = () => api(path + "/dispatch", owner.token, { method: "POST", body: JSON.stringify(request) });
    const first = await dispatch();
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ delivery: { state: "submitted", request_id: "same-42" }, completion_confirmed: false });
    const repeated = await dispatch();
    expect(await repeated.json()).toMatchObject({ reused: true, delivery: { state: "submitted" } });
    expect(delivered).toBe(1);
    expect((await api(path + "/dispatch", owner.token, { method: "POST", body: JSON.stringify({ ...request, prompt: "changed" }) })).status).toBe(409);
    const listing = await (await api(path, owner.token)).text();
    expect(listing).not.toContain(SECRET);
    expect(listing).not.toContain(INPUT.endpoint);
    expect(listing).toContain('"submitted"');
  });
  it("records uncertain external outcomes without a paid blind retry", async () => {
    const { owner, path } = await setup();
    expect((await api(path, owner.token, { method: "PUT", body: JSON.stringify(INPUT) })).status).toBe(201);
    fetchMock.get(ORIGIN).intercept({ path: "/trigger/active", method: "POST" }).reply(503, { private_debug: SECRET });
    const request = { request_id: "uncertain-1", prompt: "Check a task" };
    const first = await (await api(path + "/dispatch", owner.token, { method: "POST", body: JSON.stringify(request) })).text();
    expect(first).not.toContain(SECRET);
    expect(JSON.parse(first)).toMatchObject({ delivery: { state: "unknown" } });
    expect(await (await api(path + "/dispatch", owner.token, { method: "POST", body: JSON.stringify(request) })).json()).toMatchObject({ reused: true });
    expect((await api(path, owner.token, { method: "DELETE" })).status).toBe(200);
    expect((await api(path + "/dispatch", owner.token, { method: "POST", body: JSON.stringify({ request_id: "other", prompt: "task" }) })).status).toBe(409);
  });
});
