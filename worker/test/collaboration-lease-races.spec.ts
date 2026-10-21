import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CloudAgentRun } from "@agentparty/shared/collaboration";
import { fetchMock } from "./fetch-mock";

import { createChannel, seedToken, uniq } from "./helpers";
import { concurrentApi as api } from "./concurrent-api";

// Explicit gates, not sleeps or fake clocks: expire only the selected database
// lease while a real request is paused at its external HTTP boundary.
function gate() {
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  return { entered, release, block: async () => { enter(); await released; } };
}
const CAPABILITIES = { object: "hermes.api_server.capabilities", platform: "hermes-agent", model: "hermes",
  auth: { type: "bearer", required: true }, features: { run_submission: true, run_status: true, run_stop: true } };
function capabilities() { fetchMock.get("https://hermes.test").intercept({ path: "/v1/capabilities", method: "GET" }).reply(200, CAPABILITIES); }
beforeEach(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => { try { fetchMock.assertNoPendingInterceptors(); } finally { fetchMock.deactivate(); } });
async function setup() {
  const owner = await seedToken("human", uniq("race-owner"), { owner: `${uniq("account")}@example.com` });
  const slug = await createChannel(owner.token); const id = uniq("connection");
  const path = `/api/channels/${slug}/cloud-agents/${id}`;
  capabilities();
  expect((await api(path, owner.token, { method: "PUT", body: JSON.stringify({ provider: "hermes", name: "Race fixture",
    endpoint: "https://hermes.test", credential: "synthetic-race-fixture-key" }) })).status).toBe(201);
  return { owner, slug, id, path };
}
type Setup = Awaited<ReturnType<typeof setup>>;
function start(context: Setup, requestId: string) {
  return api(`${context.path}/runs`, context.owner.token, { method: "POST", body: JSON.stringify({ prompt: "Review the group task", request_id: requestId }) });
}
async function row(id: string) {
  return (await env.DB.prepare("SELECT * FROM cloud_agent_runs WHERE id=?").bind(id).first())!;
}
async function running(context: Setup) {
  let session = "";
  fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs", method: "POST" }).reply(200, (request) => {
    session = JSON.parse(request.body).session_id;
    return { run_id: "racing-run", session_id: session, status: "running" };
  });
  const response = await start(context, uniq("start"));
  expect(response.status).toBe(201);
  return { run: (await response.json() as { run: CloudAgentRun }).run, session };
}

describe("cloud run lease fencing", () => {
  it("discards a superseded successful start without publishing or releasing the new lease", async () => {
    const context = await setup(); const paused = gate(); const requestId = uniq("late-start");
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs", method: "POST" }).reply(200, async (request) => {
      await paused.block(); return { run_id: "old-receipt", session_id: JSON.parse(request.body).session_id, status: "completed", output: "STALE ANSWER" };
    });
    const pending = start(context, requestId);
    await reached(paused.entered);
    const saved = (await env.DB.prepare("SELECT id,lease_token FROM cloud_agent_runs WHERE request_id=?").bind(requestId).first<{ id: string; lease_token: string }>())!;
    const nextToken = crypto.randomUUID(); const nextUntil = Date.now() + 90_000;
    try {
      expect(saved.lease_token).toBeTruthy();
      await env.DB.prepare("UPDATE cloud_agent_runs SET lease_token=?,lease_until=?,state='running',remote_run_id='new-receipt',error='new owner note' WHERE id=?")
        .bind(nextToken, nextUntil, saved.id).run();
      paused.release();
      const response = await pending;
      expect(await response.json()).toMatchObject({ run: { state: "running", result: null, error: "new owner note" } });
      expect(await row(saved.id)).toMatchObject({ lease_token: nextToken, lease_until: nextUntil, remote_run_id: "new-receipt", reply_message_seq: null });
      expect(await (await api(`/api/channels/${context.slug}/messages`, context.owner.token)).text()).not.toContain("STALE ANSWER");
    } finally { paused.release(); await pending; }
  });

  it("discards a superseded failed start without damaging a newer result", async () => {
    const context = await setup(); const paused = gate(); const requestId = uniq("late-error");
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs", method: "POST" }).reply(503, async () => {
      await paused.block(); return { debug: "never expose this provider body" };
    });
    const pending = start(context, requestId); await reached(paused.entered);
    const saved = (await env.DB.prepare("SELECT id FROM cloud_agent_runs WHERE request_id=?").bind(requestId).first<{ id: string }>())!;
    const nextToken = crypto.randomUUID(); const nextUntil = Date.now() + 90_000;
    try {
      await env.DB.prepare("UPDATE cloud_agent_runs SET lease_token=?,lease_until=?,state='completed',result='Saved by new owner',error=NULL WHERE id=?")
        .bind(nextToken, nextUntil, saved.id).run();
      paused.release();
      expect(await (await pending).json()).toMatchObject({ run: { state: "completed", result: "Saved by new owner", error: null } });
      expect(await row(saved.id)).toMatchObject({ lease_token: nextToken, lease_until: nextUntil, state: "completed" });
    } finally { paused.release(); await pending; }
  });

  it("does not undo a confirmed cancellation when an older sync finishes", async () => {
    const context = await setup(); const { run, session } = await running(context); const paused = gate();
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs/racing-run", method: "GET" }).reply(200, async () => {
      await paused.block(); return { run_id: "racing-run", session_id: session, status: "completed", output: "OBSOLETE POLL ANSWER" };
    });
    const oldSync = api(`${context.path}/runs/${run.id}/sync`, context.owner.token, { method: "POST" }); await reached(paused.entered);
    try {
      await env.DB.prepare("UPDATE cloud_agent_runs SET lease_until=0 WHERE id=?").bind(run.id).run();
      capabilities();
      fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs/racing-run/stop", method: "POST" }).reply(200, { status: "cancelled" });
      expect(await (await api(`${context.path}/runs/${run.id}/cancel`, context.owner.token, { method: "POST" })).json())
        .toMatchObject({ run: { state: "cancelled" } });
      paused.release();
      expect(await (await oldSync).json()).toMatchObject({ run: { state: "cancelled", result: null } });
      expect(await row(run.id)).toMatchObject({ state: "cancelled", lease_token: null, lease_until: 0, reply_message_seq: null });
      expect(await (await api(`/api/channels/${context.slug}/messages`, context.owner.token)).text()).not.toContain("OBSOLETE POLL ANSWER");
    } finally { paused.release(); await oldSync; }
  });

  it("cannot release an in-flight cancellation lease or replace its error with an old poll failure", async () => {
    const context = await setup(); const { run } = await running(context); const pollGate = gate(); const stopGate = gate();
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs/racing-run", method: "GET" }).reply(503, async () => {
      await pollGate.block(); return { debug: "late poll failure" };
    });
    const oldSync = api(`${context.path}/runs/${run.id}/sync`, context.owner.token, { method: "POST" }); await reached(pollGate.entered);
    let stopping: ReturnType<typeof api> | undefined;
    try {
      await env.DB.prepare("UPDATE cloud_agent_runs SET lease_until=0 WHERE id=?").bind(run.id).run();
      capabilities();
      fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs/racing-run/stop", method: "POST" }).reply(200, async () => {
        await stopGate.block(); return { status: "cancelled" };
      });
      stopping = api(`${context.path}/runs/${run.id}/cancel`, context.owner.token, { method: "POST" }); await reached(stopGate.entered);
      const newer = await row(run.id);
      pollGate.release(); await oldSync;
      expect(await row(run.id)).toMatchObject({ lease_token: newer.lease_token, lease_until: newer.lease_until, error: null });
      stopGate.release();
      expect(await (await stopping).json()).toMatchObject({ run: { state: "cancelled" } });
    } finally { pollGate.release(); stopGate.release(); await oldSync; if (stopping) await stopping; }
  });

  it("revokes in-flight authority, purges encrypted credentials, and rejects late result import", async () => {
    const context = await setup(); const paused = gate(); const requestId = uniq("revoke");
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs", method: "POST" }).reply(200, async (request) => {
      await paused.block(); return { run_id: "revoked-receipt", session_id: JSON.parse(request.body).session_id, status: "completed", output: "REVOKED ANSWER" };
    });
    const pending = start(context, requestId); await reached(paused.entered);
    try {
      expect((await api(context.path, context.owner.token, { method: "DELETE" })).status).toBe(200);
      const connection = await env.DB.prepare("SELECT credential_ciphertext,agent_token_ciphertext,revoked_at FROM cloud_agent_connections WHERE channel_slug=? AND id=?")
        .bind(context.slug, context.id).first();
      expect(connection).toMatchObject({ credential_ciphertext: "", agent_token_ciphertext: "", revoked_at: expect.any(Number) });
      paused.release();
      const { run } = await (await pending).json() as { run: CloudAgentRun };
      expect(run).toMatchObject({ state: "unknown", result: null, reply_message_seq: null });
      expect(run.error).toContain("Connection revoked");
      expect(await row(run.id)).toMatchObject({ lease_token: null, lease_until: 0 });
      expect(await (await api(`/api/channels/${context.slug}/messages`, context.owner.token)).text()).not.toContain("REVOKED ANSWER");
    } finally { paused.release(); await pending; }
  });
});

async function reached(promise: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("The expected network barrier was not reached")), 5_000);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
