import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CodeProposalDetail, CodeProposalInput } from "@agentparty/shared/code-proposals";
import type { ChannelRepository } from "@agentparty/shared/collaboration";
import { fetchMock } from "./fetch-mock";
import { requestGate } from "./request-gate";
import { handlerApi, statementHook } from "./handler-api";
import { concurrentApi } from "./concurrent-api";
import { api, createChannel, seedToken, uniq } from "./helpers";

const READ_KEY = "synthetic-github-read-credential";
const WRITE_KEY = "synthetic-github-one-publication-credential";
const REPOSITORY = "acme/proposal-fixture";
const BASE = "a".repeat(40);
const BASE_TREE = "b".repeat(40);
const NEXT_TREE = "c".repeat(40);
const NEXT_COMMIT = "d".repeat(40);
const MOVED_BASE = "e".repeat(40);
const BEFORE = "export const answer = 1;\n";
const AFTER = "export const answer = 2;\n";
const FILE = "example.ts";
const ROOT = `/repos/${REPOSITORY}`;

beforeEach(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => { try { fetchMock.assertNoPendingInterceptors(); } finally { fetchMock.deactivate(); } });

async function blobSha(content: string) {
  const encoder = new TextEncoder(); const data = encoder.encode(content);
  const header = encoder.encode(`blob ${data.byteLength}\0`);
  const bytes = new Uint8Array(header.byteLength + data.byteLength);
  bytes.set(header); bytes.set(data, header.byteLength);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** HTTP fixtures model Git objects; only network boundaries are replaced. */
async function fixture(options: { missingBlob?: boolean } = {}) {
  const oldBlob = await blobSha(BEFORE); const newBlob = await blobSha(AFTER);
  const github = fetchMock.get("https://api.github.com");
  const state = { main: BASE, writes: [] as string[], message: "", branchExists: false, pull: null as Record<string, unknown> | null, beforeBaseRead: null as (() => Promise<void>) | null };
  const ref = (branch: string, sha: string) => ({ ref: `refs/heads/${branch}`, object: { type: "commit", sha } });
  const oldCommit = (sha: string) => ({ sha, tree: { sha: BASE_TREE }, message: "Reviewed base", parents: [] });
  github.intercept({ path: `${ROOT}/git/ref/heads/main`, method: "GET" }).reply(200, () => ref("main", state.main)).persist();
  for (const sha of [BASE, MOVED_BASE]) github.intercept({ path: `${ROOT}/git/commits/${sha}`, method: "GET" }).reply(200, async () => { await state.beforeBaseRead?.(); return oldCommit(sha); }).persist();
  github.intercept({ path: `${ROOT}/git/trees/${BASE_TREE}`, method: "GET" }).reply(200, {
    sha: BASE_TREE, truncated: false, tree: [{ path: FILE, type: "blob", mode: "100644", sha: oldBlob }],
  }).persist();
  github.intercept({ path: `${ROOT}/git/blobs/${oldBlob}`, method: "GET" }).reply(options.missingBlob ? 404 : 200, {
    sha: oldBlob, encoding: "base64", size: new TextEncoder().encode(BEFORE).byteLength, content: btoa(BEFORE),
  }).persist();
  function publishing(proposal: CodeProposalDetail, uncertainRef = false, beforePullResponse?: () => Promise<void>) {
    const branch = `agentparty/${proposal.id}`;
    const branchPath = `${ROOT}/git/ref/heads/${branch}`;
    github.intercept({ path: branchPath, method: "GET" }).reply(404, { message: "Not Found" });
    github.intercept({ path: branchPath, method: "GET" }).reply(200, () => {
      expect(state.branchExists).toBe(true); return ref(branch, NEXT_COMMIT);
    }).persist();
    github.intercept({ path: `${ROOT}/git/trees`, method: "POST" }).reply(201, (request) => {
      expect(request.headers.authorization).toBe(`Bearer ${WRITE_KEY}`);
      expect(JSON.parse(request.body)).toEqual({ base_tree: BASE_TREE, tree: [{ path: FILE, mode: "100644", type: "blob", content: AFTER }] });
      state.writes.push("tree"); return { sha: NEXT_TREE };
    });
    github.intercept({ path: `${ROOT}/git/trees/${NEXT_TREE}`, method: "GET" }).reply(200, {
      sha: NEXT_TREE, truncated: false, tree: [{ path: FILE, type: "blob", mode: "100644", sha: newBlob }],
    }).persist();
    github.intercept({ path: `${ROOT}/git/commits`, method: "POST" }).reply(201, (request) => {
      const body = JSON.parse(request.body); state.message = body.message;
      expect(body.parents).toEqual([BASE]); expect(body.tree).toBe(NEXT_TREE);
      state.writes.push("commit"); return { sha: NEXT_COMMIT, tree: { sha: NEXT_TREE }, message: state.message, parents: [{ sha: BASE }] };
    });
    github.intercept({ path: `${ROOT}/git/commits/${NEXT_COMMIT}`, method: "GET" }).reply(200, () => ({
      sha: NEXT_COMMIT, tree: { sha: NEXT_TREE }, message: state.message, parents: [{ sha: BASE }],
    })).persist();
    github.intercept({ path: `${ROOT}/git/refs`, method: "POST" }).reply(uncertainRef ? 503 : 201, (request) => {
      expect(JSON.parse(request.body)).toEqual({ ref: `refs/heads/${branch}`, sha: NEXT_COMMIT });
      state.writes.push("new-branch"); state.branchExists = true;
      // Simulate GitHub creating the ref before a response fails; recovery must inspect it.
      return uncertainRef ? { secret_debug: WRITE_KEY } : ref(branch, NEXT_COMMIT);
    });
    github.intercept({ path: `${ROOT}/pulls?state=all&head=${encodeURIComponent(`acme:${branch}`)}&per_page=100`, method: "GET" })
      .reply(200, () => state.pull ? [state.pull] : []).persist();
    github.intercept({ path: `${ROOT}/pulls`, method: "POST" }).reply(201, async (request) => {
      const body = JSON.parse(request.body);
      expect(body).toMatchObject({ head: branch, base: "main", draft: true, maintainer_can_modify: false });
      expect(body.body).toContain(`agentparty-proposal:${proposal.id}`);
      state.writes.push("draft-pr");
      state.pull = { number: 42, state: "open", draft: true, body: body.body,
        head: { ref: branch, sha: NEXT_COMMIT, repo: { full_name: REPOSITORY } },
        base: { ref: "main", repo: { full_name: REPOSITORY } } };
      await beforePullResponse?.();
      return state.pull;
    });
  }
  return { state, publishing };
}

async function setup(options: { missingBlob?: boolean } = {}) {
  const account = `${uniq("proposal-owner")}@example.com`;
  const owner = await seedToken("human", uniq("owner"), { owner: account });
  const slug = await createChannel(owner.token);
  const agent = await seedToken("agent", uniq("author-agent"), { owner: account, channelScope: slug });
  const github = fetchMock.get("https://api.github.com");
  github.intercept({ path: ROOT, method: "GET" }).reply(200, { full_name: REPOSITORY, private: true, default_branch: "main" });
  github.intercept({ path: `${ROOT}/branches/main`, method: "GET" }).reply(200, { name: "main" });
  const response = await api(`/api/channels/${slug}/repositories`, owner.token, {
    method: "POST", body: JSON.stringify({ full_name: REPOSITORY, credential: READ_KEY }),
  });
  expect(response.status).toBe(201);
  const { repository } = await response.json() as { repository: ChannelRepository };
  const base = `/api/channels/${slug}/repositories/${repository.id}`;
  const githubFixture = await fixture(options);
  return { owner, agent, account, slug, repository, base, ...githubFixture };
}
type Setup = Awaited<ReturnType<typeof setup>>;
function input(requestId = uniq("proposal")): CodeProposalInput {
  return { request_id: requestId, title: "Update the shared answer", description: "One reviewed text change.", base_sha: BASE, files: [{ path: FILE, content: AFTER }] };
}
async function propose(context: Setup, body = input()) {
  const response = await api(`${context.base}/proposals`, context.agent.token, { method: "POST", body: JSON.stringify(body) });
  expect(response.status).toBe(201);
  return (await response.json() as { proposal: CodeProposalDetail }).proposal;
}
function publish(context: Setup, proposal: CodeProposalDetail, token = context.owner.token, digest = proposal.digest) {
  return api(`${context.base}/proposals/${proposal.id}/publish`, token, {
    method: "POST", body: JSON.stringify({ expected_digest: digest, credential: WRITE_KEY }),
  });
}

function concurrentPublish(context: Setup, proposal: CodeProposalDetail) {
  return concurrentApi(`${context.base}/proposals/${proposal.id}/publish`, context.owner.token, {
    method: "POST", body: JSON.stringify({ expected_digest: proposal.digest, credential: WRITE_KEY }),
  });
}

/** Explicit barriers make takeover tests deterministic; no wall-clock sleeps. */
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe("reviewed GitHub code proposals", () => {
  it("does not let a stale failed publisher release or overwrite its successor's lease", async () => {
    const context = await setup(); const proposal = await propose(context);
    fetchMock.deactivate(); fetchMock.activate(); fetchMock.disableNetConnect();
    const entered = barrier(); const resume = barrier(); const successorEntered = barrier(); const successorResume = barrier();
    fetchMock.get("https://api.github.com").intercept({ path: `${ROOT}/git/commits/${BASE}`, method: "GET" }).reply(403, async () => {
      entered.release(); await resume.promise; return { secret_debug: WRITE_KEY };
    });
    const recovery = await fixture();
    recovery.publishing(proposal, false, async () => { successorEntered.release(); await successorResume.promise; });
    const first = concurrentPublish(context, proposal); let second: Promise<Response> | undefined;
    try {
      await entered.promise;
      await env.DB.prepare("UPDATE code_change_proposals SET lease_until=0 WHERE id=?").bind(proposal.id).run();
      second = concurrentPublish(context, proposal); await successorEntered.promise;
      const ownership = await env.DB.prepare("SELECT lease_token,lease_until,approved_at FROM code_change_proposals WHERE id=?").bind(proposal.id).first();
      resume.release();
      const oldText = await (await first).text(); expect(oldText).not.toContain(WRITE_KEY);
      expect(JSON.parse(oldText)).toMatchObject({ proposal: { state: "publishing", error: null } });
      expect(await env.DB.prepare("SELECT lease_token,lease_until,approved_at FROM code_change_proposals WHERE id=?").bind(proposal.id).first()).toEqual(ownership);
      successorResume.release();
      expect(await (await second).json()).toMatchObject({ proposal: { state: "published", pull_request_number: 42 } });
      expect(recovery.state.writes).toEqual(["tree", "commit", "new-branch", "draft-pr"]);
    } finally {
      resume.release(); successorResume.release();
      await Promise.all([first, ...(second ? [second] : [])]);
    }
  });

  it("preserves the newer publication when an earlier successful PR response arrives late", async () => {
    const context = await setup(); const proposal = await propose(context);
    const entered = barrier(); const resume = barrier();
    context.publishing(proposal, false, async () => { entered.release(); await resume.promise; });
    const first = concurrentPublish(context, proposal);
    try {
      await entered.promise;
      await env.DB.prepare("UPDATE code_change_proposals SET lease_until=0 WHERE id=?").bind(proposal.id).run();
      const recovered = await concurrentPublish(context, proposal);
      expect(await recovered.json()).toMatchObject({ proposal: { state: "published", pull_request_number: 42 } });
      const saved = await env.DB.prepare("SELECT * FROM code_change_proposals WHERE id=?").bind(proposal.id).first();
      resume.release();
      expect(await (await first).json()).toMatchObject({ proposal: { state: "published", pull_request_number: 42 } });
      expect(await env.DB.prepare("SELECT * FROM code_change_proposals WHERE id=?").bind(proposal.id).first()).toEqual(saved);
      expect(context.state.writes).toEqual(["tree", "commit", "new-branch", "draft-pr"]);
      const messages = await (await concurrentApi(`/api/channels/${context.slug}/messages`, context.owner.token)).json() as { messages: Array<{ body: string }> };
      expect(messages.messages.filter((m) => m.body?.includes("Code proposal published for review:"))).toHaveLength(1);
    } finally { resume.release(); await first; }
  });

  it("reads exact snapshots through group ACL and saves originals with an immutable idempotent proposal", async () => {
    const context = await setup(); const body = input();
    expect(await (await api(`${context.base}/snapshot`, context.agent.token)).json()).toEqual({ commit_sha: BASE, tree_sha: BASE_TREE });
    expect(await (await api(`${context.base}/files?ref=${BASE}`, context.agent.token)).json()).toMatchObject({ commit_sha: BASE, path: "", truncated: false,
      entries: [{ name: FILE, path: FILE, type: "file", mode: "100644" }] });
    expect(await (await api(`${context.base}/file?ref=${BASE}&path=${FILE}`, context.agent.token)).json()).toMatchObject({ path: FILE, content: BEFORE, commit_sha: BASE, encoding: "utf-8" });
    expect((await api(`${context.base}/file?ref=main&path=${FILE}`, context.agent.token)).status).toBe(400);
    const proposal = await propose(context, body);
    expect(proposal).toMatchObject({ state: "proposed", base_sha: BASE, files: body.files, originals: [{ path: FILE, content: BEFORE }], approved_by: null });
    expect(proposal.digest).toMatch(/^[a-f0-9]{64}$/);
    const duplicate = await api(`${context.base}/proposals`, context.agent.token, { method: "POST", body: JSON.stringify(body) });
    expect(await duplicate.json()).toMatchObject({ reused: true, proposal: { id: proposal.id } });
    expect((await api(`${context.base}/proposals`, context.agent.token,
      { method: "POST", body: JSON.stringify({ ...body, files: [{ path: FILE, content: "different" }] }) })).status).toBe(409);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM code_change_proposals WHERE repository_id=?").bind(context.repository.id).first<{ n: number }>())!.n).toBe(1);
    const messages = await (await api(`/api/channels/${context.slug}/messages`, context.owner.token)).json() as { messages: Array<{ body: string; sender: { name: string; kind: string } }> };
    expect(messages.messages.filter((message) => message.body?.includes(proposal.id))).toHaveLength(1);
    expect(messages.messages.find((message) => message.body?.includes(proposal.id))!.sender).toMatchObject({ name: context.agent.name, kind: "agent" });
    expect(context.state.writes).toEqual([]);
  });

  it("allows agents to propose but reserves approval and rejection for the human owner", async () => {
    const context = await setup(); const proposal = await propose(context);
    const reader = await seedToken("readonly", uniq("reader"), { owner: context.account, channelScope: context.slug });
    expect((await api(`${context.base}/proposals`, reader.token, { method: "POST", body: JSON.stringify(input()) })).status).toBe(403);
    const memberAccount = `${uniq("review-member")}@example.com`;
    const member = await seedToken("human", uniq("member"), { owner: memberAccount });
    await env.DB.prepare("INSERT INTO channel_members(channel_slug,account,added_by,added_at) VALUES(?,?,?,?)")
      .bind(context.slug, memberAccount, context.owner.name, Date.now()).run();
    expect((await publish(context, proposal, context.agent.token)).status).toBe(403);
    expect((await publish(context, proposal, member.token)).status).toBe(403);
    expect((await api(`${context.base}/proposals/${proposal.id}/reject`, context.agent.token,
      { method: "POST", body: JSON.stringify({ expected_digest: proposal.digest }) })).status).toBe(403);
    expect((await publish(context, proposal, context.owner.token, "0".repeat(64))).status).toBe(409);
    const rejected = await api(`${context.base}/proposals/${proposal.id}/reject`, context.owner.token,
      { method: "POST", body: JSON.stringify({ expected_digest: proposal.digest }) });
    expect(await rejected.json()).toMatchObject({ proposal: { state: "rejected" } });
    expect((await publish(context, proposal)).status).toBe(409);
    expect(context.state.writes).toEqual([]);
  });

  it("publishes one reviewed dedicated branch and draft PR without storing the approval credential", async () => {
    const context = await setup(); const proposal = await propose(context);
    context.publishing(proposal);
    const response = await publish(context, proposal); expect(response.status).toBe(200);
    const responseText = await response.text(); expect(responseText).not.toContain(WRITE_KEY); expect(responseText).not.toContain(READ_KEY);
    expect(JSON.parse(responseText)).toMatchObject({ proposal: { state: "published", approved_by: context.owner.name,
      branch: `agentparty/${proposal.id}`, commit_sha: NEXT_COMMIT, pull_request_url: `https://github.com/${REPOSITORY}/pull/42` } });
    const saved = await env.DB.prepare("SELECT * FROM code_change_proposals WHERE id=?").bind(proposal.id).first();
    expect(JSON.stringify(saved)).not.toContain(WRITE_KEY); expect(JSON.stringify(saved)).not.toContain(READ_KEY);
    expect(saved).toMatchObject({ state: "published", lease_until: 0, digest: proposal.digest });
    const messages = await (await api(`/api/channels/${context.slug}/messages`, context.owner.token)).text();
    expect(messages).toContain(`/pull/42`); expect(messages).not.toContain(WRITE_KEY);
    expect(await (await publish(context, proposal)).json()).toMatchObject({ reused: true, proposal: { state: "published" } });
    expect(context.state.writes).toEqual(["tree", "commit", "new-branch", "draft-pr"]);
    expect(context.state.main).toBe(BASE);
  });

  it("retains an uncertain publication and recovers the same branch without another commit or PR", async () => {
    const context = await setup(); const proposal = await propose(context);
    context.publishing(proposal, true);
    const first = await publish(context, proposal); const firstText = await first.text();
    expect(firstText).not.toContain(WRITE_KEY);
    expect(JSON.parse(firstText)).toMatchObject({ proposal: { state: "unknown", approved_by: context.owner.name } });
    expect(context.state.branchExists).toBe(true);
    expect((await api(`${context.base}/proposals/${proposal.id}/reject`, context.owner.token,
      { method: "POST", body: JSON.stringify({ expected_digest: proposal.digest }) })).status).toBe(409);
    expect((await api(context.base, context.owner.token, { method: "DELETE" })).status).toBe(409);
    expect(await env.DB.prepare("SELECT id FROM code_change_proposals WHERE id=?").bind(proposal.id).first()).not.toBeNull();
    expect(await (await publish(context, proposal)).json()).toMatchObject({ proposal: { id: proposal.id, state: "published" } });
    expect(context.state.writes).toEqual(["tree", "commit", "new-branch", "draft-pr"]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM code_change_proposals WHERE repository_id=?").bind(context.repository.id).first<{ n: number }>())!.n).toBe(1);
  });

  it("holds the repository binding while a publication lease is active", async () => {
    const context = await setup(); const proposal = await propose(context);
    await env.DB.prepare("UPDATE code_change_proposals SET state='publishing',lease_until=? WHERE id=?").bind(Date.now() + 90_000, proposal.id).run();
    expect((await api(context.base, context.owner.token, { method: "DELETE" })).status).toBe(409);
    expect((await publish(context, proposal)).status).toBe(409);
    expect((await api(`${context.base}/proposals/${proposal.id}/reject`, context.owner.token,
      { method: "POST", body: JSON.stringify({ expected_digest: proposal.digest }) })).status).toBe(409);
    expect(await env.DB.prepare("SELECT id FROM channel_repositories WHERE id=?").bind(context.repository.id).first()).not.toBeNull();
    await env.DB.prepare("UPDATE code_change_proposals SET lease_until=0 WHERE id=?").bind(proposal.id).run();
    expect((await api(context.base, context.owner.token, { method: "DELETE" })).status).toBe(409);
    expect(context.state.writes).toEqual([]);
  });

  it("does not clear an uncertain remote outcome when a recovery read is denied", async () => {
    const context = await setup(); const proposal = await propose(context);
    await env.DB.prepare("UPDATE code_change_proposals SET state='unknown',lease_until=0 WHERE id=?").bind(proposal.id).run();
    // Rotate away all earlier read fixtures; the recovery request is denied before
    // any new write, but an earlier publication may still exist remotely.
    fetchMock.deactivate(); fetchMock.activate(); fetchMock.disableNetConnect();
    fetchMock.get("https://api.github.com").intercept({ path: `${ROOT}/git/commits/${BASE}`, method: "GET" }).reply(403, { message: "Expired approval credential" });
    expect(await (await publish(context, proposal)).json()).toMatchObject({ proposal: { state: "unknown" } });
    expect((await api(`${context.base}/proposals/${proposal.id}/reject`, context.owner.token,
      { method: "POST", body: JSON.stringify({ expected_digest: proposal.digest }) })).status).toBe(409);
    expect((await env.DB.prepare("SELECT state FROM code_change_proposals WHERE id=?").bind(proposal.id).first())!.state).toBe("unknown");
  });

  it("never exposes private source or proposal diffs after group visibility changes or across token scope", async () => {
    const context = await setup(); const proposal = await propose(context);
    await env.DB.prepare("UPDATE channels SET visibility='public' WHERE slug=?").bind(context.slug).run();
    const observer = await seedToken("human", uniq("outside"), { owner: `${uniq("outside")}@example.com` });
    const crossGroup = await seedToken("agent", uniq("cross-group"), { owner: context.account, channelScope: uniq("different-group") });
    for (const token of [observer.token, crossGroup.token]) {
      for (const suffix of ["/snapshot", `/files?ref=${BASE}`, `/file?ref=${BASE}&path=${FILE}`, "/proposals", `/proposals/${proposal.id}`]) {
        expect((await api(context.base + suffix, token)).status).toBe(403);
      }
    }
    expect(context.state.writes).toEqual([]);
  });

  it("rejects stale or unchanged proposals and rejects a changed base before any publication write", async () => {
    const context = await setup();
    const noChange = { ...input(), files: [{ path: FILE, content: BEFORE }] };
    expect((await api(`${context.base}/proposals`, context.agent.token, { method: "POST", body: JSON.stringify(noChange) })).status).toBe(400);
    const proposal = await propose(context);
    context.state.main = MOVED_BASE;
    expect((await api(`${context.base}/proposals`, context.agent.token, { method: "POST", body: JSON.stringify(input()) })).status).toBe(409);
    fetchMock.get("https://api.github.com").intercept({ path: `${ROOT}/git/ref/heads/agentparty/${proposal.id}`, method: "GET" }).reply(404, { message: "Not Found" });
    fetchMock.get("https://api.github.com").intercept({ path: `${ROOT}/pulls?state=all&head=${encodeURIComponent(`acme:agentparty/${proposal.id}`)}&per_page=100`, method: "GET" }).reply(200, []);
    expect(await (await publish(context, proposal)).json()).toMatchObject({ proposal: { state: "failed" } });
    expect(context.state.writes).toEqual([]);
  });

  it("never treats an inaccessible original blob as proof that a proposed file is new", async () => {
    const context = await setup({ missingBlob: true });
    const response = await api(`${context.base}/proposals`, context.agent.token, { method: "POST", body: JSON.stringify(input()) });
    expect(response.status).toBe(404);
    expect(await env.DB.prepare("SELECT id FROM code_change_proposals WHERE repository_id=?").bind(context.repository.id).first()).toBeNull();
    expect(context.state.writes).toEqual([]);
  });
});


function publishForRace(context: Setup, proposal: CodeProposalDetail) {
  return handlerApi(`${context.base}/proposals/${proposal.id}/publish`, context.owner.token, {
    method: "POST", body: JSON.stringify({ expected_digest: proposal.digest, credential: WRITE_KEY }),
  });
}

describe("proposal publication lease fencing", () => {
  it("does not downgrade a recovered publication when an older request fails", async () => {
    const context = await setup(); const proposal = await propose(context);
    // Suspend the old publisher before any GitHub write.
    fetchMock.deactivate(); fetchMock.activate(); fetchMock.disableNetConnect();
    const gate = requestGate();
    fetchMock.get("https://api.github.com").intercept({ path: `${ROOT}/git/commits/${BASE}`, method: "GET" })
      .reply(403, async () => { await gate.wait(); return { message: "Old credential rejected" }; });
    const stale = Promise.resolve(publishForRace(context, proposal));
    try {
      await gate.arrived;
      await env.DB.prepare("UPDATE code_change_proposals SET lease_until = 0 WHERE id = ?").bind(proposal.id).run();
      const recovery = await fixture(); recovery.publishing(proposal);
      const current = await (await publishForRace(context, proposal)).json() as { proposal: CodeProposalDetail };
      expect(current.proposal).toMatchObject({ state: "published", pull_request_number: 42 });
      gate.release();
      expect(await (await stale).json()).toMatchObject({ proposal: current.proposal });
      expect(await env.DB.prepare("SELECT state,lease_token,lease_until FROM code_change_proposals WHERE id = ?").bind(proposal.id).first())
        .toEqual({ state: "published", lease_token: null, lease_until: 0 });
      const messages = await (await handlerApi(`/api/channels/${context.slug}/messages`, context.owner.token)).json() as { messages: Array<{ body: string }> };
      expect(messages.messages.filter((message) => message.body?.includes("Code proposal published for review:"))).toHaveLength(1);
      expect(recovery.state.writes).toEqual(["tree", "commit", "new-branch", "draft-pr"]);
    } finally { gate.release(); await stale; }
  });

  it("does not release or overwrite an active successor after a stale publisher fails", async () => {
    const context = await setup(); const proposal = await propose(context);
    fetchMock.deactivate(); fetchMock.activate(); fetchMock.disableNetConnect();
    const firstGate = requestGate(); const nextGate = requestGate();
    const github = fetchMock.get("https://api.github.com");
    github.intercept({ path: `${ROOT}/git/commits/${BASE}`, method: "GET" })
      .reply(403, async () => { await firstGate.wait(); return { message: "Old credential denied" }; });
    github.intercept({ path: `${ROOT}/git/commits/${BASE}`, method: "GET" })
      .reply(403, async () => { await nextGate.wait(); return { message: "Recovery denied" }; });
    const stale = Promise.resolve(publishForRace(context, proposal)); let next: Promise<Response> | undefined;
    try {
      await firstGate.arrived;
      await env.DB.prepare("UPDATE code_change_proposals SET lease_until = 0 WHERE id = ?").bind(proposal.id).run();
      next = Promise.resolve(publishForRace(context, proposal)); await nextGate.arrived;
      const lease = await env.DB.prepare("SELECT state,lease_token,lease_until,error FROM code_change_proposals WHERE id = ?").bind(proposal.id).first();
      expect(lease).toMatchObject({ state: "publishing", lease_token: expect.any(String), error: null });
      firstGate.release(); await (await stale).text();
      expect(await env.DB.prepare("SELECT state,lease_token,lease_until,error FROM code_change_proposals WHERE id = ?").bind(proposal.id).first()).toEqual(lease);
      expect((await publishForRace(context, proposal)).status).toBe(409);
      expect((await handlerApi(context.base, context.owner.token, { method: "DELETE" })).status).toBe(409);
      nextGate.release();
      expect(await (await next).json()).toMatchObject({ proposal: { state: "unknown" } });
    } finally { firstGate.release(); nextGate.release(); await stale; await next; }
  });
});


describe("proposal pre-lock state validation", () => {
  it("rejects an approval based on a stale proposed state after another request becomes uncertain", async () => {
    const context = await setup(); const proposal = await propose(context);
    context.publishing(proposal, true);
    const db = statementHook(env.DB, "SELECT * FROM code_change_proposals WHERE channel_slug = ? AND repository_id = ? AND id = ?", "first", async () => {
      expect(await (await publishForRace(context, proposal)).json()).toMatchObject({ proposal: { state: "unknown" } });
      // A subsequent read denial must not turn that uncertain write into 'failed'.
      fetchMock.deactivate(); fetchMock.activate(); fetchMock.disableNetConnect();
      fetchMock.get("https://api.github.com").intercept({ path: `${ROOT}/git/commits/${BASE}`, method: "GET" })
        .reply(403, { message: "Recovery credential denied" }).persist();
    });
    const response = await handlerApi(`${context.base}/proposals/${proposal.id}/publish`, context.owner.token, {
      method: "POST", body: JSON.stringify({ expected_digest: proposal.digest, credential: WRITE_KEY }),
    }, db);
    expect(response.status).toBe(409);
    expect(await env.DB.prepare("SELECT state,lease_token,lease_until FROM code_change_proposals WHERE id = ?").bind(proposal.id).first())
      .toEqual({ state: "unknown", lease_token: null, lease_until: 0 });
    expect((await api(context.base, context.owner.token, { method: "DELETE" })).status).toBe(409);
    expect(context.state.writes).toEqual(["tree", "commit", "new-branch"]);
  });
});


describe("publication fencing regressions", () => {
  it("preserves a newer publisher's live lease when an older credential request fails", async () => {
    const context = await setup(); const proposal = await propose(context);
    fetchMock.deactivate(); fetchMock.activate(); fetchMock.disableNetConnect();
    const token = crypto.randomUUID(); const until = Date.now() + 90_000;
    fetchMock.get("https://api.github.com").intercept({ path: `${ROOT}/git/commits/${BASE}`, method: "GET" }).reply(403, async () => {
      await env.DB.prepare("UPDATE code_change_proposals SET lease_token=?,lease_until=?,error='successor note' WHERE id=?")
        .bind(token, until, proposal.id).run();
      return { private_debug: WRITE_KEY };
    });
    const text = await (await publish(context, proposal)).text();
    expect(text).not.toContain(token); expect(text).not.toContain(WRITE_KEY);
    expect(JSON.parse(text)).toMatchObject({ proposal: { state: "publishing", error: "successor note" } });
    expect(await env.DB.prepare("SELECT lease_token,lease_until,error FROM code_change_proposals WHERE id=?").bind(proposal.id).first())
      .toEqual({ lease_token: token, lease_until: until, error: "successor note" });
    expect((await publish(context, proposal)).status).toBe(409);
    expect((await api(context.base, context.owner.token, { method: "DELETE" })).status).toBe(409);
  });

  it("does not announce or overwrite a successful publication recovered by a newer request", async () => {
    const context = await setup(); const proposal = await propose(context);
    let saved: Record<string, unknown> | null = null; let recoveredStatus = 0;
    context.publishing(proposal, false, async () => {
      // GitHub created the PR before the old publisher received its receipt.
      // A second request recovers that same PR, then the old response resumes.
      await env.DB.prepare("UPDATE code_change_proposals SET lease_until=0 WHERE id=?").bind(proposal.id).run();
      const recovered = await publish(context, proposal); recoveredStatus = recovered.status; await recovered.text();
      saved = await env.DB.prepare("SELECT * FROM code_change_proposals WHERE id=?").bind(proposal.id).first();
    });
    const result = await (await publish(context, proposal)).json();
    expect(recoveredStatus).toBe(200);
    expect(result).toMatchObject({ proposal: { state: "published", pull_request_number: 42 } });
    expect(await env.DB.prepare("SELECT * FROM code_change_proposals WHERE id=?").bind(proposal.id).first()).toEqual(saved);
    expect(context.state.writes).toEqual(["tree", "commit", "new-branch", "draft-pr"]);
    const messages = await (await api(`/api/channels/${context.slug}/messages`, context.owner.token)).json() as { messages: Array<{ body: string }> };
    expect(messages.messages.filter((m) => m.body?.includes("Code proposal published for review:"))).toHaveLength(1);
  });

  it("checks current publication ownership before the first external write", async () => {
    const context = await setup(); const proposal = await propose(context);
    const trigger = uniq("publish_takeover").replaceAll("-", "_"); const successor = crypto.randomUUID();
    // Emulate takeover immediately after the old request acquires its lease.
    await env.DB.prepare(`CREATE TRIGGER ${trigger} AFTER UPDATE OF lease_token ON code_change_proposals
      WHEN NEW.id='${proposal.id}' AND NEW.lease_token IS NOT NULL AND OLD.lease_token IS NULL
      BEGIN UPDATE code_change_proposals SET lease_token='${successor}' WHERE id=NEW.id; END`).run();
    const github = fetchMock.get("https://api.github.com");
    github.intercept({ path: `${ROOT}/git/ref/heads/agentparty/${proposal.id}`, method: "GET" }).reply(404, { message: "Not Found" });
    github.intercept({ path: `${ROOT}/pulls?state=all&head=${encodeURIComponent(`acme:agentparty/${proposal.id}`)}&per_page=100`, method: "GET" }).reply(200, []);
    try {
      expect(await (await publish(context, proposal)).json()).toMatchObject({ proposal: { state: "publishing", error: null } });
      expect(await env.DB.prepare("SELECT lease_token,state FROM code_change_proposals WHERE id=?").bind(proposal.id).first())
        .toEqual({ lease_token: successor, state: "publishing" });
      expect(context.state.writes).toEqual([]);
    } finally { await env.DB.prepare(`DROP TRIGGER ${trigger}`).run(); }
  });
});


describe("publication authority before external writes", () => {
  it.each(["taken-over", "expired"])("does not send a GitHub write after its lease is %s", async (mode) => {
    const context = await setup(); const proposal = await propose(context);
    const successor = crypto.randomUUID(); const until = Date.now() + 90_000;
    // A real D1 takeover/expiry during preflight. The callback immediately
    // before the first remote POST must detect it before any GitHub mutation.
    context.state.beforeBaseRead = async () => {
      context.state.beforeBaseRead = null;
      if (mode === "taken-over") {
        await env.DB.prepare("UPDATE code_change_proposals SET lease_token=?,lease_until=?,error='Successor owns publication' WHERE id=?")
          .bind(successor, until, proposal.id).run();
      } else await env.DB.prepare("UPDATE code_change_proposals SET lease_until=0 WHERE id=?").bind(proposal.id).run();
    };
    const github = fetchMock.get("https://api.github.com");
    github.intercept({ path: `${ROOT}/git/ref/heads/agentparty/${proposal.id}`, method: "GET" }).reply(404, { message: "Not Found" });
    github.intercept({ path: `${ROOT}/pulls?state=all&head=${encodeURIComponent(`acme:agentparty/${proposal.id}`)}&per_page=100`, method: "GET" }).reply(200, []);
    try {
      const response = await publish(context, proposal);
      const result = await response.json() as { proposal: CodeProposalDetail };
      expect(result.proposal.state).toBe(mode === "taken-over" ? "publishing" : "unknown");
      if (mode === "taken-over") {
        expect(result.proposal.error).toBe("Successor owns publication");
        expect(await env.DB.prepare("SELECT lease_token,lease_until FROM code_change_proposals WHERE id=?").bind(proposal.id).first())
          .toEqual({ lease_token: successor, lease_until: until });
      } else expect(result.proposal.error).toContain("Publication authority");
      expect(context.state.writes).toEqual([]);
      expect(context.state.main).toBe(BASE);
      expect(await (await api(`/api/channels/${context.slug}/messages`, context.owner.token)).text()).not.toContain("Code proposal published for review");
    } finally { context.state.beforeBaseRead = null; }
  });
});
