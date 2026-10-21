/**
 * Real local HTTP contract tests; no supplier account or cloud service is called.
 * node --experimental-transform-types --test worker/test/provider-transport.contract.mjs
 * Kept outside the workerd test naming pattern because workerd cannot listen on a TCP port.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { cancel, discover, normalizeProviderEndpoint, poll, ProviderError, start, verify } from "../src/collaboration/transport.ts";

const HERMES = { provider: "hermes", endpoint: "https://hermes.example", credential: "hermes-secret-that-must-not-leak" };
const MANUS = { provider: "manus", endpoint: "https://api.manus.ai/v2", credential: "manus-secret-that-must-not-leak", remoteAgentId: "agent-1", remoteConversationId: "task-1" };
const CAPABILITIES = {
  object: "hermes.api_server.capabilities", platform: "hermes-agent", model: "hermes-agent",
  auth: { type: "bearer", required: true },
  features: { run_submission: true, run_status: true, run_stop: true },
};
let routes = [];
let requests = [];
let root;
let server;

before(async () => {
  server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8");
    requests.push({ method: request.method, path: request.url, headers: request.headers, body: text ? JSON.parse(text) : undefined });
    const route = routes.shift();
    if (!route) { response.writeHead(500, { "Content-Type": "application/json" }); response.end("{}"); return; }
    if (route.delay) await new Promise((resolve) => setTimeout(resolve, route.delay));
    if (response.destroyed) return;
    response.writeHead(route.status ?? 200, { "Content-Type": route.contentType ?? "application/json", ...route.headers });
    response.end(route.raw ?? JSON.stringify(route.body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  root = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
beforeEach(() => { routes = []; requests = []; });

// Only this test transport remaps already validated public HTTPS origins to the fake server.
// Production never accepts localhost and cannot configure this option from a request.
const options = {
  allowedOrigins: ["https://hermes.example"], timeoutMs: 1_000,
  fetch: async (input, init) => {
    assert.equal(init.redirect, "manual");
    assert.ok(init.signal);
    const target = new URL(input);
    assert.ok(["https://hermes.example", "https://api.manus.ai"].includes(target.origin));
    return fetch(root + target.pathname + target.search, init);
  },
};
function serve(...values) { routes.push(...values.map((body) => ({ body }))); }
function safeError(code, unknown) {
  return (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.code, code);
    if (unknown !== undefined) assert.equal(error.outcomeUnknown, unknown);
    assert.ok(!String(error).includes("must-not-leak"));
    assert.equal(error.cause, undefined);
    return true;
  };
}

test("Hermes verifies native authenticated capabilities and discovers the configured profile", async () => {
  serve(CAPABILITIES, CAPABILITIES);
  assert.deepEqual(await verify({ ...HERMES, endpoint: HERMES.endpoint + "/v1" }, options), {
    endpoint: HERMES.endpoint, remoteAgentId: "hermes-agent", supportsCancel: true, deliveryMode: "correlated",
  });
  assert.deepEqual(await discover(HERMES, options), [{ id: "hermes-agent", name: "hermes-agent" }]);
  assert.equal(requests[0].path, "/v1/capabilities");
  assert.equal(requests[0].headers.authorization, `Bearer ${HERMES.credential}`);
});

test("Hermes starts one idempotent, room-scoped run and returns only its final output", async () => {
  serve({ run_id: "run-1", status: "started" },
    { object: "hermes.run", run_id: "run-1", status: "running", session_id: "room-1", output: "NOT FINAL" },
    { object: "hermes.run", run_id: "run-1", status: "completed", session_id: "room-1", output: `Result ${HERMES.credential}` });
  const run = await start(HERMES, { prompt: "Review branch", requestId: "request-1", sessionId: "room-1" }, options);
  assert.equal(run.state, "running");
  assert.equal(run.sessionId, "room-1");
  assert.deepEqual(requests[0].body, { input: "Review branch", session_id: "room-1" });
  assert.equal(requests[0].headers["idempotency-key"], "request-1");
  assert.equal(requests[0].headers["x-hermes-session-key"], "room-1");
  assert.equal((await poll(HERMES, run, options)).text, undefined);
  const completed = await poll(HERMES, run, options);
  assert.equal(completed.state, "completed");
  assert.equal(completed.text, "Result [REDACTED]");
  assert.equal(requests.filter((r) => r.method === "POST").length, 1);
});

test("Hermes session roots preserve the selected profile", async () => {
  serve(CAPABILITIES);
  await verify({ ...HERMES, endpoint: HERMES.endpoint + "/p/team/v1/" }, options);
  assert.equal(requests[0].path, "/p/team/v1/capabilities");
});

test("Hermes cancellation stays running until the provider confirms cancellation", async () => {
  serve(CAPABILITIES, { status: "stopping" }, { run_id: "run-1", session_id: "room-1", status: "cancelled" });
  const reference = { remoteRunId: "run-1", sessionId: "room-1" };
  const stopping = await cancel(HERMES, reference, options);
  assert.equal(stopping.state, "running");
  assert.match(stopping.note, /Cancellation was requested/);
  assert.equal(requests[1].path, "/v1/runs/run-1/stop");
  assert.equal((await poll(HERMES, reference, options)).state, "cancelled");
});

test("unknown, interrupted and approval states cannot masquerade as successful output", async () => {
  for (const [status, state] of [["unknown", "unknown"], ["interrupted", "failed"], ["waiting_for_approval", "needs_input"]]) {
    serve({ run_id: "run-1", session_id: "room-1", status, output: "PRIVATE DIAGNOSTIC", error: HERMES.credential });
    const result = await poll(HERMES, { remoteRunId: "run-1", sessionId: "room-1" }, options);
    assert.equal(result.state, state);
    assert.equal(result.text, undefined);
    assert.ok(!JSON.stringify(result).includes("PRIVATE"));
    assert.ok(!JSON.stringify(result).includes(HERMES.credential));
  }
});

test("Hermes rejects swapped run/session identities and malformed success payloads", async () => {
  for (const body of [
    { run_id: "wrong-run", session_id: "room-1", status: "completed", output: "PRIVATE" },
    { run_id: "run-1", session_id: "wrong-room", status: "completed", output: "PRIVATE" },
    { run_id: "run-1", session_id: "room-1", status: "completed", output: { text: "unrecognized" } },
    { run_id: "run-1", status: "invented-state", output: "unrecognized" },
    { run_id: "../private", status: "completed", output: "unrecognized" },
  ]) {
    serve(body);
    await assert.rejects(poll(HERMES, { remoteRunId: "run-1", sessionId: "room-1" }, options), safeError("invalid_response", false));
  }
});

test("Manus discovers Cue agents and verifies the persistent task with API-key authentication", async () => {
  serve({ ok: true, data: [{ id: "agent-1", nickname: "My Cue", task_id: "task-1", about: "Not needed" }] },
    { ok: true, agent: { id: "agent-1", task_id: "task-1", nickname: "My Cue" } });
  assert.deepEqual(await discover(MANUS, options), [{ id: "agent-1", name: "My Cue", remoteConversationId: "task-1" }]);
  assert.deepEqual(await verify(MANUS, options), {
    endpoint: "https://api.manus.ai", remoteAgentId: "agent-1", remoteConversationId: "task-1", supportsCancel: false, deliveryMode: "delivery_only",
  });
  assert.equal(requests[0].headers["x-manus-api-key"], MANUS.credential);
  assert.equal(requests[0].headers.authorization, undefined);
});

test("Manus delivers once without exposing old or interleaved personal replies", async () => {
  serve({ ok: true, agent: { id: "agent-1", task_id: "task-1" } },
    { ok: true, task_id: "task-1", messages: [{ id: "event-private", type: "assistant_message", assistant_message: { content: "PRIVATE FAMILY HISTORY" } }] },
    { ok: true, task_id: "task-1", request_id: "receipt-1" });
  const run = await start(MANUS, { prompt: "Please review this group's proposal", requestId: "request-1" }, options);
  assert.equal(run.state, "submitted");
  assert.equal(run.deliveryMode, "delivery_only");
  assert.equal(run.cursor, "event-private");
  assert.equal(run.text, undefined);
  assert.ok(!JSON.stringify(run).includes("FAMILY"));
  assert.deepEqual(requests[2].body, { task_id: "task-1", message: { content: "Please review this group's proposal" } });
  // Even new assistant events cannot safely be attributed to the submitted request.
  serve({ ok: true, task_id: "task-1", messages: [{ id: "event-new-private", type: "assistant_message", assistant_message: { content: "PRIVATE CONCURRENT CHAT" } }] });
  const result = await poll(MANUS, run, options);
  assert.equal(result.state, "submitted");
  assert.equal(result.text, undefined);
  assert.equal(requests.length, 3, "poll must not fetch or mirror the private main task");
  await assert.rejects(cancel(MANUS, run, options), safeError("unsupported", false));
  assert.equal(requests.length, 3, "cancel must not stop unrelated personal work");
});

test("Manus does not send if its task changed or the baseline could not be established", async () => {
  serve({ ok: true, agent: { id: "agent-1", task_id: "task-new" } });
  await assert.rejects(start(MANUS, { prompt: "work", requestId: "request-1" }, options), safeError("conflict", false));
  serve({ ok: true, agent: { id: "agent-1", task_id: "task-1" } }, { ok: true, task_id: "task-1", messages: "unexpected" });
  await assert.rejects(start(MANUS, { prompt: "work", requestId: "request-1" }, options), safeError("invalid_response", false));
  assert.equal(requests.filter((r) => r.method === "POST").length, 0);
});

test("Manus malformed write receipts are unknown outcomes and never auto-retried", async () => {
  serve({ ok: true, agent: { id: "agent-1", task_id: "task-1" } }, { ok: true, task_id: "task-1", messages: [] },
    { ok: true, task_id: "task-1", unexpected: MANUS.credential });
  await assert.rejects(start(MANUS, { prompt: "work", requestId: "request-1" }, options), safeError("invalid_response", true));
  assert.equal(requests.filter((r) => r.method === "POST").length, 1);
});

test("endpoint policy blocks secret exfiltration before making an HTTP request", async () => {
  for (const endpoint of [
    "http://hermes.example", "https://127.0.0.1", "https://2130706433", "https://0x7f000001",
    "https://[::1]", "https://metadata.google.internal", "https://service.local", "https://localhost",
    "https://unapproved.example", "https://user:password@hermes.example", "https://hermes.example?token=secret",
    "https://hermes.example#fragment", "https://hermes.example/private", "https://hermes.example/%2e%2e/",
  ]) {
    await assert.rejects(verify({ ...HERMES, endpoint }, options), (error) => error instanceof ProviderError);
  }
  await assert.rejects(verify(HERMES), safeError("endpoint_not_allowed", false));
  await assert.rejects(verify({ ...MANUS, endpoint: "https://hermes.example" }, options), safeError("endpoint_not_allowed", false));
  assert.equal(requests.length, 0);
});

test("redirects are not followed with bearer credentials", async () => {
  routes.push({ status: 302, headers: { Location: root + "/credential-capture" }, body: {} });
  await assert.rejects(verify(HERMES, options), safeError("transport_failed", false));
  assert.equal(requests.length, 1);
});

test("non-JSON, oversized, schema-invalid and error responses are bounded and redacted", async () => {
  for (const route of [
    { contentType: "text/html", raw: HERMES.credential },
    { contentType: "application/json", raw: "{broken" },
    { body: { ...CAPABILITIES, features: "broken" } },
    { body: { object: "list", data: [{ id: "a-model" }] } },
    { raw: JSON.stringify({ content: "x".repeat(1_048_576) }) },
  ]) {
    routes.push(route);
    await assert.rejects(verify(HERMES, options), safeError("invalid_response", false));
  }
  routes.push({ status: 403, body: { error: `secret=${HERMES.credential}` } });
  await assert.rejects(verify(HERMES, options), safeError("authentication_failed", false));
  routes.push({ status: 503, body: { error: `secret=${HERMES.credential}` } });
  await assert.rejects(start(HERMES, { prompt: "work", requestId: "request-1", sessionId: "room-1" }, options), safeError("provider_unavailable", true));
});

test("write timeout signals unknown execution and does not retry or leak the underlying error", async () => {
  routes.push({ delay: 100, body: { run_id: "run-1", status: "started" } });
  await assert.rejects(start(HERMES, { prompt: "work", requestId: "request-1", sessionId: "room-1" }, { ...options, timeoutMs: 30 }), safeError("timeout", true));
  assert.equal(requests.length, 1);
  await assert.rejects(start(HERMES, { prompt: "work", requestId: "request-1", sessionId: "room-1" }, {
    ...options, fetch: async () => { throw new Error(HERMES.credential); },
  }), safeError("transport_failed", true));
});

test("credentials, IDs and session boundaries are checked before sending", async () => {
  await assert.rejects(verify({ ...HERMES, credential: "secret\r\nInjected: bad" }, options), safeError("invalid_configuration", false));
  await assert.rejects(start(HERMES, { prompt: "work", requestId: "request-1" }, options), safeError("invalid_configuration", false));
  await assert.rejects(start(HERMES, { prompt: "work", requestId: "bad\r\nid", sessionId: "room-1" }, options), safeError("invalid_configuration", false));
  await assert.rejects(poll(MANUS, { remoteRunId: "receipt-1", sessionId: "foreign-task" }, options), safeError("invalid_configuration", false));
  assert.equal(normalizeProviderEndpoint(MANUS), "https://api.manus.ai");
  assert.equal(requests.length, 0);
});
