import type { CloudAgentConnection, CloudAgentRun } from "@agentparty/shared/collaboration";
import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChannelDO } from "../src/do";
import { fetchMock } from "./fetch-mock";
import { interceptFetchResponse } from "./intercepted-fetch";
import { api, createChannel, seedToken, uniq } from "./helpers";

const ORIGIN = "https://hermes.test";
const CAPABILITIES = { object: "hermes.api_server.capabilities", platform: "hermes-agent", model: "hermes",
  auth: { type: "bearer", required: true }, features: { run_submission: true, run_status: true, run_stop: true } };
beforeEach(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => { try { fetchMock.assertNoPendingInterceptors(); } finally { fetchMock.deactivate(); } });

async function setup() {
  const owner = await seedToken("human", uniq("owner"), { owner: `${uniq("account")}@example.com` });
  const slug = await createChannel(owner.token);
  const id = uniq("cloud");
  fetchMock.get(ORIGIN).intercept({ path: "/v1/capabilities", method: "GET" }).reply(200, CAPABILITIES);
  const response = await api(`/api/channels/${slug}/cloud-agents/${id}`, owner.token, { method: "PUT",
    body: JSON.stringify({ provider: "hermes", name: "Hermes", endpoint: ORIGIN, credential: "synthetic-recovery-test-key" }) });
  expect(response.status).toBe(201);
  const { connection } = await response.json() as { connection: CloudAgentConnection };
  const base = `/api/channels/${slug}/cloud-agents/${connection.id}`;
  const requestId = uniq("request");
  return { owner, slug, connection, base, requestId,
    start: () => api(`${base}/runs`, owner.token, { method: "POST", body: JSON.stringify({ prompt: "Review this task", request_id: requestId }) }),
    sync: (run: CloudAgentRun) => api(`${base}/runs/${run.id}/sync`, owner.token, { method: "POST" }),
  };
}
async function saved(id: string) {
  return (await env.DB.prepare("SELECT * FROM cloud_agent_runs WHERE id=?").bind(id).first())!;
}
async function running(context: Awaited<ReturnType<typeof setup>>) {
  let session = "";
  fetchMock.get(ORIGIN).intercept({ path: "/v1/runs", method: "POST" }).reply(200, (request) => {
    session = JSON.parse(request.body).session_id;
    return { run_id: "recovery-run", session_id: session, status: "running" };
  });
  const response = await context.start(); expect(response.status).toBe(201);
  const { run } = await response.json() as { run: CloudAgentRun };
  return { run, session };
}

describe("cloud run lease fencing and recovery", () => {
  for (const failure of [false, true]) {
    it(`a delayed ${failure ? "error" : "status"} cannot overwrite or unlock the next lease`, async () => {
      const context = await setup(); const { run, session } = await running(context);
      const path = "/v1/runs/recovery-run";
      fetchMock.get(ORIGIN).intercept({ path, method: "GET" }).reply(failure ? 503 : 200,
        failure ? { internal: "synthetic-secret-error" } : { run_id: "recovery-run", session_id: session, status: "running" });
      const successorToken = crypto.randomUUID(); const successorDeadline = Date.now() + 120_000;
      const injection = interceptFetchResponse((url, method) => url.origin === ORIGIN && url.pathname === path && method === "GET", async (response) => {
        const previous = await saved(run.id);
        expect(previous.lease_token).toEqual(expect.any(String));
        expect(previous.lease_token).not.toBe(successorToken);
        // Simulate the successful database claim of an expired lease by request two.
        await env.DB.prepare("UPDATE cloud_agent_runs SET lease_token=?,lease_until=?,error=NULL WHERE id=?")
          .bind(successorToken, successorDeadline, run.id).run();
        return response;
      });
      try {
        const response = await context.sync(run);
        expect(response.status).toBe(200);
        expect(await response.text()).not.toContain("synthetic-secret-error");
        expect(await saved(run.id)).toMatchObject({ state: "running", lease_token: successorToken, lease_until: successorDeadline, error: null });
      } finally { injection.restore(); }
      // Complete the next actual sync after its simulated predecessor expires.
      await env.DB.prepare("UPDATE cloud_agent_runs SET lease_until=0 WHERE id=?").bind(run.id).run();
      fetchMock.get(ORIGIN).intercept({ path, method: "GET" }).reply(200,
        { run_id: "recovery-run", session_id: session, status: "completed", output: "The successor's final answer" });
      expect(await (await context.sync(run)).json()).toMatchObject({ run: { state: "completed", result: "The successor's final answer", reply_message_seq: expect.any(Number) } });
      expect(await saved(run.id)).toMatchObject({ state: "completed", lease_token: null, lease_until: 0, error: null });
    });
  }

  it("a late initial submission cannot replace a newer unknown-outcome investigation", async () => {
    const context = await setup();
    fetchMock.get(ORIGIN).intercept({ path: "/v1/runs", method: "POST" }).reply(200, (request) => ({
      run_id: "late-start", session_id: JSON.parse(request.body).session_id, status: "completed", output: "Stale final output",
    }));
    const token = crypto.randomUUID(); const deadline = Date.now() + 60_000;
    const injection = interceptFetchResponse((url, method) => url.origin === ORIGIN && url.pathname === "/v1/runs" && method === "POST", async (response) => {
      await env.DB.prepare("UPDATE cloud_agent_runs SET state='unknown',error='Newer investigation',lease_token=?,lease_until=? WHERE connection_id=? AND channel_slug=?")
        .bind(token, deadline, context.connection.id, context.slug).run();
      return response;
    });
    try {
      const response = await context.start();
      expect(response.status).toBe(201);
      const { run } = await response.json() as { run: CloudAgentRun };
      expect(run).toMatchObject({ state: "unknown", result: null, error: "Newer investigation" });
      expect(await saved(run.id)).toMatchObject({ lease_token: token, lease_until: deadline, result: null, remote_run_id: null });
      expect(await (await api(`/api/channels/${context.slug}/messages`, context.owner.token)).text()).not.toContain("Stale final output");
    } finally { injection.restore(); }
  });

  for (const prune of [false, true]) {
    it(`a saved answer survives receipt-write failure and retries ${prune ? "after history pruning" : "after a day"} without another provider run`, async () => {
      const context = await setup();
      await env.DB.prepare(`CREATE TRIGGER fail_run_receipt BEFORE UPDATE OF reply_message_seq ON cloud_agent_runs
        WHEN NEW.connection_id = '${context.connection.id}' BEGIN SELECT RAISE(ABORT, 'injected receipt persistence failure'); END`).run();
      fetchMock.get(ORIGIN).intercept({ path: "/v1/runs", method: "POST" }).reply(200, (request) => ({
        run_id: "saved-result", session_id: JSON.parse(request.body).session_id, status: "completed", output: "Persisted final answer",
      }));
      let run: CloudAgentRun;
      try {
        const response = await context.start(); expect(response.status).toBe(201);
        ({ run } = await response.json() as { run: CloudAgentRun });
        expect(run).toMatchObject({ state: "completed", result: "Persisted final answer", reply_message_seq: null });
      } finally { await env.DB.prepare("DROP TRIGGER fail_run_receipt").run(); }
      const stub = env.CHANNELS.get(env.CHANNELS.idFromName(context.slug));
      const original = await runInDurableObject(stub, (_instance: ChannelDO, state) => {
        const row = state.storage.sql.exec("SELECT seq FROM messages WHERE idempotency_key=?", `cloud-run:${run.id}`).one();
        const seq = Number(row.seq);
        if (prune) state.storage.sql.exec("DELETE FROM messages WHERE seq=?", seq);
        else state.storage.sql.exec("UPDATE messages SET ts=? WHERE seq=?", Date.now() - 86_400_000, seq);
        return seq;
      });
      // No new network fixtures: recovery must use the saved answer, never rerun paid work.
      expect(await (await context.sync(run)).json()).toMatchObject({ run: { state: "completed", result: "Persisted final answer", reply_message_seq: original, error: null } });
      await runInDurableObject(stub, (_instance: ChannelDO, state) => {
        expect(Number(state.storage.sql.exec("SELECT COUNT(*) AS n FROM messages WHERE idempotency_key=?", `cloud-run:${run.id}`).one().n)).toBe(prune ? 0 : 1);
      });
    });
  }

  it("revocation fences an in-flight result and prevents it from being imported", async () => {
    const context = await setup(); const { run, session } = await running(context);
    const path = "/v1/runs/recovery-run";
    fetchMock.get(ORIGIN).intercept({ path, method: "GET" }).reply(200,
      { run_id: "recovery-run", session_id: session, status: "completed", output: "Revoked output must not be imported" });
    const injection = interceptFetchResponse((url, method) => url.origin === ORIGIN && url.pathname === path && method === "GET", async (response) => {
      expect((await api(context.base, context.owner.token, { method: "DELETE" })).status).toBe(200);
      return response;
    });
    try {
      expect(await (await context.sync(run)).json()).toMatchObject({ run: { state: "unknown", result: null, reply_message_seq: null } });
      expect(await saved(run.id)).toMatchObject({ lease_token: null, lease_until: 0, result: null });
      expect(await (await api(`/api/channels/${context.slug}/messages`, context.owner.token)).text()).not.toContain("Revoked output");
    } finally { injection.restore(); }
  });
});
