import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChannelFile, ChannelRepository, CloudAgentConnection, CloudAgentRun } from "@agentparty/shared/collaboration";
import { fetchMock } from "./fetch-mock";
import { requestGate } from "./request-gate";
import { handlerApi, statementHook } from "./handler-api";
import { concurrentApi } from "./concurrent-api";
import { api, createChannel, seedToken, uniq } from "./helpers";
import { openCredential, sealCredential } from "../src/collaboration/vault";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const CREDENTIAL = "synthetic-test-credential-never-return";
const CAPABILITIES = { object: "hermes.api_server.capabilities", platform: "hermes-agent", model: "hermes",
  auth: { type: "bearer", required: true }, features: { run_submission: true, run_status: true, run_stop: true } };
beforeEach(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => { try { fetchMock.assertNoPendingInterceptors(); } finally { fetchMock.deactivate(); } });
function capabilities() { fetchMock.get("https://hermes.test").intercept({ path: "/v1/capabilities", method: "GET" }).reply(200, CAPABILITIES); }
async function group() {
  const account = `${uniq("owner")}@example.com`;
  const owner = await seedToken("human", uniq("human"), { owner: account });
  const slug = await createChannel(owner.token);
  return { owner, slug, account };
}
async function connect(slug: string, token: string, id = uniq("cloud")) {
  capabilities();
  const response = await api(`/api/channels/${slug}/cloud-agents/${id}`, token, { method: "PUT",
    body: JSON.stringify({ provider: "hermes", name: "Hermes", endpoint: "https://hermes.test", credential: CREDENTIAL }) });
  expect(response.status).toBe(201);
  const payload = await response.json() as { connection: CloudAgentConnection };
  return payload.connection;
}
function start(slug: string, token: string, id: string, requestId = uniq("request"), prompt = "Please review the group task") {
  return api(`/api/channels/${slug}/cloud-agents/${id}/runs`, token, { method: "POST", body: JSON.stringify({ prompt, request_id: requestId }) });
}

function concurrentStart(slug: string, token: string, id: string, requestId = uniq("request"), prompt = "Please review the group task") {
  return concurrentApi(`/api/channels/${slug}/cloud-agents/${id}/runs`, token, { method: "POST", body: JSON.stringify({ prompt, request_id: requestId }) });
}

/** Explicit barriers make takeover tests deterministic; no wall-clock sleeps. */
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe("personal agent collaboration", () => {
  it.each([200, 503])("fences a late start response (%s) after another sync takes over", async (status) => {
    const { owner, slug } = await group(); const connection = await connect(slug, owner.token);
    const entered = barrier(); const resume = barrier(); const requestId = uniq("late-start");
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs", method: "POST" }).reply(status, async (request) => {
      entered.release(); await resume.promise;
      return status === 200 ? { run_id: "late-start", session_id: JSON.parse(request.body).session_id,
        status: "completed", output: "Do not import this stale answer" } : { secret_debug: CREDENTIAL };
    });
    const pending = concurrentStart(slug, owner.token, connection.id, requestId);
    try {
      await entered.promise;
      const row = (await env.DB.prepare("SELECT id,lease_token FROM cloud_agent_runs WHERE channel_slug=? AND connection_id=? AND request_id=?")
        .bind(slug, connection.id, requestId).first<{ id: string; lease_token: string }>())!;
      expect(row.lease_token).toEqual(expect.any(String));
      await env.DB.prepare("UPDATE cloud_agent_runs SET lease_until=0 WHERE id=?").bind(row.id).run();
      const takeover = await concurrentApi(`/api/channels/${slug}/cloud-agents/${connection.id}/runs/${row.id}/sync`, owner.token, { method: "POST" });
      expect(await takeover.json()).toMatchObject({ run: { state: "unknown" } });
      resume.release();
      const response = await pending; const text = await response.text();
      expect(text).not.toContain(CREDENTIAL); expect(text).not.toContain(row.lease_token);
      expect(JSON.parse(text)).toMatchObject({ run: { state: "unknown", result: null, reply_message_seq: null } });
      const saved = await env.DB.prepare("SELECT state,error,lease_token,lease_until,remote_run_id FROM cloud_agent_runs WHERE id=?").bind(row.id).first();
      expect(saved).toMatchObject({ state: "unknown", lease_token: null, lease_until: 0, remote_run_id: null });
      expect(saved!.error).toContain("No remote receipt");
      expect(await (await concurrentStart(slug, owner.token, connection.id, requestId)).json()).toMatchObject({ reused: true, run: { id: row.id } });
      expect(await (await concurrentApi(`/api/channels/${slug}/messages`, owner.token)).text()).not.toContain("Do not import");
    } finally { resume.release(); await pending; }
  });

  it.each([200, 503])("does not let an expired poll (%s) save over or unlock its in-flight successor", async (status) => {
    const { owner, slug } = await group(); const connection = await connect(slug, owner.token);
    let session = "";
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs", method: "POST" }).reply(200, (request) => {
      session = JSON.parse(request.body).session_id; return { run_id: "poll-fence", session_id: session, status: "running" };
    });
    const { run } = await (await concurrentStart(slug, owner.token, connection.id)).json() as { run: CloudAgentRun };
    const entered = barrier(); const resume = barrier(); const successorEntered = barrier(); const successorResume = barrier();
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs/poll-fence", method: "GET" }).reply(status, async () => {
      entered.release(); await resume.promise;
      return status === 200 ? { run_id: "poll-fence", session_id: session, status: "completed", output: "STALE POLL ANSWER" }
        : { secret_debug: CREDENTIAL };
    });
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs/poll-fence", method: "GET" }).reply(200, async () => {
      successorEntered.release(); await successorResume.promise;
      return { run_id: "poll-fence", session_id: session, status: "completed", output: "AUTHORITATIVE POLL ANSWER" };
    });
    const path = `/api/channels/${slug}/cloud-agents/${connection.id}/runs/${run.id}/sync`;
    const first = concurrentApi(path, owner.token, { method: "POST" }); let second: Promise<Response> | undefined;
    try {
      await entered.promise;
      await env.DB.prepare("UPDATE cloud_agent_runs SET lease_until=0 WHERE id=?").bind(run.id).run();
      second = concurrentApi(path, owner.token, { method: "POST" }); await successorEntered.promise;
      const ownership = await env.DB.prepare("SELECT lease_token,lease_until FROM cloud_agent_runs WHERE id=?").bind(run.id).first();
      resume.release();
      expect(await (await first).json()).toMatchObject({ run: { state: "running", result: null, error: null } });
      expect(await env.DB.prepare("SELECT lease_token,lease_until FROM cloud_agent_runs WHERE id=?").bind(run.id).first()).toEqual(ownership);
      successorResume.release();
      expect(await (await second).json()).toMatchObject({ run: { state: "completed", result: "AUTHORITATIVE POLL ANSWER", reply_message_seq: expect.any(Number) } });
      const messages = await (await concurrentApi(`/api/channels/${slug}/messages`, owner.token)).json() as { messages: Array<{ body: string }> };
      expect(messages.messages.filter((m) => m.body?.includes("AUTHORITATIVE POLL ANSWER"))).toHaveLength(1);
      expect(messages.messages.filter((m) => m.body?.includes("STALE POLL ANSWER"))).toHaveLength(0);
      expect(await env.DB.prepare("SELECT lease_token,lease_until FROM cloud_agent_runs WHERE id=?").bind(run.id).first()).toMatchObject({ lease_token: null, lease_until: 0 });
    } finally {
      resume.release(); successorResume.release();
      await Promise.all([first, ...(second ? [second] : [])]);
    }
  });

  it("atomically revokes an in-flight connection, erases stored credentials and rejects its late answer", async () => {
    const { owner, slug } = await group(); const connection = await connect(slug, owner.token);
    const entered = barrier(); const resume = barrier();
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs", method: "POST" }).reply(200, async (request) => {
      entered.release(); await resume.promise;
      return { run_id: "revoked-run", session_id: JSON.parse(request.body).session_id, status: "completed", output: "REVOKED PRIVATE ANSWER" };
    });
    const pending = concurrentStart(slug, owner.token, connection.id);
    try {
      await entered.promise;
      const response = await concurrentApi(`/api/channels/${slug}/cloud-agents/${connection.id}`, owner.token, { method: "DELETE" });
      expect(await response.json()).toEqual({ revoked: true, remote_work_cancelled: false });
      resume.release();
      expect(await (await pending).json()).toMatchObject({ run: { state: "unknown", result: null, reply_message_seq: null } });
      const saved = await env.DB.prepare("SELECT revoked_at,credential_ciphertext,agent_token_ciphertext,agent_token_hash FROM cloud_agent_connections WHERE channel_slug=? AND id=?")
        .bind(slug, connection.id).first();
      expect(saved).toMatchObject({ revoked_at: expect.any(Number), credential_ciphertext: "", agent_token_ciphertext: "" });
      expect(await env.DB.prepare("SELECT revoked_at FROM tokens WHERE hash=?").bind(saved!.agent_token_hash).first()).toMatchObject({ revoked_at: expect.any(Number) });
      expect(await env.DB.prepare("SELECT lease_token,lease_until,state FROM cloud_agent_runs WHERE channel_slug=? AND connection_id=?")
        .bind(slug, connection.id).first()).toMatchObject({ lease_token: null, lease_until: 0, state: "unknown" });
      expect(await (await concurrentApi(`/api/channels/${slug}/messages`, owner.token)).text()).not.toContain("REVOKED PRIVATE ANSWER");
    } finally { resume.release(); await pending; }
  });

  it("keeps a completed result when saving its group receipt fails, then recovers without another provider run", async () => {
    const { owner, slug } = await group(); const connection = await connect(slug, owner.token);
    const entered = barrier(); const resume = barrier(); const requestId = uniq("receipt-fault");
    const trigger = uniq("receipt_fault").replaceAll("-", "_"); let created = false;
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs", method: "POST" }).reply(200, async (request) => {
      entered.release(); await resume.promise;
      return { run_id: "receipt-run", session_id: JSON.parse(request.body).session_id, status: "completed", output: "SAVED DESPITE RECEIPT FAILURE" };
    });
    const pending = concurrentStart(slug, owner.token, connection.id, requestId);
    try {
      await entered.promise;
      const row = (await env.DB.prepare("SELECT id FROM cloud_agent_runs WHERE channel_slug=? AND connection_id=? AND request_id=?")
        .bind(slug, connection.id, requestId).first<{ id: string }>())!;
      // Fault injection targets only this generated test row and only its receipt.
      await env.DB.prepare(`CREATE TRIGGER ${trigger} BEFORE UPDATE OF reply_message_seq ON cloud_agent_runs
        WHEN NEW.id = '${row.id}' BEGIN SELECT RAISE(ABORT, 'synthetic receipt storage failure'); END`).run();
      created = true; resume.release();
      expect(await (await pending).json()).toMatchObject({ run: { state: "completed", result: "SAVED DESPITE RECEIPT FAILURE", reply_message_seq: null } });
      await env.DB.prepare(`DROP TRIGGER ${trigger}`).run(); created = false;
      expect(await (await concurrentApi(`/api/channels/${slug}/cloud-agents/${connection.id}/runs/${row.id}/sync`, owner.token, { method: "POST" })).json())
        .toMatchObject({ run: { state: "completed", reply_message_seq: expect.any(Number) } });
      const messages = await (await concurrentApi(`/api/channels/${slug}/messages`, owner.token)).json() as { messages: Array<{ body: string }> };
      expect(messages.messages.filter((m) => m.body?.includes("SAVED DESPITE RECEIPT FAILURE"))).toHaveLength(1);
    } finally {
      resume.release(); await pending;
      if (created) await env.DB.prepare(`DROP TRIGGER ${trigger}`).run();
    }
  });

  it("encrypts record-bound credentials and fails closed without a key", async () => {
    const cipher = await sealCredential("secret", KEY, "channel-a:connection");
    expect(cipher).not.toContain("secret");
    expect(await openCredential(cipher, KEY, "channel-a:connection")).toBe("secret");
    await expect(openCredential(cipher, KEY, "channel-b:connection")).rejects.toThrow("cannot be decrypted");
    await expect(sealCredential("secret", undefined, "channel-a:connection")).rejects.toThrow("not configured");
    await expect(sealCredential("secret", "weak", "channel-a:connection")).rejects.toThrow("not configured");
  });

  it("requires a human owner to bind credentials and never returns credential envelopes or tokens", async () => {
    const { owner, slug, account } = await group();
    const agent = await seedToken("agent", uniq("agent"), { owner: account, channelScope: slug });
    const outsider = await seedToken("human", uniq("outsider"), { owner: "other@example.com" });
    const body = JSON.stringify({ provider: "hermes", name: "Hermes", endpoint: "https://hermes.test", credential: CREDENTIAL });
    expect((await api(`/api/channels/${slug}/cloud-agents/forbidden`, agent.token, { method: "PUT", body })).status).toBe(403);
    expect((await api(`/api/channels/${slug}/collaboration`, outsider.token)).status).toBe(403);
    const connection = await connect(slug, owner.token);
    const summary = await api(`/api/channels/${slug}/collaboration`, owner.token);
    const text = await summary.text();
    expect(text).not.toContain(CREDENTIAL);
    expect(text).not.toContain("ciphertext");
    expect(text).not.toContain("ap_");
    expect(JSON.parse(text).connections[0]).toMatchObject({ status: "verified", mode: "manual", credential_configured: true });
    const row = await env.DB.prepare("SELECT credential_ciphertext,agent_token_ciphertext,agent_token_hash FROM cloud_agent_connections WHERE channel_slug=? AND id=?")
      .bind(slug, connection.id).first<{ credential_ciphertext: string; agent_token_ciphertext: string; agent_token_hash: string }>();
    expect(row!.credential_ciphertext).not.toContain(CREDENTIAL);
    const tokenRow = await env.DB.prepare("SELECT role,channel_scope,owner FROM tokens WHERE hash=?").bind(row!.agent_token_hash).first();
    expect(tokenRow).toMatchObject({ role: "agent", channel_scope: slug, owner: account });
    const scopedToken = await openCredential(row!.agent_token_ciphertext, KEY, `cloud:${slug}:${connection.id}:token`);
    const otherSlug = await createChannel(owner.token);
    expect((await api(`/api/channels/${otherSlug}/messages`, scopedToken)).status).toBe(403);
    expect((await api(`/api/channels/${otherSlug}/visibility`, owner.token, { method: "PUT", body: JSON.stringify({ visibility: "public", confirm: true }) })).status).toBe(200);
    expect((await api(`/api/channels/${otherSlug}/messages`, scopedToken)).status).toBe(403);
  });

  it("runs Hermes once, recovers via sync and publishes exactly one reply as a scoped agent", async () => {
    const { owner, slug } = await group();
    const connection = await connect(slug, owner.token);
    const requestId = uniq("same-request");
    let session = ""; let calls = 0;
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs", method: "POST" }).reply(200, (request) => {
      calls++; const input = JSON.parse(request.body); session = input.session_id;
      expect(request.headers.authorization).toBe(`Bearer ${CREDENTIAL}`);
      expect(session).toMatch(/^commons-/);
      return { run_id: "run-correlated", session_id: session, status: "running" };
    });
    const first = await start(slug, owner.token, connection.id, requestId);
    expect(first.status).toBe(201);
    const run = ((await first.json()) as { run: CloudAgentRun }).run;
    expect(run.state).toBe("running");
    const duplicate = await start(slug, owner.token, connection.id, requestId);
    expect(await duplicate.json()).toMatchObject({ reused: true, run: { id: run.id } });
    expect((await start(slug, owner.token, connection.id, requestId, "A different prompt")).status).toBe(409);
    expect((await start(slug, owner.token, connection.id)).status).toBe(409);
    expect(calls).toBe(1);
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs/run-correlated", method: "GET" })
      .reply(200, { run_id: "run-correlated", session_id: session, status: "completed", output: "The group task is reviewed." });
    const syncPath = `/api/channels/${slug}/cloud-agents/${connection.id}/runs/${run.id}/sync`;
    const synced = await api(syncPath, owner.token, { method: "POST" });
    expect(await synced.json()).toMatchObject({ run: { state: "completed", result: "The group task is reviewed.", reply_message_seq: expect.any(Number) } });
    await api(syncPath, owner.token, { method: "POST" });
    const messages = await api(`/api/channels/${slug}/messages`, owner.token);
    const payload = await messages.json() as { messages: Array<{ body?: string; sender?: { name: string; kind: string } }> };
    const answers = payload.messages.filter((message) => message.body?.includes("The group task is reviewed."));
    expect(answers).toHaveLength(1);
    expect(answers[0]!.sender).toMatchObject({ name: connection.agent_name, kind: "agent" });
  });

  it("does not let agents, readonly users, or public-watch outsiders trigger paid work", async () => {
    const { owner, slug, account } = await group();
    const connection = await connect(slug, owner.token);
    const agent = await seedToken("agent", uniq("agent"), { owner: account, channelScope: slug });
    const readonly = await seedToken("readonly", uniq("reader"), { owner: account, channelScope: slug });
    expect((await start(slug, agent.token, connection.id)).status).toBe(403);
    expect((await start(slug, readonly.token, connection.id)).status).toBe(403);
    expect((await api(`/api/channels/${slug}/visibility`, owner.token, { method: "PUT", body: JSON.stringify({ visibility: "public_watch", confirm: true }) })).status).toBe(200);
    const observer = await seedToken("human", uniq("observer"), { owner: `${uniq("observer")}@example.com` });
    expect((await api(`/api/channels/${slug}/collaboration`, observer.token)).status).toBe(200);
    expect((await start(slug, observer.token, connection.id)).status).toBe(403);
    expect((await api(`/api/channels/${slug}/attachments?filename=outside.txt`, observer.token,
      { method: "POST", headers: { "content-type": "text/plain" }, body: "outside" })).status).toBe(403);
  });

  it("retains uncertain writes, rejects duplicate work and never exposes provider error bodies", async () => {
    const { owner, slug } = await group(); const connection = await connect(slug, owner.token);
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs", method: "POST" })
      .reply(503, `secret provider debug ${CREDENTIAL}`);
    const response = await start(slug, owner.token, connection.id);
    const text = await response.text();
    expect(text).not.toContain(CREDENTIAL); expect(text).not.toContain("secret provider debug");
    const { run } = JSON.parse(text) as { run: CloudAgentRun };
    expect(run.state).toBe("unknown");
    expect((await start(slug, owner.token, connection.id)).status).toBe(409);
    const sync = await api(`/api/channels/${slug}/cloud-agents/${connection.id}/runs/${run.id}/sync`, owner.token, { method: "POST" });
    expect(await sync.json()).toMatchObject({ run: { state: "unknown" } });
  });

  it("lets a human member start work and recovers a completed answer after group posting was denied", async () => {
    const { owner, slug } = await group(); const connection = await connect(slug, owner.token);
    const memberAccount = `${uniq("member")}@example.com`;
    const member = await seedToken("human", uniq("member"), { owner: memberAccount });
    await env.DB.prepare("INSERT INTO channel_members(channel_slug,account,added_by,added_at) VALUES(?,?,?,?)")
      .bind(slug, memberAccount, owner.name, Date.now()).run();
    // Revoke the agent's current write permission, while keeping its connection valid.
    await env.DB.prepare("UPDATE tokens SET role='readonly' WHERE name=?").bind(connection.agent_name).run();
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs", method: "POST" }).reply(200, (request) => ({
      run_id: "run-completed", session_id: JSON.parse(request.body).session_id, status: "completed", output: "Durable saved answer",
    }));
    const created = await start(slug, member.token, connection.id);
    expect(created.status).toBe(201);
    const { run } = await created.json() as { run: CloudAgentRun };
    expect(run).toMatchObject({ state: "completed", result: "Durable saved answer", reply_message_seq: null });
    expect(run.error).toContain("answer is saved");
    await env.DB.prepare("UPDATE tokens SET role='agent' WHERE name=?").bind(connection.agent_name).run();
    const synced = await api(`/api/channels/${slug}/cloud-agents/${connection.id}/runs/${run.id}/sync`, member.token, { method: "POST" });
    expect(await synced.json()).toMatchObject({ run: { state: "completed", result: "Durable saved answer", reply_message_seq: expect.any(Number), error: null } });
    // No additional provider fixture is registered: recovery must not rerun paid work.
  });

  it("treats cancellation as pending until the provider confirms the correlated run stopped", async () => {
    const { owner, slug } = await group(); const connection = await connect(slug, owner.token);
    let session = "";
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs", method: "POST" }).reply(200, (request) => {
      session = JSON.parse(request.body).session_id;
      return { run_id: "run-cancel", session_id: session, status: "running" };
    });
    const { run } = await (await start(slug, owner.token, connection.id)).json() as { run: CloudAgentRun };
    capabilities();
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs/run-cancel/stop", method: "POST" }).reply(200, { status: "stopping" });
    const path = `/api/channels/${slug}/cloud-agents/${connection.id}/runs/${run.id}`;
    expect(await (await api(`${path}/cancel`, owner.token, { method: "POST" })).json()).toMatchObject({ run: { state: "running" } });
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs/run-cancel", method: "GET" })
      .reply(200, { run_id: "run-cancel", session_id: session, status: "cancelled" });
    expect(await (await api(`${path}/sync`, owner.token, { method: "POST" })).json()).toMatchObject({ run: { state: "cancelled" } });
  });

  it("delivers to Manus without importing private replies and prevents cross-group conversation reuse", async () => {
    const { owner, slug } = await group(); const id = uniq("manus");
    const task = uniq("personal-task"); const agent = uniq("personal-agent");
    const detail = () => fetchMock.get("https://api.manus.ai").intercept({ path: `/v2/agent.detail?agent_id=${agent}`, method: "GET" })
      .reply(200, { ok: true, agent: { id: agent, task_id: task, nickname: "Private assistant" } });
    const body = { provider: "manus", name: "Cue", remote_agent_id: agent, credential: CREDENTIAL, allow_personal_context: true };
    const connectionPath = `/api/channels/${slug}/cloud-agents/${id}`;
    expect((await api(connectionPath, owner.token, { method: "PUT", body: JSON.stringify({ ...body, allow_personal_context: false }) })).status).toBe(400);
    detail();
    expect((await api(connectionPath, owner.token, { method: "PUT", body: JSON.stringify(body) })).status).toBe(201);
    detail();
    fetchMock.get("https://api.manus.ai").intercept({ path: `/v2/task.listMessages?task_id=${task}&order=desc&limit=1&verbose=false`, method: "GET" })
      .reply(200, { ok: true, task_id: task, messages: [{ id: "private-event", content: "PERSONAL PRIVATE HISTORY DO NOT SHARE" }] });
    fetchMock.get("https://api.manus.ai").intercept({ path: "/v2/task.sendMessage", method: "POST" })
      .reply(200, { ok: true, task_id: task, request_id: "manus-request" });
    const response = await start(slug, owner.token, id);
    const text = await response.text();
    expect(text).not.toContain("PERSONAL PRIVATE HISTORY");
    const { run } = JSON.parse(text) as { run: CloudAgentRun };
    expect(run).toMatchObject({ state: "submitted", result: null, reply_message_seq: null });
    expect(await (await api(`${connectionPath}/runs/${run.id}/sync`, owner.token, { method: "POST" })).json()).toMatchObject({ run: { state: "submitted", result: null } });
    const other = await createChannel(owner.token);
    detail();
    expect((await api(`/api/channels/${other}/cloud-agents/${uniq("other")}`, owner.token, { method: "PUT", body: JSON.stringify(body) })).status).toBe(409);
    await api(connectionPath, owner.token, { method: "DELETE" });
    detail();
    expect((await api(`/api/channels/${other}/cloud-agents/${uniq("other")}`, owner.token, { method: "PUT", body: JSON.stringify(body) })).status).toBe(409);
    const stored = await env.DB.prepare("SELECT * FROM cloud_agent_runs WHERE id=?").bind(run.id).first();
    expect(JSON.stringify(stored)).not.toContain("PERSONAL PRIVATE HISTORY");
  });

  it("lists all group files with real pagination and reuses authenticated message attachments", async () => {
    const { owner, slug } = await group();
    const other = await createChannel(owner.token);
    const upload = async (channel: string, filename: string, content: string) => {
      const response = await api(`/api/channels/${channel}/attachments?filename=${encodeURIComponent(filename)}`, owner.token,
        { method: "POST", headers: { "content-type": "text/plain" }, body: content });
      expect(response.status).toBe(201); return response.json();
    };
    await upload(slug, "a.txt", "file one"); await upload(slug, "b.txt", "file two"); await upload(other, "private.txt", "other group");
    const first = await (await api(`/api/channels/${slug}/files?limit=1`, owner.token)).json() as { files: ChannelFile[]; cursor: string };
    expect(first.files).toHaveLength(1); expect(first.cursor).toBeTruthy();
    const second = await (await api(`/api/channels/${slug}/files?limit=1&cursor=${encodeURIComponent(first.cursor)}`, owner.token)).json() as { files: ChannelFile[]; cursor: string | null };
    expect(second.files).toHaveLength(1); expect(second.cursor).toBeNull();
    expect([...first.files, ...second.files].map((file) => file.filename).sort()).toEqual(["a.txt", "b.txt"]);
    const file = first.files[0]!;
    const message = await api(`/api/channels/${slug}/messages`, owner.token, { method: "POST",
      body: JSON.stringify({ kind: "message", body: "Shared file", mentions: [], reply_to: null, attachments: [file] }) });
    expect(message.status).toBe(200);
    const scoped = await seedToken("agent", uniq("files-agent"), { owner: "files-owner@example.com", channelScope: slug });
    expect((await api(`/api/channels/${other}/files`, scoped.token)).status).toBe(403);
    expect((await api(file.url, scoped.token)).status).toBe(200);
  });

  it("binds real GitHub metadata, reads PRs with encrypted credentials and rejects forged repository URLs", async () => {
    const { owner, slug } = await group();
    expect((await api(`/api/channels/${slug}/repositories`, owner.token, { method: "POST", body: JSON.stringify({ full_name: "https://attacker.test/private" }) })).status).toBe(400);
    fetchMock.get("https://api.github.com").intercept({ path: "/repos/acme/project", method: "GET" })
      .reply(200, { full_name: "acme/project", default_branch: "main", private: true });
    fetchMock.get("https://api.github.com").intercept({ path: "/repos/acme/project/branches/main", method: "GET" }).reply(200, { name: "main" });
    const bound = await api(`/api/channels/${slug}/repositories`, owner.token, { method: "POST", body: JSON.stringify({ full_name: "acme/project", credential: CREDENTIAL }) });
    expect(bound.status).toBe(201);
    const text = await bound.text(); expect(text).not.toContain(CREDENTIAL);
    const { repository } = JSON.parse(text) as { repository: ChannelRepository };
    fetchMock.get("https://api.github.com").intercept({ path: "/repos/acme/project/pulls?state=open&sort=updated&direction=desc&per_page=30", method: "GET" })
      .reply(200, (request) => {
        expect(request.headers.authorization).toBe(`Bearer ${CREDENTIAL}`);
        return [{ number: 12, title: "Agent patch", state: "open", draft: true, user: { login: "worker-agent" }, head: { ref: "agents/review/task" }, base: { ref: "main" }, updated_at: "2026-10-21T08:00:00Z" }];
      });
    const pulls = await api(`/api/channels/${slug}/repositories/${repository.id}/pulls`, owner.token);
    expect(await pulls.json()).toMatchObject({ pulls: [{ number: 12, html_url: "https://github.com/acme/project/pull/12", draft: true }] });
    const row = await env.DB.prepare("SELECT credential_ciphertext FROM channel_repositories WHERE id=?").bind(repository.id).first<{ credential_ciphertext: string }>();
    expect(row!.credential_ciphertext).toMatch(/^v1\./); expect(row!.credential_ciphertext).not.toContain(CREDENTIAL);
    expect((await api(`/api/channels/${slug}/visibility`, owner.token,
      { method: "PUT", body: JSON.stringify({ visibility: "public", confirm: true }) })).status).toBe(409);
    // Defense in depth for legacy/imported data whose visibility bypassed this API.
    await env.DB.prepare("UPDATE channels SET visibility='public' WHERE slug=?").bind(slug).run();
    const observer = await seedToken("human", uniq("observer"), { owner: `${uniq("observer")}@example.com` });
    expect(await (await api(`/api/channels/${slug}/repositories`, observer.token)).json()).toEqual({ repositories: [] });
    expect(await (await api(`/api/channels/${slug}/collaboration`, observer.token)).json()).toMatchObject({ repositories: [] });
    expect((await api(`/api/channels/${slug}/repositories/${repository.id}/pulls`, observer.token)).status).toBe(403);
  });

  it("refuses to bind a private GitHub repository in a public group", async () => {
    const { owner, slug } = await group();
    expect((await api(`/api/channels/${slug}/visibility`, owner.token,
      { method: "PUT", body: JSON.stringify({ visibility: "public_watch", confirm: true }) })).status).toBe(200);
    fetchMock.get("https://api.github.com").intercept({ path: "/repos/acme/private", method: "GET" })
      .reply(200, { full_name: "acme/private", default_branch: "main", private: true });
    fetchMock.get("https://api.github.com").intercept({ path: "/repos/acme/private/branches/main", method: "GET" }).reply(200, { name: "main" });
    const response = await api(`/api/channels/${slug}/repositories`, owner.token,
      { method: "POST", body: JSON.stringify({ full_name: "acme/private", credential: CREDENTIAL }) });
    expect(response.status).toBe(403);
    expect(await env.DB.prepare("SELECT id FROM channel_repositories WHERE channel_slug=?").bind(slug).first()).toBeNull();
  });

  it("uses anonymous GitHub reads in public groups, including when a previously public repository becomes private", async () => {
    const { owner, slug } = await group();
    expect((await api(`/api/channels/${slug}/visibility`, owner.token,
      { method: "PUT", body: JSON.stringify({ visibility: "public", confirm: true }) })).status).toBe(200);
    fetchMock.get("https://api.github.com").intercept({ path: "/repos/acme/public", method: "GET" })
      .reply(200, { full_name: "acme/public", default_branch: "main", private: false });
    fetchMock.get("https://api.github.com").intercept({ path: "/repos/acme/public/branches/main", method: "GET" }).reply(200, { name: "main" });
    const response = await api(`/api/channels/${slug}/repositories`, owner.token,
      { method: "POST", body: JSON.stringify({ full_name: "acme/public", credential: CREDENTIAL }) });
    expect(response.status).toBe(201);
    const { repository } = await response.json() as { repository: ChannelRepository };
    expect(repository.credential_configured).toBe(false);
    const row = await env.DB.prepare("SELECT credential_ciphertext FROM channel_repositories WHERE id=?").bind(repository.id).first<{ credential_ciphertext: string | null }>();
    expect(row!.credential_ciphertext).toBeNull();
    // Simulate a legacy binding which did retain credentials, before this policy.
    const encrypted = await sealCredential(CREDENTIAL, KEY, `github:${slug}:${repository.id}`);
    await env.DB.prepare("UPDATE channel_repositories SET credential_ciphertext=? WHERE id=?").bind(encrypted, repository.id).run();
    fetchMock.get("https://api.github.com").intercept({ path: "/repos/acme/public/pulls?state=open&sort=updated&direction=desc&per_page=30", method: "GET" })
      .reply(404, (request) => { expect(request.headers.authorization).toBeUndefined(); return { message: "Now private" }; });
    expect((await api(`/api/channels/${slug}/repositories/${repository.id}/pulls`, owner.token)).status).toBe(404);
  });
});


function startForRace(slug: string, token: string, id: string, requestId = uniq("request")) {
  return handlerApi(`/api/channels/${slug}/cloud-agents/${id}/runs`, token, { method: "POST",
    body: JSON.stringify({ prompt: "Please review the group task", request_id: requestId }) });
}

async function runningForRace() {
  const context = await group();
  const connection = await connect(context.slug, context.owner.token);
  let session = "";
  fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs", method: "POST" }).reply(200, (request) => {
    session = JSON.parse(request.body).session_id;
    return { run_id: "race-run", session_id: session, status: "running" };
  });
  const response = await startForRace(context.slug, context.owner.token, connection.id);
  expect(response.status).toBe(201);
  const { run } = await response.json() as { run: CloudAgentRun };
  return { ...context, connection, session, run,
    sync: () => handlerApi(`/api/channels/${context.slug}/cloud-agents/${connection.id}/runs/${run.id}/sync`, context.owner.token, { method: "POST" }) };
}

describe("cloud run lease fencing", () => {
  it.each(["running", "completed"])("ignores a superseded %s response after a newer terminal result", async (oldStatus) => {
    const context = await runningForRace();
    const gate = requestGate();
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs/race-run", method: "GET" })
      .reply(200, async () => {
        await gate.wait();
        return { run_id: "race-run", session_id: context.session, status: oldStatus, output: "STALE answer must not be imported" };
      });
    const stale = Promise.resolve(context.sync());
    try {
      await gate.arrived;
      await env.DB.prepare("UPDATE cloud_agent_runs SET lease_until = 0 WHERE id = ?").bind(context.run.id).run();
      fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs/race-run", method: "GET" })
        .reply(200, { run_id: "race-run", session_id: context.session, status: "completed", output: "Current terminal answer" });
      const latest = await (await context.sync()).json() as { run: CloudAgentRun };
      expect(latest.run).toMatchObject({ state: "completed", result: "Current terminal answer", reply_message_seq: expect.any(Number) });
      gate.release();
      expect(await (await stale).json()).toMatchObject({ run: latest.run });
      const messages = await (await handlerApi(`/api/channels/${context.slug}/messages`, context.owner.token)).text();
      expect(messages).toContain("Current terminal answer");
      expect(messages).not.toContain("STALE answer");
      expect(await env.DB.prepare("SELECT state,lease_token,lease_until FROM cloud_agent_runs WHERE id = ?").bind(context.run.id).first())
        .toMatchObject({ state: "completed", lease_token: null, lease_until: 0 });
    } finally { gate.release(); await stale; }
  });

  it("does not let an older error clear a successor's active lease or error field", async () => {
    const context = await runningForRace();
    const firstGate = requestGate(); const nextGate = requestGate();
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs/race-run", method: "GET" })
      .reply(503, async () => { await firstGate.wait(); return { private_debug: CREDENTIAL }; });
    const stale = Promise.resolve(context.sync());
    let next: Promise<Response> | undefined;
    try {
      await firstGate.arrived;
      await env.DB.prepare("UPDATE cloud_agent_runs SET lease_until = 0 WHERE id = ?").bind(context.run.id).run();
      fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs/race-run", method: "GET" })
        .reply(200, async () => { await nextGate.wait(); return { run_id: "race-run", session_id: context.session, status: "running" }; });
      next = Promise.resolve(context.sync()); await nextGate.arrived;
      const lease = await env.DB.prepare("SELECT lease_token,lease_until,error FROM cloud_agent_runs WHERE id = ?").bind(context.run.id).first();
      expect(lease).toMatchObject({ lease_token: expect.any(String), error: null });
      firstGate.release(); await (await stale).text();
      expect(await env.DB.prepare("SELECT lease_token,lease_until,error FROM cloud_agent_runs WHERE id = ?").bind(context.run.id).first()).toEqual(lease);
      // With the successor still suspended, no third provider request is allowed.
      expect(await (await context.sync()).json()).toMatchObject({ reused: true, run: { state: "running", error: null } });
    } finally { firstGate.release(); nextGate.release(); await stale; await next; }
  });

  it("does not restore a late start receipt after recovery supersedes its lease", async () => {
    const { owner, slug } = await group(); const connection = await connect(slug, owner.token);
    const gate = requestGate(); const requestId = uniq("late-start");
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs", method: "POST" })
      .reply(200, async (request) => {
        await gate.wait();
        return { run_id: "late-start", session_id: JSON.parse(request.body).session_id, status: "completed", output: "Unowned start result" };
      });
    const stale = Promise.resolve(startForRace(slug, owner.token, connection.id, requestId));
    try {
      await gate.arrived;
      const row = await env.DB.prepare("SELECT id FROM cloud_agent_runs WHERE channel_slug = ? AND request_id = ?").bind(slug, requestId).first<{ id: string }>();
      await env.DB.prepare("UPDATE cloud_agent_runs SET lease_until = 0 WHERE id = ?").bind(row!.id).run();
      const recovered = await handlerApi(`/api/channels/${slug}/cloud-agents/${connection.id}/runs/${row!.id}/sync`, owner.token, { method: "POST" });
      expect(await recovered.json()).toMatchObject({ run: { state: "unknown", result: null } });
      gate.release();
      expect(await (await stale).json()).toMatchObject({ run: { state: "unknown", result: null, reply_message_seq: null } });
      expect((await startForRace(slug, owner.token, connection.id)).status).toBe(409);
      expect(await (await handlerApi(`/api/channels/${slug}/messages`, owner.token)).text()).not.toContain("Unowned start result");
    } finally { gate.release(); await stale; }
  });

  it.each([200, 503])("revocation fences a pending provider response (%s) and erases encrypted secrets", async (status) => {
    const { owner, slug } = await group(); const connection = await connect(slug, owner.token);
    const gate = requestGate();
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs", method: "POST" })
      .reply(status, async (request) => {
        await gate.wait();
        return { run_id: "revoked-run", session_id: JSON.parse(request.body).session_id, status: "completed", output: "Private revoked result" };
      });
    const pending = Promise.resolve(startForRace(slug, owner.token, connection.id));
    try {
      await gate.arrived;
      const revoked = await handlerApi(`/api/channels/${slug}/cloud-agents/${connection.id}`, owner.token, { method: "DELETE" });
      expect(await revoked.json()).toMatchObject({ revoked: true, remote_work_cancelled: false });
      gate.release();
      const { run } = await (await pending).json() as { run: CloudAgentRun };
      expect(run).toMatchObject({ state: "unknown", result: null, reply_message_seq: null });
      expect(run.error).toContain("Connection revoked");
      expect(await env.DB.prepare("SELECT credential_ciphertext,agent_token_ciphertext FROM cloud_agent_connections WHERE channel_slug = ? AND id = ?")
        .bind(slug, connection.id).first()).toEqual({ credential_ciphertext: "", agent_token_ciphertext: "" });
      expect(await env.DB.prepare("SELECT lease_token,lease_until FROM cloud_agent_runs WHERE id = ?").bind(run.id).first())
        .toEqual({ lease_token: null, lease_until: 0 });
      expect(await (await handlerApi(`/api/channels/${slug}/messages`, owner.token)).text()).not.toContain("Private revoked result");
    } finally { gate.release(); await pending; }
  });
});


describe("cloud run storage interleavings", () => {
  it("uses terminal state saved between the initial read and lock acquisition", async () => {
    const context = await runningForRace();
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs/race-run", method: "GET" })
      .reply(200, { run_id: "race-run", session_id: context.session, status: "completed", output: "Saved between read and lock" });
    let winner: { run: CloudAgentRun } | undefined;
    const db = statementHook(env.DB, "SELECT * FROM cloud_agent_runs WHERE channel_slug = ? AND connection_id = ? AND id = ?", "first", async () => {
      winner = await (await context.sync()).json() as { run: CloudAgentRun };
    });
    const response = await handlerApi(`/api/channels/${context.slug}/cloud-agents/${context.connection.id}/runs/${context.run.id}/sync`,
      context.owner.token, { method: "POST" }, db);
    expect(winner?.run.state).toBe("completed");
    expect(await response.json()).toMatchObject(winner!);
    expect(await env.DB.prepare("SELECT state,error,lease_token FROM cloud_agent_runs WHERE id = ?").bind(context.run.id).first())
      .toEqual({ state: "completed", error: null, lease_token: null });
  });

  it("keeps a completed answer if saving its message receipt fails, then recovers without new paid work", async () => {
    const { owner, slug } = await group(); const connection = await connect(slug, owner.token);
    fetchMock.get("https://hermes.test").intercept({ path: "/v1/runs", method: "POST" }).reply(200, (request) => ({
      run_id: "saved-answer", session_id: JSON.parse(request.body).session_id, status: "completed", output: "Answer survives a receipt storage failure",
    }));
    const db = statementHook(env.DB, "UPDATE cloud_agent_runs SET reply_message_seq", "run", async () => {
      throw new Error("Synthetic one-time receipt storage failure");
    }, "before");
    const response = await handlerApi(`/api/channels/${slug}/cloud-agents/${connection.id}/runs`, owner.token,
      { method: "POST", body: JSON.stringify({ prompt: "Save the result", request_id: uniq("receipt-fault") }) }, db);
    const { run } = await response.json() as { run: CloudAgentRun };
    expect(run).toMatchObject({ state: "completed", result: "Answer survives a receipt storage failure", reply_message_seq: null });
    // No extra provider response is registered: a retry must only deliver the saved answer.
    const recovered = await handlerApi(`/api/channels/${slug}/cloud-agents/${connection.id}/runs/${run.id}/sync`, owner.token, { method: "POST" });
    expect(await recovered.json()).toMatchObject({ run: { state: "completed", reply_message_seq: expect.any(Number), error: null } });
    const messages = await (await api(`/api/channels/${slug}/messages`, owner.token)).json() as { messages: Array<{ body: string }> };
    expect(messages.messages.filter((message) => message.body?.includes("Answer survives a receipt storage failure"))).toHaveLength(1);
  });
});
