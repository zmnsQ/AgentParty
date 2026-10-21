/** Exact-snapshot GitHub proposals. Only a new proposal branch and a draft PR are published. */
export interface GitHubChangesOptions {
  fetch?: typeof fetch;
  /** One deadline for the entire operation, including response bodies. Default: 30 seconds. */
  timeoutMs?: number;
}
export interface GitHubChangeFile { path: string; content: string | null }
export interface RepositorySnapshot { commit_sha: string; tree_sha: string }
export interface RepositoryFile {
  path: string; content: string; encoding: "utf-8"; blob_sha: string; commit_sha: string;
}
export interface RepositoryDirectoryEntry {
  name: string; path: string; type: "file" | "directory" | "symlink" | "submodule";
  sha: string; mode: string;
}
export interface RepositoryDirectory {
  commit_sha: string; path: string; entries: RepositoryDirectoryEntry[]; truncated: boolean;
}
export interface PublishChangesInput {
  fullName: string; baseBranch: string; baseSha: string; proposalId: string;
  title: string; description: string; files: unknown; credential: string;
}
export interface PublishedChanges { branch: string; commit_sha: string; html_url: string; number: number }
export type GitHubChangesErrorCode = "invalid_request" | "access_denied" | "not_found" | "file_not_found" | "conflict"
  | "rate_limited" | "timeout" | "transport_failed" | "invalid_response" | "github_unavailable";

/** Messages are fixed local text. Never attach credentials, proposal text, URLs or response bodies. */
export class GitHubChangesError extends Error {
  constructor(
    public readonly code: GitHubChangesErrorCode,
    message: string,
    public readonly status = 502,
    /** A remote write was attempted. Retry only this exact immutable proposal; never replace its ref. */
    public readonly outcomeUnknown = false,
  ) { super(message); this.name = "GitHubChangesError"; }
}

const ORIGIN = "https://api.github.com";
const FILE_BYTES = 256 * 1024;
const TOTAL_BYTES = 1024 * 1024;
const RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REQUESTS = 200;
const encoder = new TextEncoder();
const SHA_RE = /^[a-f0-9]{40}$/;
const MODES: Readonly<Record<string, string>> = {
  "100644": "blob", "100755": "blob", "120000": "blob", "040000": "tree", "160000": "commit",
};

function invalid(): never {
  throw new GitHubChangesError("invalid_request", "Invalid repository proposal. Check its identifiers, paths and UTF-8 text limits.", 400);
}
function wellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function pathValue(value: unknown, change = true): string {
  if (typeof value !== "string" || !value || value.length > 300 || !wellFormed(value)
    || /[\x00-\x1f\x7f\\<>:"|?*]/.test(value) || value.startsWith("/") || value.endsWith("/")) invalid();
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part)
    || part.toLowerCase() === ".git" || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) invalid();
  if (change && parts.some((part, index) => part.toLowerCase() === ".github"
    && parts[index + 1]?.toLowerCase() === "workflows")) invalid();
  return value;
}
export function validateChangeFiles(files: unknown): GitHubChangeFile[] {
  if (!Array.isArray(files) || files.length < 1 || files.length > 30) invalid();
  let total = 0;
  const names = new Set<string>();
  const result = files.map((file): GitHubChangeFile => {
    if (typeof file !== "object" || file === null || Array.isArray(file)) invalid();
    const value = file as Record<string, unknown>;
    const path = pathValue(value.path);
    // These proposals are used on macOS and Windows as well as case-sensitive systems.
    const key = path.normalize("NFC").toLowerCase();
    if (names.has(key)) invalid();
    names.add(key);
    const content = value.content;
    if (content !== null) {
      if (typeof content !== "string" || content.length > FILE_BYTES || !wellFormed(content) || content.includes("\0")) invalid();
      const bytes = encoder.encode(content).byteLength;
      if (bytes > FILE_BYTES) invalid();
      total += bytes;
      if (total > TOTAL_BYTES) invalid();
    }
    return { path, content };
  });
  for (const name of names) {
    const segments = name.split("/");
    for (let index = 1; index < segments.length; index++) if (names.has(segments.slice(0, index).join("/"))) invalid();
  }
  return result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function repositoryPath(fullName: unknown): string {
  if (typeof fullName !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(fullName)
    || fullName.split("/").some((part) => part === "." || part === "..")) invalid();
  return `/repos/${fullName.split("/").map(encodeURIComponent).join("/")}`;
}
function branchValue(branch: unknown): string {
  if (typeof branch !== "string" || !branch || branch.length > 250 || !wellFormed(branch)
    || /[\x00-\x20\x7f~^:?*\[\\]/.test(branch) || branch.includes("..") || branch.includes("@{")
    || branch === "@" || branch.startsWith("-")
    || branch.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".") || part.endsWith(".lock"))) invalid();
  return branch;
}
function shaValue(value: unknown): string {
  if (typeof value !== "string" || !SHA_RE.test(value)) invalid();
  return value;
}
function credentialValue(value: unknown, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value || value.length > 8192 || /[^\x21-\x7e]/.test(value)) invalid();
  return value;
}
function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function blobSha(content: string): Promise<string> {
  const data = encoder.encode(content);
  const prefix = encoder.encode(`blob ${data.byteLength}\0`);
  const object = new Uint8Array(prefix.byteLength + data.byteLength);
  object.set(prefix); object.set(data, prefix.byteLength);
  return hex(await crypto.subtle.digest("SHA-1", object));
}

class GitHubOperation {
  readonly abort = new AbortController();
  wrote = false;
  timedOut = false;
  private requests = 0;
  constructor(readonly repo: string, private readonly token: string | undefined, private readonly options: GitHubChangesOptions) {}
  error(code: GitHubChangesErrorCode, message: string, status = 502): never {
    throw new GitHubChangesError(code, message, status, this.wrote);
  }
  malformed(): never { return this.error("invalid_response", "GitHub returned an invalid or unsupported response."); }
  conflict(): never { return this.error("conflict", "The repository or proposal branch no longer matches this immutable proposal. Review it before retrying.", 409); }
  record(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) this.malformed();
    return value as Record<string, unknown>;
  }
  sha(value: unknown): string {
    if (typeof value !== "string" || !SHA_RE.test(value)) this.malformed();
    return value;
  }
  private checkDeadline(): void {
    if (this.timedOut || this.abort.signal.aborted) this.error("timeout", "GitHub operation timed out. Retry only the same immutable proposal after reviewing its status.", 504);
  }
  async request(path: string, body?: unknown, missing = false): Promise<unknown | null> {
    this.checkDeadline();
    if (++this.requests > MAX_REQUESTS) this.error("invalid_response", "This repository exceeds the supported verification size.");
    const url = new URL(ORIGIN + this.repo + path);
    if (url.origin !== ORIGIN || !url.pathname.startsWith(this.repo + "/") || url.username || url.password || url.hash) invalid();
    const isWrite = body !== undefined;
    // Setting this before fetch covers a connection failure after GitHub accepted a write.
    if (isWrite) this.wrote = true;
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(url.href, {
        // workerd supports manual/follow, not error. Reject 3xx below without following Location.
        method: isWrite ? "POST" : "GET", redirect: "manual", signal: this.abort.signal,
        headers: {
          Accept: "application/vnd.github+json", "User-Agent": "AgentParty-Commons", "X-GitHub-Api-Version": "2022-11-28",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(isWrite ? { "Content-Type": "application/json" } : {}),
        },
        ...(isWrite ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      this.checkDeadline();
      return this.error("transport_failed", "GitHub could not be reached. Retry only the same immutable proposal after reviewing its status.");
    }
    this.checkDeadline();
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => undefined);
      this.error("transport_failed", "GitHub redirects are not allowed. Rebind the canonical repository before retrying.");
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      if (response.status === 404 && missing) return null;
      if (response.status === 404) this.error("not_found", "The repository object is not accessible with this credential.", 404);
      if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) {
        this.error("rate_limited", "GitHub rate limit reached. Retry this same proposal later.", 429);
      }
      if (response.status === 401 || response.status === 403) this.error("access_denied", "GitHub denied access. Check the token's repository and permission scope.", 403);
      if (response.status === 409 || response.status === 422) this.conflict();
      this.error("github_unavailable", "GitHub could not complete the request. Review this proposal's status before retrying.");
    }
    if (response.status !== (isWrite ? 201 : 200)) this.malformed();
    if (!response.headers.get("content-type")?.toLowerCase().match(/^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/)) this.malformed();
    const size = response.headers.get("content-length");
    if (size && (!/^\d+$/.test(size) || Number(size) > RESPONSE_BYTES)) this.malformed();
    if (!response.body) this.malformed();
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
    let bytes = 0; let text = "";
    try {
      for (;;) {
        const part = await reader.read();
        this.checkDeadline();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > RESPONSE_BYTES) this.malformed();
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
      return JSON.parse(text) as unknown;
    } catch (error) {
      if (error instanceof GitHubChangesError) throw error;
      this.checkDeadline();
      return this.malformed();
    } finally { void reader.cancel().catch(() => undefined); }
  }
}

async function operation<T>(fullName: string, credential: string | undefined, options: GitHubChangesOptions, run: (api: GitHubOperation) => Promise<T>): Promise<T> {
  const repo = repositoryPath(fullName);
  const token = credentialValue(credential);
  const timeout = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 120_000) invalid();
  const api = new GitHubOperation(repo, token, options);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      api.timedOut = true;
      api.abort.abort();
      reject(new GitHubChangesError("timeout", "GitHub operation timed out. Retry only the same immutable proposal after reviewing its status.", 504, api.wrote));
    }, timeout);
  });
  try { return await Promise.race([run(api), deadline]); }
  catch (error) {
    if (error instanceof GitHubChangesError) throw error;
    // Never retain causes from fetch, malformed data, crypto, or proposal-controlled objects.
    throw new GitHubChangesError("invalid_response", "GitHub could not safely verify this repository operation.", 502, api.wrote);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

interface CommitObject { sha: string; tree: string; parents: string[]; message: string }
function parseCommit(api: GitHubOperation, data: unknown, expectedSha?: string): CommitObject {
  const value = api.record(data);
  const sha = api.sha(value.sha);
  if ((expectedSha && sha !== expectedSha) || typeof value.message !== "string" || value.message.length > 65_536
    || !Array.isArray(value.parents) || value.parents.length > 16) api.malformed();
  return { sha, tree: api.sha(api.record(value.tree).sha), message: value.message,
    parents: value.parents.map((parent) => api.sha(api.record(parent).sha)) };
}
async function commit(api: GitHubOperation, sha: string): Promise<CommitObject> {
  return parseCommit(api, await api.request(`/git/commits/${sha}`), sha);
}
function parseReference(api: GitHubOperation, data: unknown, branch: string): string {
  const value = api.record(data); const object = api.record(value.object);
  if (value.ref !== `refs/heads/${branch}` || object.type !== "commit") api.malformed();
  return api.sha(object.sha);
}
async function reference(api: GitHubOperation, branch: string, optional = false): Promise<string | null> {
  const value = await api.request(`/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`, undefined, optional);
  return value === null ? null : parseReference(api, value, branch);
}
async function requireBase(api: GitHubOperation, branch: string, sha: string): Promise<void> {
  if (await reference(api, branch) !== sha) api.conflict();
}

interface TreeEntry { path: string; mode: string; type: string; sha: string }
type Tree = Map<string, TreeEntry>;
function parseTree(api: GitHubOperation, data: unknown, sha: string, allowTruncated = false): { entries: Tree; truncated: boolean } {
  const value = api.record(data);
  if (value.sha !== sha || typeof value.truncated !== "boolean" || (!allowTruncated && value.truncated)
    || !Array.isArray(value.tree) || value.tree.length > 20_000) api.malformed();
  const entries: Tree = new Map();
  for (const item of value.tree as unknown[]) {
    const entry = api.record(item);
    if (typeof entry.path !== "string" || !entry.path || entry.path.length > 4096 || /[\0/]/.test(entry.path)
      || !wellFormed(entry.path) || entry.path === "." || entry.path === ".." || entries.has(entry.path)
      || typeof entry.mode !== "string" || !Object.hasOwn(MODES, entry.mode) || MODES[entry.mode] !== entry.type) api.malformed();
    entries.set(entry.path as string, { path: entry.path as string, mode: entry.mode as string, type: entry.type as string, sha: api.sha(entry.sha) });
  }
  return { entries, truncated: value.truncated as boolean };
}
class TreeReader {
  private readonly cache = new Map<string, Tree>();
  constructor(private readonly api: GitHubOperation) {}
  async read(sha: string | undefined): Promise<Tree> {
    if (sha === undefined) return new Map();
    const cached = this.cache.get(sha);
    if (cached) return cached;
    const result = parseTree(this.api, await this.api.request(`/git/trees/${sha}`), sha).entries;
    this.cache.set(sha, result);
    return result;
  }
  async file(root: string, path: string): Promise<TreeEntry | undefined> {
    let sha = root;
    const parts = path.split("/");
    for (let index = 0; index < parts.length; index++) {
      const entry = (await this.read(sha)).get(parts[index]);
      if (!entry) return undefined;
      if (index === parts.length - 1) return entry;
      if (entry.type !== "tree") this.api.conflict();
      sha = entry.sha;
    }
    return undefined;
  }
}
function regular(entry: TreeEntry | undefined): boolean {
  return entry?.type === "blob" && (entry.mode === "100644" || entry.mode === "100755");
}

export async function getRepositorySnapshot(fullName: string, baseBranch: string, credential?: string, options: GitHubChangesOptions = {}): Promise<RepositorySnapshot> {
  const branch = branchValue(baseBranch);
  return operation(fullName, credential, options, async (api) => {
    const sha = await reference(api, branch);
    if (!sha) return api.malformed();
    const value = await commit(api, sha);
    return { commit_sha: value.sha, tree_sha: value.tree };
  });
}

export async function readRepositoryFile(fullName: string, commitSha: string, path: string, credential?: string, options: GitHubChangesOptions = {}): Promise<RepositoryFile> {
  const sha = shaValue(commitSha); const filePath = pathValue(path, false);
  return operation(fullName, credential, options, async (api) => {
    const snapshot = await commit(api, sha);
    const entry = await new TreeReader(api).file(snapshot.tree, filePath);
    // Only an absent entry in a complete tree proves absence. A GitHub object 404
    // can mean inaccessible data and must not turn an existing file into a new-file review.
    if (!entry) return api.error("file_not_found", "The file does not exist at this exact commit.", 404);
    if (!regular(entry)) api.error("invalid_request", "Only regular UTF-8 files can be read; symlinks, submodules and directories are not followed.", 400);
    const blob = api.record(await api.request(`/git/blobs/${entry.sha}`));
    if (blob.sha !== entry.sha || blob.encoding !== "base64" || typeof blob.size !== "number" || !Number.isSafeInteger(blob.size)
      || blob.size < 0 || blob.size > FILE_BYTES || typeof blob.content !== "string" || blob.content.length > FILE_BYTES * 2) return api.malformed();
    const encoded = blob.content.replace(/[\r\n]/g, "");
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) api.malformed();
    let data: Uint8Array; let content: string;
    try {
      const decoded = atob(encoded);
      if (btoa(decoded) !== encoded) api.malformed();
      data = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
      content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
    } catch { return api.malformed(); }
    if (data.byteLength !== blob.size || content.includes("\0") || await blobSha(content) !== entry.sha) api.malformed();
    return { path: filePath, content, encoding: "utf-8", blob_sha: entry.sha, commit_sha: sha };
  });
}

/** One directory only. A truncated listing is discovery data, never proof of an absent file. */
export async function listRepositoryFiles(fullName: string, commitSha: string, path = "", credential?: string, options: GitHubChangesOptions = {}): Promise<RepositoryDirectory> {
  const sha = shaValue(commitSha); const directory = path === "" ? "" : pathValue(path, false);
  return operation(fullName, credential, options, async (api) => {
    const snapshot = await commit(api, sha);
    let tree = snapshot.tree;
    if (directory) {
      const entry = await new TreeReader(api).file(tree, directory);
      if (!entry) return api.error("file_not_found", "The directory does not exist at this exact commit.", 404);
      if (entry.type !== "tree") return api.error("invalid_request", "Only repository directories can be listed; files, symlinks and submodules are not followed.", 400);
      tree = entry.sha;
    }
    const result = parseTree(api, await api.request(`/git/trees/${tree}`), tree, true);
    const entries = [...result.entries.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return {
      commit_sha: sha, path: directory, truncated: result.truncated || entries.length > 500,
      entries: entries.slice(0, 500).map((entry): RepositoryDirectoryEntry => ({
        name: entry.path, path: directory ? `${directory}/${entry.path}` : entry.path,
        type: entry.type === "tree" ? "directory" : entry.type === "commit" ? "submodule" : entry.mode === "120000" ? "symlink" : "file",
        sha: entry.sha, mode: entry.mode,
      })),
    };
  });
}

interface ExpectedFile extends GitHubChangeFile { sha: string | null; mode: string }
interface ChangeNode { children: Map<string, ChangeNode>; file?: ExpectedFile }
function changesTree(files: ExpectedFile[]): ChangeNode {
  const root: ChangeNode = { children: new Map() };
  for (const file of files) {
    let current = root;
    for (const part of file.path.split("/")) {
      let node = current.children.get(part);
      if (!node) { node = { children: new Map() }; current.children.set(part, node); }
      current = node;
    }
    current.file = file;
  }
  return root;
}

/** Compare complete directory listings along changed paths; unchanged subtrees must retain their SHA. */
async function verifyTree(api: GitHubOperation, reader: TreeReader, beforeSha: string | undefined, afterSha: string | undefined, changes: ChangeNode): Promise<void> {
  const before = await reader.read(beforeSha); const after = await reader.read(afterSha);
  const names = new Set([...before.keys(), ...after.keys(), ...changes.children.keys()]);
  for (const name of names) {
    const previous = before.get(name); const next = after.get(name); const change = changes.children.get(name);
    if (!change) {
      if (!previous || !next || previous.sha !== next.sha || previous.mode !== next.mode || previous.type !== next.type) api.conflict();
    } else if (change.file) {
      const file = change.file;
      if (previous && !regular(previous)) api.conflict();
      if (file.content === null) {
        if (!previous || next) api.conflict();
      } else if (!regular(next) || next?.sha !== file.sha || next.mode !== file.mode) api.conflict();
    } else {
      if ((previous && previous.type !== "tree") || (next && next.type !== "tree")) api.conflict();
      await verifyTree(api, reader, previous?.sha, next?.sha, change);
    }
  }
}

function validatePublishedCommit(api: GitHubOperation, value: CommitObject, baseSha: string, message: string, tree?: string): void {
  if (value.parents.length !== 1 || value.parents[0] !== baseSha || value.message !== message || (tree && value.tree !== tree)) api.conflict();
}
function pullResult(api: GitHubOperation, data: unknown, fullName: string, branch: string, baseBranch: string, sha: string, marker: string, created = false): PublishedChanges {
  const value = api.record(data); const head = api.record(value.head); const base = api.record(value.base);
  const headRepo = api.record(head.repo); const baseRepo = api.record(base.repo);
  if (typeof headRepo.full_name !== "string" || headRepo.full_name.toLowerCase() !== fullName.toLowerCase()
    || typeof baseRepo.full_name !== "string" || baseRepo.full_name.toLowerCase() !== fullName.toLowerCase()
    || head.ref !== branch || head.sha !== sha || base.ref !== baseBranch || typeof value.body !== "string"
    || !value.body.includes(marker) || (created && (value.draft !== true || value.state !== "open"))) api.conflict();
  if (typeof value.number !== "number" || !Number.isSafeInteger(value.number) || value.number < 1) api.malformed();
  return { branch, commit_sha: sha, html_url: `https://github.com/${fullName}/pull/${value.number}`, number: value.number };
}
async function findPull(api: GitHubOperation, fullName: string, branch: string): Promise<unknown | null> {
  const owner = fullName.split("/")[0];
  // Include closed PRs: a completed/closed proposal must not spawn another PR on retry.
  const value = await api.request(`/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=100`);
  if (!Array.isArray(value) || value.length > 100) api.malformed();
  if (!value.length) return null;
  if (value.length !== 1) api.conflict();
  return value[0];
}
async function existingPull(api: GitHubOperation, fullName: string, branch: string, baseBranch: string, sha: string, marker: string): Promise<PublishedChanges | null> {
  const value = await findPull(api, fullName, branch);
  return value === null ? null : pullResult(api, value, fullName, branch, baseBranch, sha, marker);
}

export async function publishChanges(input: PublishChangesInput, options: GitHubChangesOptions = {}): Promise<PublishedChanges> {
  if (!input || typeof input !== "object") invalid();
  const files = validateChangeFiles(input.files);
  repositoryPath(input.fullName);
  const baseBranch = branchValue(input.baseBranch); const baseSha = shaValue(input.baseSha);
  const token = credentialValue(input.credential, true)!;
  if (typeof input.proposalId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(input.proposalId)
    || typeof input.title !== "string" || !input.title.trim() || input.title.length > 256 || /[\x00-\x1f\x7f]/.test(input.title) || !wellFormed(input.title)
    || typeof input.description !== "string" || input.description.length > 20_000 || input.description.includes("\0") || !wellFormed(input.description)) invalid();
  const { fullName, proposalId, title, description } = input;
  const branch = `agentparty/${proposalId}`;
  if (baseBranch === branch) invalid();
  return operation(fullName, token, options, async (api) => {
    const manifest = hex(await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify({ fullName: fullName.toLowerCase(), baseBranch, baseSha, proposalId, title, description, files }))));
    const message = `${title}\n\nAgentParty-Proposal: ${proposalId}\nAgentParty-Base: ${baseSha}\nAgentParty-Manifest: ${manifest}`;
    const marker = `<!-- agentparty-proposal:${proposalId} manifest:${manifest} -->`;
    const base = await commit(api, baseSha);
    const reader = new TreeReader(api);
    const expected: ExpectedFile[] = [];
    let changed = false;
    for (const file of files) {
      const prior = await reader.file(base.tree, file.path);
      if ((prior && !regular(prior)) || (file.content === null && !prior)) api.conflict();
      const sha = file.content === null ? null : await blobSha(file.content);
      expected.push({ ...file, sha, mode: prior?.mode ?? "100644" });
      if (sha !== prior?.sha) changed = true;
    }
    if (!changed) api.error("conflict", "This proposal has no changes relative to its exact base commit.", 409);
    const changeTree = changesTree(expected);
    let head = await reference(api, branch, true);
    if (head) {
      const existing = await commit(api, head);
      validatePublishedCommit(api, existing, baseSha, message);
      await verifyTree(api, reader, base.tree, existing.tree, changeTree);
    } else {
      // GitHub can delete a branch after merging/closing its PR. A lost publication
      // receipt must recover that PR, not recreate a branch which its owner removed.
      const oldPull = await findPull(api, fullName, branch);
      if (oldPull !== null) {
        const oldHead = api.sha(api.record(api.record(oldPull).head).sha);
        const existing = await commit(api, oldHead);
        validatePublishedCommit(api, existing, baseSha, message);
        await verifyTree(api, reader, base.tree, existing.tree, changeTree);
        return pullResult(api, oldPull, fullName, branch, baseBranch, oldHead, marker);
      }
      await requireBase(api, baseBranch, baseSha);
      const tree = api.record(await api.request("/git/trees", { base_tree: base.tree, tree: expected.map((file) => ({
        path: file.path, mode: file.mode, type: "blob",
        ...(file.content === null ? { sha: null } : { content: file.content }),
      })) }));
      const treeSha = api.sha(tree.sha);
      await verifyTree(api, reader, base.tree, treeSha, changeTree);
      const created = parseCommit(api, await api.request("/git/commits", { message, tree: treeSha, parents: [baseSha] }));
      validatePublishedCommit(api, created, baseSha, message, treeSha);
      // Git objects may be dangling after an interruption; no branch is overwritten or removed.
      await requireBase(api, baseBranch, baseSha);
      const ref = await api.request("/git/refs", { ref: `refs/heads/${branch}`, sha: created.sha });
      head = parseReference(api, ref, branch);
      if (head !== created.sha) api.conflict();
    }
    const existing = await existingPull(api, fullName, branch, baseBranch, head, marker);
    if (existing) return existing;
    await requireBase(api, baseBranch, baseSha);
    if (await reference(api, branch) !== head) api.conflict();
    return pullResult(api, await api.request("/pulls", {
      title, body: `${description}\n\n${marker}\n\nProposed via AgentParty Commons.`,
      head: branch, base: baseBranch, draft: true, maintainer_can_modify: false,
    }), fullName, branch, baseBranch, head, marker, true);
  });
}
