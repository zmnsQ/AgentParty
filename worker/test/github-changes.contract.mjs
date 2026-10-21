/** Real loopback HTTP, official Git Data shapes, synthetic credentials only. Node 24. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { after, before, beforeEach, test } from "node:test";
import {
  GitHubChangesError, getRepositorySnapshot, listRepositoryFiles, publishChanges, readRepositoryFile, validateChangeFiles,
} from "../src/collaboration/github-changes.ts";

const REPO = "test-owner/test-repo";
const ROOT = `/repos/${REPO}`;
const TOKEN = "synthetic-github-token-never-log";
const hash = (value) => createHash("sha1").update(value).digest("hex");
const objectHash = (kind, value) => {
  const body = Buffer.from(value);
  return hash(Buffer.concat([Buffer.from(`${kind} ${body.length}\0`), body]));
};
let server, localOrigin, state, requests, options;

function buildTree(files) {
  const root = new Map();
  for (const [path, file] of files) {
    let directory = root;
    const parts = path.split("/");
    for (const part of parts.slice(0, -1)) {
      if (!directory.has(part)) directory.set(part, new Map());
      directory = directory.get(part);
    }
    directory.set(parts.at(-1), file);
  }
  const writeDirectory = (directory) => {
    const entries = [];
    for (const [path, value] of directory) {
      if (value instanceof Map) entries.push({ path, mode: "040000", type: "tree", sha: writeDirectory(value) });
      else {
        const content = Buffer.from(value.content);
        const sha = value.sha ?? objectHash("blob", content);
        const type = value.mode === "160000" ? "commit" : "blob";
        if (type === "blob") state.blobs.set(sha, { sha, size: content.length, encoding: "base64", content: content.toString("base64") });
        entries.push({ path, mode: value.mode ?? "100644", type, sha });
      }
    }
    entries.sort((a, b) => Buffer.compare(Buffer.from(a.path + (a.type === "tree" ? "/" : "")), Buffer.from(b.path + (b.type === "tree" ? "/" : ""))));
    const binary = Buffer.concat(entries.flatMap((entry) => [Buffer.from(`${entry.mode === "040000" ? "40000" : entry.mode} ${entry.path}\0`), Buffer.from(entry.sha, "hex")]));
    const sha = objectHash("tree", binary);
    state.trees.set(sha, { sha, tree: entries, truncated: false });
    return sha;
  };
  const tree = writeDirectory(root);
  state.filesByTree.set(tree, new Map(files));
  return tree;
}
function reset() {
  requests = [];
  state = { trees: new Map(), blobs: new Map(), filesByTree: new Map(), commits: new Map(), refs: new Map(), pulls: [], hook: null, fault: null };
  const tree = buildTree(new Map([
    ["README.md", { content: "Original readme\n" }],
    ["src/main.ts", { content: "export const answer = 1;\n" }],
    ["src/old.txt", { content: "Remove me\n" }],
    ["bin/run.sh", { content: "#!/bin/sh\necho before\n", mode: "100755" }],
    ["link", { content: "src/main.ts", mode: "120000" }],
    ["vendor", { content: "", mode: "160000", sha: hash("submodule") }],
  ]));
  const baseSha = hash("base-commit");
  state.baseSha = baseSha;
  state.baseTree = tree;
  state.commits.set(baseSha, { sha: baseSha, tree: { sha: tree }, parents: [], message: "Initial snapshot" });
  state.refs.set("main", baseSha);
}
function proposal(overrides = {}) {
  return { fullName: REPO, baseBranch: "main", baseSha: state.baseSha, proposalId: "proposal-001",
    title: "Improve group collaboration", description: "Reviewed immutable change proposal.", credential: TOKEN,
    files: [
      { path: "src/main.ts", content: "export const answer = 42;\n" },
      { path: "src/old.txt", content: null },
      { path: "docs/guide.md", content: "Hello 世界\n" },
      { path: "bin/run.sh", content: "#!/bin/sh\necho after\n" },
    ], ...overrides };
}
function reference(branch, sha) { return { ref: `refs/heads/${branch}`, object: { type: "commit", sha } }; }
function json(response, body, status = 200, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}
async function route(request, response) {
  let raw = "";
  for await (const part of request) raw += part;
  const url = new URL(request.url, localOrigin);
  const entry = { method: request.method, path: url.pathname, search: url.search, headers: request.headers, body: raw ? JSON.parse(raw) : undefined };
  requests.push(entry);
  if (state.hook && await state.hook(entry, response)) return;
  const path = decodeURIComponent(url.pathname.slice(ROOT.length));
  let result; let status = 200;
  if (!url.pathname.startsWith(ROOT + "/")) return json(response, { secret: TOKEN }, 404);
  if (request.method === "GET" && path.startsWith("/git/ref/heads/")) {
    const branch = path.slice("/git/ref/heads/".length);
    result = state.refs.has(branch) ? reference(branch, state.refs.get(branch)) : undefined;
  } else if (request.method === "GET" && path.startsWith("/git/commits/")) {
    result = state.commits.get(path.slice("/git/commits/".length));
  } else if (request.method === "GET" && path.startsWith("/git/trees/")) {
    assert.equal(url.search, "", "trees must be complete, non-recursive directory listings");
    result = state.trees.get(path.slice("/git/trees/".length));
  } else if (request.method === "GET" && path.startsWith("/git/blobs/")) {
    result = state.blobs.get(path.slice("/git/blobs/".length));
  } else if (request.method === "GET" && path === "/pulls") {
    assert.equal(url.searchParams.get("state"), "all");
    const head = url.searchParams.get("head");
    result = state.pulls.filter((pull) => `${REPO.split("/")[0]}:${pull.head.ref}` === head);
  } else if (request.method === "POST" && path === "/git/trees") {
    const files = new Map(state.filesByTree.get(entry.body.base_tree));
    assert.ok(files.size, "base_tree must retain unrelated files");
    for (const change of entry.body.tree) {
      assert.equal(change.type, "blob");
      if (change.sha === null) files.delete(change.path);
      else files.set(change.path, { content: change.content, mode: change.mode });
    }
    const sha = buildTree(files);
    result = state.trees.get(sha); status = 201;
  } else if (request.method === "POST" && path === "/git/commits") {
    const sha = hash(`commit-${state.commits.size}-${entry.body.message}-${entry.body.tree}`);
    result = { sha, message: entry.body.message, tree: { sha: entry.body.tree }, parents: entry.body.parents.map((sha) => ({ sha })) };
    state.commits.set(sha, result); status = 201;
  } else if (request.method === "POST" && path === "/git/refs") {
    const branch = entry.body.ref.slice("refs/heads/".length);
    assert.ok(branch.startsWith("agentparty/"));
    if (state.refs.has(branch)) return json(response, { message: TOKEN }, 422);
    state.refs.set(branch, entry.body.sha);
    result = reference(branch, entry.body.sha); status = 201;
  } else if (request.method === "POST" && path === "/pulls") {
    assert.equal(entry.body.draft, true);
    assert.equal(entry.body.maintainer_can_modify, false);
    result = { number: state.pulls.length + 1, title: entry.body.title, body: entry.body.body, state: "open", draft: true,
      head: { ref: entry.body.head, sha: state.refs.get(entry.body.head), repo: { full_name: REPO } },
      base: { ref: entry.body.base, sha: state.refs.get(entry.body.base), repo: { full_name: REPO } } };
    state.pulls.push(result); status = 201;
  } else return json(response, { message: "Unexpected route" }, 500);
  if (state.fault?.path === path && request.method === "POST") {
    const fault = state.fault; state.fault = null;
    if (fault.delay) await new Promise((resolve) => setTimeout(resolve, fault.delay));
    else { response.destroy(); return; }
  }
  return result === undefined ? json(response, { message: "Not found" }, 404) : json(response, result, status);
}

before(async () => {
  server = createServer((request, response) => { route(request, response).catch((error) => { json(response, { message: "Fixture failure" }, 500); throw error; }); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  localOrigin = `http://127.0.0.1:${server.address().port}`;
  options = { fetch: async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.github.com");
    assert.equal(init.redirect, "manual");
    assert.ok(!["PATCH", "PUT", "DELETE"].includes(init.method));
    return fetch(localOrigin + url.pathname + url.search, init);
  } };
});
beforeEach(reset);
after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });

function errorIs(code, unknown) {
  return (error) => {
    assert.ok(error instanceof GitHubChangesError);
    assert.equal(error.code, code);
    if (unknown !== undefined) assert.equal(error.outcomeUnknown, unknown);
    assert.ok(!JSON.stringify(error).includes(TOKEN));
    assert.ok(!String(error).includes("PRIVATE_PROPOSAL"));
    assert.equal(error.cause, undefined);
    return true;
  };
}
const posts = () => requests.filter((request) => request.method === "POST");

test("normalizes bounded UTF-8 changes and rejects traversal, workflow paths and ambiguous collisions", () => {
  assert.deepEqual(validateChangeFiles([{ path: "z.txt", content: null }, { path: "a.txt", content: "世界" }]), [
    { path: "a.txt", content: "世界" }, { path: "z.txt", content: null },
  ]);
  const invalid = [[], Array.from({ length: 31 }, (_, index) => ({ path: `file-${index}`, content: "" })),
    ...["../a", "/a", "a//b", "a/./b", "C:\\a", ".git/config", "nested/.GIT/config", ".github/workflows/test.yml", "a/.github/workflows/x", "NUL.txt", "a.", "a/", "x".repeat(301)]
      .map((path) => [{ path, content: "code" }]),
    [{ path: "a", content: "x" }, { path: "a/b", content: "y" }],
    [{ path: "Readme", content: "x" }, { path: "README", content: "y" }],
    [{ path: "a", content: "\ud800" }], [{ path: "a", content: "binary\0data" }],
    [{ path: "a", content: "x".repeat(256 * 1024 + 1) }], [{ path: "a", content: "界".repeat(90_000) }],
    Array.from({ length: 5 }, (_, index) => ({ path: `file-${index}`, content: "x".repeat(256 * 1024) })),
  ];
  for (const files of invalid) assert.throws(() => validateChangeFiles(files), errorIs("invalid_request", false));
  assert.equal(requests.length, 0);
});

test("snapshot uses one exact branch commit and supports public read without credentials", async () => {
  state.refs.set("feature/group", state.baseSha);
  assert.deepEqual(await getRepositorySnapshot(REPO, "feature/group", undefined, options), { commit_sha: state.baseSha, tree_sha: state.baseTree });
  assert.equal(requests[0].headers.authorization, undefined);
  assert.equal(requests[1].path, `${ROOT}/git/commits/${state.baseSha}`);
  assert.equal(posts().length, 0);
});

test("reads an exact UTF-8 blob and preserves BOM and multibyte characters", async () => {
  const content = "\ufeffHello 世界\n";
  const tree = buildTree(new Map([["docs/readme.md", { content }]]));
  const sha = hash("unicode-commit");
  state.commits.set(sha, { sha, message: "Unicode", tree: { sha: tree }, parents: [{ sha: state.baseSha }] });
  const file = await readRepositoryFile(REPO, sha, "docs/readme.md", TOKEN, options);
  assert.deepEqual(file, { path: "docs/readme.md", content, encoding: "utf-8", blob_sha: objectHash("blob", Buffer.from(content)), commit_sha: sha });
  assert.equal(requests[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(posts().length, 0);
});

test("file reading never follows symlinks, submodules or directories", async () => {
  for (const path of ["link", "vendor", "src"]) await assert.rejects(readRepositoryFile(REPO, state.baseSha, path, TOKEN, options), errorIs("invalid_request", false));
  assert.ok(!requests.some((request) => request.path.includes("/git/blobs/")));
  await assert.rejects(readRepositoryFile(REPO, state.baseSha, "missing.txt", TOKEN, options), errorIs("file_not_found", false));
});

test("an inaccessible blob is not mistaken for a confirmed absent file during review", async () => {
  const sha = state.trees.get(state.baseTree).tree.find((entry) => entry.path === "README.md").sha;
  state.blobs.delete(sha);
  await assert.rejects(readRepositoryFile(REPO, state.baseSha, "README.md", TOKEN, options), errorIs("not_found", false));
  await assert.rejects(readRepositoryFile(REPO, state.baseSha, "actually-missing.txt", TOKEN, options), errorIs("file_not_found", false));
});

test("lists one exact-commit directory with special object metadata and no blob reads", async () => {
  const root = await listRepositoryFiles(REPO, state.baseSha, "", TOKEN, options);
  assert.equal(root.commit_sha, state.baseSha);
  assert.equal(root.path, "");
  assert.equal(root.truncated, false);
  assert.deepEqual(Object.fromEntries(root.entries.map((entry) => [entry.name, entry.type])), {
    "README.md": "file", bin: "directory", link: "symlink", src: "directory", vendor: "submodule",
  });
  const nested = await listRepositoryFiles(REPO, state.baseSha, "src", TOKEN, options);
  assert.deepEqual(nested.entries.map((entry) => entry.path), ["src/main.ts", "src/old.txt"]);
  assert.ok(!requests.some((request) => request.path.includes("/git/blobs/")));
  assert.equal(posts().length, 0);
});

test("directory discovery caps output at 500 and accurately marks truncation", async () => {
  const files = new Map(Array.from({ length: 501 }, (_, index) => [`file-${String(index).padStart(3, "0")}.txt`, { content: "x" }]));
  const tree = buildTree(files); const sha = hash("large-directory");
  state.commits.set(sha, { sha, tree: { sha: tree }, parents: [], message: "Many files" });
  const result = await listRepositoryFiles(REPO, sha, "", undefined, options);
  assert.equal(result.entries.length, 500); assert.equal(result.truncated, true);
  state.trees.get(state.baseTree).truncated = true;
  assert.equal((await listRepositoryFiles(REPO, state.baseSha, "", undefined, options)).truncated, true);
  await assert.rejects(readRepositoryFile(REPO, state.baseSha, "missing.txt", undefined, options), errorIs("invalid_response", false));
});

test("directory discovery refuses traversal and does not follow symlinks or submodules", async () => {
  await assert.rejects(listRepositoryFiles(REPO, state.baseSha, "../outside", TOKEN, options), errorIs("invalid_request", false));
  assert.equal(requests.length, 0);
  for (const path of ["link", "vendor", "README.md"]) await assert.rejects(listRepositoryFiles(REPO, state.baseSha, path, TOKEN, options), errorIs("invalid_request", false));
  assert.ok(!requests.some((request) => request.path.includes("/git/blobs/")));
});

test("blob bytes, size and hash are verified before returning code", async () => {
  const original = [...state.blobs.values()][0];
  for (const replacement of [
    { ...original, content: Buffer.from("incorrect bytes").toString("base64") },
    { ...original, size: 256 * 1024 + 1 },
    { ...original, encoding: "utf-8" },
    { ...original, content: "%%%=" },
    { ...original, content: Buffer.from([0xff]).toString("base64"), size: 1 },
  ]) {
    state.blobs.set(original.sha, replacement);
    await assert.rejects(readRepositoryFile(REPO, state.baseSha, "README.md", TOKEN, options), errorIs("invalid_response", false));
  }
});

test("publishes a verified exact-base tree, single-parent commit, new branch and draft PR", async () => {
  const input = proposal();
  const result = await publishChanges(input, options);
  assert.equal(result.branch, "agentparty/proposal-001");
  assert.equal(result.html_url, `https://github.com/${REPO}/pull/1`);
  assert.equal(result.number, 1);
  assert.equal(state.refs.get("main"), state.baseSha);
  const created = state.commits.get(result.commit_sha);
  assert.deepEqual(created.parents, [{ sha: state.baseSha }]);
  assert.match(created.message, /AgentParty-Proposal: proposal-001/);
  const files = state.filesByTree.get(created.tree.sha);
  assert.equal(files.get("README.md").content, "Original readme\n");
  assert.equal(files.get("src/main.ts").content, input.files[0].content);
  assert.equal(files.has("src/old.txt"), false);
  assert.equal(files.get("bin/run.sh").mode, "100755");
  assert.equal(files.get("docs/guide.md").mode, "100644");
  assert.deepEqual(posts().map((request) => request.path), ["/git/trees", "/git/commits", "/git/refs", "/pulls"].map((path) => ROOT + path));
  assert.equal(state.pulls[0].draft, true);
});

test("no-op changes, missing deletions and special objects fail before any write", async () => {
  for (const files of [
    [{ path: "README.md", content: "Original readme\n" }], [{ path: "missing.txt", content: null }],
    [{ path: "link", content: "new" }], [{ path: "vendor/file", content: "new" }], [{ path: "src", content: "replace tree" }],
  ]) await assert.rejects(publishChanges(proposal({ files }), options), errorIs("conflict", false));
  assert.equal(posts().length, 0);
});

test("base movement blocks publication before the first write", async () => {
  state.refs.set("main", hash("new-base"));
  await assert.rejects(publishChanges(proposal(), options), errorIs("conflict", false));
  assert.equal(posts().length, 0);
  assert.equal(state.refs.size, 1);
});

test("base movement after object creation leaves no published branch and never force updates", async () => {
  let checks = 0;
  state.hook = async (request) => {
    if (request.method === "GET" && request.path.endsWith("/git/ref/heads/main") && ++checks === 2) state.refs.set("main", hash("new-base"));
    return false;
  };
  await assert.rejects(publishChanges(proposal(), options), errorIs("conflict", true));
  assert.equal(state.refs.has("agentparty/proposal-001"), false);
  assert.deepEqual(posts().map((request) => request.path), [`${ROOT}/git/trees`, `${ROOT}/git/commits`]);
});

test("same immutable proposal returns its existing PR with no new writes, even after base advances", async () => {
  const first = await publishChanges(proposal(), options);
  const count = posts().length;
  state.refs.set("main", hash("advanced-base"));
  assert.deepEqual(await publishChanges(proposal(), options), first);
  assert.equal(posts().length, count);
  state.pulls[0].state = "closed";
  assert.deepEqual(await publishChanges(proposal(), options), first);
  assert.equal(state.pulls.length, 1, "closed proposals must not produce duplicate PRs");
});

test("uncertain branch creation recovers by validating the existing commit and tree", async () => {
  state.fault = { path: "/git/refs" };
  await assert.rejects(publishChanges(proposal(), options), errorIs("transport_failed", true));
  assert.ok(state.refs.has("agentparty/proposal-001"));
  const result = await publishChanges(proposal(), options);
  assert.equal(result.number, 1);
  assert.equal(posts().filter((request) => request.path.endsWith("/git/refs")).length, 1);
  assert.equal(posts().filter((request) => request.path.endsWith("/git/commits")).length, 1);
});

test("uncertain PR creation recovers the same head PR without duplicating it", async () => {
  state.fault = { path: "/pulls" };
  await assert.rejects(publishChanges(proposal(), options), errorIs("transport_failed", true));
  assert.equal(state.pulls.length, 1);
  const result = await publishChanges(proposal(), options);
  assert.equal(result.number, 1);
  assert.equal(posts().filter((request) => request.path.endsWith("/pulls")).length, 1);
});

test("lost PR receipt recovers a closed PR after its branch was deleted without recreating the branch", async () => {
  state.fault = { path: "/pulls" };
  await assert.rejects(publishChanges(proposal(), options), errorIs("transport_failed", true));
  const pull = state.pulls[0];
  pull.state = "closed";
  state.refs.delete("agentparty/proposal-001");
  state.refs.set("main", hash("merged-base"));
  const count = posts().length;
  assert.deepEqual(await publishChanges(proposal(), options), {
    branch: "agentparty/proposal-001", commit_sha: pull.head.sha, number: pull.number,
    html_url: `https://github.com/${REPO}/pull/${pull.number}`,
  });
  assert.equal(posts().length, count);
  assert.equal(state.refs.has("agentparty/proposal-001"), false);
});

test("proposal content or metadata cannot be changed under an existing proposal branch", async () => {
  await publishChanges(proposal(), options);
  const count = posts().length;
  for (const changed of [proposal({ title: "Different title" }), proposal({ description: "Different description" }), proposal({ files: [{ path: "README.md", content: "Different files" }] })]) {
    await assert.rejects(publishChanges(changed, options), errorIs("conflict", false));
  }
  assert.equal(posts().length, count);
});

test("forged proposal branch commits cannot change the parent or omit the manifest", async () => {
  const result = await publishChanges(proposal(), options);
  const original = state.commits.get(result.commit_sha);
  const count = posts().length;
  for (const patch of [{ parents: [{ sha: hash("foreign-parent") }] }, { parents: [...original.parents, { sha: hash("extra-parent") }] }, { message: "AgentParty-Proposal: proposal-001" }]) {
    state.commits.set(result.commit_sha, { ...original, ...patch });
    await assert.rejects(publishChanges(proposal(), options), errorIs("conflict", false));
  }
  assert.equal(posts().length, count);
});

test("correct proposal marker cannot conceal extra code changes or executable mode changes", async () => {
  const result = await publishChanges(proposal(), options);
  const original = state.commits.get(result.commit_sha);
  const files = state.filesByTree.get(original.tree.sha);
  const count = posts().length;
  for (const [path, patch] of [["README.md", { content: "UNAPPROVED" }], ["src/main.ts", { content: proposal().files[0].content, mode: "100755" }], ["extra/hidden.txt", { content: "UNAPPROVED" }]]) {
    const changed = new Map(files); changed.set(path, patch);
    state.commits.set(result.commit_sha, { ...original, tree: { sha: buildTree(changed) } });
    await assert.rejects(publishChanges(proposal(), options), errorIs("conflict", false));
  }
  assert.equal(posts().length, count);
});

test("an existing PR with a different base or unverifiable marker is never overwritten", async () => {
  await publishChanges(proposal(), options);
  const original = structuredClone(state.pulls[0]);
  const count = posts().length;
  for (const value of [{ ...original, body: "Foreign PR" }, { ...original, base: { ...original.base, ref: "other" } }]) {
    state.pulls[0] = value;
    await assert.rejects(publishChanges(proposal(), options), errorIs("conflict", false));
  }
  assert.equal(posts().length, count);
});

test("truncated trees are refused before writes", async () => {
  state.trees.get(state.baseTree).truncated = true;
  await assert.rejects(publishChanges(proposal(), options), errorIs("invalid_response", false));
  assert.equal(posts().length, 0);
});

test("redirects never reach a credential-capture endpoint", async () => {
  state.hook = async (_request, response) => { json(response, { secret: TOKEN }, 302, { Location: `${localOrigin}/credential-capture` }); return true; };
  await assert.rejects(getRepositorySnapshot(REPO, "main", TOKEN, options), errorIs("transport_failed", false));
  assert.equal(requests.length, 1);
});

test("invalid names, refs, credentials and proposal fields cause no HTTP requests", async () => {
  for (const input of [proposal({ fullName: "https://evil.example/repo" }), proposal({ fullName: "owner/.." }), proposal({ baseBranch: "../main" }),
    proposal({ baseSha: "main" }), proposal({ proposalId: "../../main" }), proposal({ credential: "secret\r\nInjected" }),
    proposal({ title: "PRIVATE_PROPOSAL\nAgentParty-Proposal: forged" }), proposal({ description: "x".repeat(20_001) })]) {
    await assert.rejects(publishChanges(input, options), errorIs("invalid_request", false));
  }
  assert.equal(requests.length, 0);
});

test("malformed, non-JSON, oversized and access errors are bounded and scrubbed", async () => {
  for (const fixture of [
    { status: 200, type: "text/html", text: TOKEN },
    { status: 200, type: "application/json", text: "{invalid" },
    { status: 200, type: "application/json", text: JSON.stringify({ token: "x".repeat(2 * 1024 * 1024) }) },
  ]) {
    state.hook = async (_request, response) => { response.writeHead(fixture.status, { "Content-Type": fixture.type }); response.end(fixture.text); return true; };
    await assert.rejects(getRepositorySnapshot(REPO, "main", TOKEN, options), errorIs("invalid_response", false));
  }
  state.hook = async (_request, response) => { json(response, { message: TOKEN }, 403); return true; };
  await assert.rejects(getRepositorySnapshot(REPO, "main", TOKEN, options), errorIs("access_denied", false));
  await assert.rejects(getRepositorySnapshot(REPO, "main", TOKEN, { fetch: async () => { throw new Error(TOKEN); } }), errorIs("transport_failed", false));
});

test("whole-operation deadline includes response body and prevents subsequent writes", async () => {
  state.hook = async (_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" }); response.write('{"ref":');
    await new Promise((resolve) => setTimeout(resolve, 80)); response.end("null}"); return true;
  };
  await assert.rejects(getRepositorySnapshot(REPO, "main", TOKEN, { ...options, timeoutMs: 25 }), errorIs("timeout", false));
  assert.equal(requests.length, 1);
  assert.equal(posts().length, 0);
});

test("write timeout is an uncertain outcome and a later identical retry recovers safely", async () => {
  state.fault = { path: "/git/refs", delay: 150 };
  await assert.rejects(publishChanges(proposal(), { ...options, timeoutMs: 80 }), errorIs("timeout", true));
  assert.ok(state.refs.has("agentparty/proposal-001"));
  assert.equal(state.pulls.length, 0);
  const result = await publishChanges(proposal(), options);
  assert.equal(result.number, 1);
  assert.equal(posts().filter((request) => request.path.endsWith("/git/refs")).length, 1);
});


test("expired publication authority prevents the first GitHub write", async () => {
  let checks = 0;
  await assert.rejects(publishChanges(proposal(), { ...options, beforeWrite: async () => { checks++; return false; } }),
    (error) => error instanceof GitHubChangesError && error.code === "conflict" && error.outcomeUnknown === true);
  assert.equal(checks, 1);
  assert.equal(requests.filter((request) => request.method === "POST").length, 0);
  assert.equal(state.refs.size, 1);
});

test("publication authority is checked again between external writes", async () => {
  let checks = 0;
  await assert.rejects(publishChanges(proposal(), { ...options, beforeWrite: async () => ++checks < 2 }),
    (error) => error instanceof GitHubChangesError && error.outcomeUnknown === true);
  assert.equal(checks, 2);
  assert.deepEqual(requests.filter((request) => request.method === "POST").map((request) => request.path), [`${ROOT}/git/trees`]);
  assert.equal(state.refs.size, 1);
  assert.equal(state.pulls.length, 0);
});

test("publication authority errors fail closed without disclosing database details", async () => {
  await assert.rejects(publishChanges(proposal(), { ...options, beforeWrite: async () => { throw new Error("SECRET_DATABASE_DETAILS"); } }),
    (error) => error instanceof GitHubChangesError && error.outcomeUnknown === true && !error.message.includes("SECRET_DATABASE_DETAILS"));
  assert.equal(requests.filter((request) => request.method === "POST").length, 0);
});
