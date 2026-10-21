import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { CodeChangeFile, CodeProposal, CodeProposalDetail, CodeProposalState } from "@agentparty/shared/code-proposals";
import type { AppContext, AppEnv, LoadedChannel } from "../index";
import { sha256Hex, type TokenIdentity } from "../auth";
import type { RepositoryRow } from "./routes";
import { VaultError } from "./vault";
import { validCredential } from "./github";
import { getRepositorySnapshot, GitHubChangesError, listRepositoryFiles, publishChanges, readRepositoryFile, validateChangeFiles } from "./github-changes";

type Ctx = Context<AppContext>;
interface Granted { channel: LoadedChannel; identity: TokenIdentity; slug: string; }
interface Dependencies {
  access(c: Ctx, mode?: "read" | "manage" | "run"): Promise<Response | Granted>;
  forward(c: Ctx, path: string, init?: RequestInit): Response | Promise<Response>;
  repositoryCredential(row: RepositoryRow, env: AppEnv): Promise<string | undefined>;
  canParticipateInChannel(db: D1Database, identity: TokenIdentity, channel: LoadedChannel): Promise<boolean>;
}
interface ProposalRow {
  id: string; channel_slug: string; repository_id: string; request_id: string;
  created_by: string; created_by_hash: string; title: string; description: string;
  base_sha: string; base_branch: string; digest: string; files_json: string; originals_json: string;
  state: CodeProposalState; approved_by: string | null; approved_at: number | null;
  branch: string | null; commit_sha: string | null; pull_request_url: string | null;
  pull_request_number: number | null; error: string | null; lease_until: number; lease_token: string | null;
  created_at: number; updated_at: number;
}
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const MAX_BODY = 2_200_000;
const LEASE_MS = 90_000;

function fail(c: Ctx, status: ContentfulStatusCode, message: string, code = "bad_request") {
  return c.json({ error: { code, message } }, status);
}
function view(row: ProposalRow): CodeProposal {
  return {
    id: row.id, repository_id: row.repository_id, channel: row.channel_slug,
    title: row.title, description: row.description, base_sha: row.base_sha, base_branch: row.base_branch,
    digest: row.digest, state: row.state === "publishing" && row.lease_until < Date.now() ? "unknown" : row.state,
    created_by: row.created_by, approved_by: row.approved_by,
    file_count: (JSON.parse(row.files_json) as CodeChangeFile[]).length,
    branch: row.branch, commit_sha: row.commit_sha, pull_request_url: row.pull_request_url,
    pull_request_number: row.pull_request_number,
    error: row.error ?? (row.state === "publishing" && row.lease_until < Date.now() ? "Publication did not save a final receipt. Retry this same proposal to recover its dedicated branch and pull request." : null),
    created_at: row.created_at, updated_at: row.updated_at,
  };
}
function detail(row: ProposalRow): CodeProposalDetail {
  return { ...view(row), files: JSON.parse(row.files_json) as CodeChangeFile[], originals: JSON.parse(row.originals_json) as CodeChangeFile[] };
}
async function json(c: Ctx, allowed: string[]): Promise<Record<string, unknown> | null> {
  if (c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return null;
  if (Number(c.req.header("content-length") ?? "0") > MAX_BODY) return null;
  const reader = c.req.raw.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let text = ""; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY) return null;
      text += decoder.decode(value, { stream: true });
    }
    const value: unknown = JSON.parse(text + decoder.decode());
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (Object.keys(value).some((key) => !allowed.includes(key))) return null;
    return value as Record<string, unknown>;
  } catch { return null; }
  finally { await reader.cancel().catch(() => undefined); }
}
function route(handler: (c: Ctx) => Promise<Response>) {
  return async (c: Ctx): Promise<Response> => {
    c.header("cache-control", "no-store");
    try { return await handler(c); }
    catch (error) {
      if (error instanceof GitHubChangesError) return fail(c, error.status as ContentfulStatusCode, error.message, error.code);
      if (error instanceof VaultError) return fail(c, 503, error.message, "unavailable");
      return fail(c, 503, "The code proposal operation could not be completed. Check its saved status before retrying.", "unavailable");
    }
  };
}
function load(db: D1Database, slug: string, repositoryId: string, id: string): Promise<ProposalRow | null> {
  return db.prepare("SELECT * FROM code_change_proposals WHERE channel_slug = ? AND repository_id = ? AND id = ?")
    .bind(slug, repositoryId, id).first<ProposalRow>();
}

export function registerProposalRoutes(app: Hono<AppContext>, deps: Dependencies): void {
  const base = "/api/channels/:slug/repositories/:id";
  async function access(c: Ctx, mode: "read" | "propose" | "manage" = "read") {
    const granted = await deps.access(c, mode === "manage" ? "manage" : "read");
    if (granted instanceof Response) return granted;
    const { identity, channel, slug } = granted;
    // Even public group visibility cannot broaden a delegated token's scope.
    if (identity.channel_scope != null && identity.channel_scope !== slug) return fail(c, 403, "This credential belongs to another group.", "forbidden");
    if (mode === "propose") {
      if (identity.role === "readonly" || !(await deps.canParticipateInChannel(c.env.DB, identity, channel))) return fail(c, 403, "Only participating members may submit code proposals.", "forbidden");
      if (channel.archived_at !== null) return fail(c, 410, "Channel is archived.", "archived");
    }
    const repository = await c.env.DB.prepare("SELECT * FROM channel_repositories WHERE channel_slug = ? AND id = ?")
      .bind(slug, c.req.param("id") ?? "").first<RepositoryRow>();
    if (!repository) return fail(c, 404, "Repository binding not found.", "not_found");
    if (repository.is_private && channel.visibility !== "private") return fail(c, 403, "Private repository contents are available only in a private group.", "forbidden");
    return { ...granted, repository };
  }
  app.get(`${base}/snapshot`, route(async (c) => {
    const granted = await access(c); if (granted instanceof Response) return granted;
    const credential = granted.channel.visibility === "private" ? await deps.repositoryCredential(granted.repository, c.env) : undefined;
    return c.json(await getRepositorySnapshot(granted.repository.full_name, granted.repository.base_branch, credential));
  }));
  app.get(`${base}/file`, route(async (c) => {
    const granted = await access(c); if (granted instanceof Response) return granted;
    const ref = c.req.query("ref"); const path = c.req.query("path");
    if (!ref || !SHA.test(ref) || !path) return fail(c, 400, "A file path and exact 40-character commit SHA are required.");
    const credential = granted.channel.visibility === "private" ? await deps.repositoryCredential(granted.repository, c.env) : undefined;
    return c.json(await readRepositoryFile(granted.repository.full_name, ref, path, credential));
  }));
  app.get(`${base}/files`, route(async (c) => {
    const granted = await access(c); if (granted instanceof Response) return granted;
    const ref = c.req.query("ref");
    if (!ref || !SHA.test(ref)) return fail(c, 400, "An exact 40-character commit SHA is required.");
    const credential = granted.channel.visibility === "private" ? await deps.repositoryCredential(granted.repository, c.env) : undefined;
    return c.json(await listRepositoryFiles(granted.repository.full_name, ref, c.req.query("path") ?? "", credential));
  }));
  app.get(`${base}/proposals`, route(async (c) => {
    const granted = await access(c); if (granted instanceof Response) return granted;
    const rows = await c.env.DB.prepare("SELECT * FROM code_change_proposals WHERE channel_slug = ? AND repository_id = ? ORDER BY created_at DESC, id DESC LIMIT 50")
      .bind(granted.slug, granted.repository.id).all<ProposalRow>();
    return c.json({ proposals: rows.results.map(view) });
  }));
  app.get(`${base}/proposals/:proposalId`, route(async (c) => {
    const granted = await access(c); if (granted instanceof Response) return granted;
    const proposal = await load(c.env.DB, granted.slug, granted.repository.id, c.req.param("proposalId") ?? "");
    if (!proposal) return fail(c, 404, "Proposal not found.", "not_found");
    return c.json({ proposal: detail(proposal) });
  }));
  app.post(`${base}/proposals`, route(async (c) => {
    const granted = await access(c, "propose"); if (granted instanceof Response) return granted;
    const body = await json(c, ["request_id", "title", "description", "base_sha", "files"]);
    if (!body || typeof body.request_id !== "string" || !REQUEST_ID.test(body.request_id)
      || typeof body.base_sha !== "string" || !SHA.test(body.base_sha)
      || typeof body.title !== "string" || body.title.trim().length < 1 || body.title.length > 200 || /[\x00-\x1f\x7f]/.test(body.title)
      || (body.description !== undefined && (typeof body.description !== "string" || body.description.length > 20_000))) {
      return fail(c, 400, "Use a request ID, title, exact base commit SHA, and bounded text file changes.");
    }
    const files = validateChangeFiles(body.files);
    const title = body.title.trim(); const description = (body.description as string | undefined) ?? "";
    const digest = await sha256Hex(JSON.stringify({ repository_id: granted.repository.id, base_sha: body.base_sha, title, description, files }));
    const findDuplicate = () => c.env.DB.prepare("SELECT * FROM code_change_proposals WHERE repository_id = ? AND created_by_hash = ? AND request_id = ?")
      .bind(granted.repository.id, granted.identity.hash, body.request_id).first<ProposalRow>();
    const duplicate = await findDuplicate();
    if (duplicate) return duplicate.digest === digest ? c.json({ proposal: detail(duplicate), reused: true }) : fail(c, 409, "This request ID was already used for different changes.", "conflict");
    const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM code_change_proposals WHERE repository_id = ? AND state IN ('proposed','publishing','unknown')")
      .bind(granted.repository.id).first<{ n: number }>();
    if ((count?.n ?? 0) >= 50) return fail(c, 429, "Review or reject existing proposals before adding more.", "rate_limited");
    const credential = granted.channel.visibility === "private" ? await deps.repositoryCredential(granted.repository, c.env) : undefined;
    const snapshot = await getRepositorySnapshot(granted.repository.full_name, granted.repository.base_branch, credential);
    if (snapshot.commit_sha !== body.base_sha) return fail(c, 409, "The base branch changed. Read its new snapshot and prepare a new proposal.", "conflict");
    const originals: CodeChangeFile[] = [];
    // Bounded concurrency; every original comes from exactly the reviewed base SHA.
    for (let index = 0; index < files.length; index += 4) {
      originals.push(...await Promise.all(files.slice(index, index + 4).map(async (file): Promise<CodeChangeFile> => {
        try {
          const original = await readRepositoryFile(granted.repository.full_name, body.base_sha as string, file.path, credential);
          return { path: file.path, content: original.content };
        } catch (error) {
          if (error instanceof GitHubChangesError && error.code === "file_not_found") return { path: file.path, content: null };
          throw error;
        }
      })));
    }
    if (files.some((file, index) => file.content === originals[index]!.content)) return fail(c, 400, "Each proposed path must contain a real change; remove unchanged or already absent files.");
    if (new TextEncoder().encode(JSON.stringify(originals)).byteLength > 1_300_000) return fail(c, 413, "The original files exceed the supported review size. Split this proposal.");
    const now = Date.now(); const id = crypto.randomUUID();
    try {
      await c.env.DB.prepare(`INSERT INTO code_change_proposals
        (id,channel_slug,repository_id,request_id,created_by,created_by_hash,title,description,base_sha,base_branch,digest,files_json,originals_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id, granted.slug, granted.repository.id, body.request_id, granted.identity.name, granted.identity.hash,
          title, description, body.base_sha, granted.repository.base_branch, digest, JSON.stringify(files), JSON.stringify(originals), now, now).run();
    } catch (error) {
      if (/UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/.test(error instanceof Error ? error.message : "")) {
        const existing = await findDuplicate();
        if (existing?.digest === digest) return c.json({ proposal: detail(existing), reused: true });
        return fail(c, 409, "This request ID was already used for different changes.", "conflict");
      }
      throw error;
    }
    const saved = (await load(c.env.DB, granted.slug, granted.repository.id, id))!;
    // A notification is best-effort; the proposal itself is already durable and visible in the workspace.
    await Promise.resolve(deps.forward(c, `/api/channels/${encodeURIComponent(granted.slug)}/messages`, {
      method: "POST", body: JSON.stringify({ kind: "message", body: `Code proposal: ${title}\n${granted.repository.full_name} · ${files.length} file(s) · ${id}\nAwaiting the human owner's review in the collaboration workspace.`,
        mentions: [], reply_to: null, idempotency_key: `code-proposal:${id}` }),
    })).catch(() => undefined);
    return c.json({ proposal: detail(saved), reused: false }, 201);
  }));

  app.post(`${base}/proposals/:proposalId/reject`, route(async (c) => {
    const granted = await access(c, "manage"); if (granted instanceof Response) return granted;
    const body = await json(c, ["expected_digest"]);
    if (!body || typeof body.expected_digest !== "string" || !DIGEST.test(body.expected_digest)) return fail(c, 400, "The reviewed proposal digest is required.");
    const row = await load(c.env.DB, granted.slug, granted.repository.id, c.req.param("proposalId") ?? "");
    if (!row) return fail(c, 404, "Proposal not found.", "not_found");
    if (row.digest !== body.expected_digest) return fail(c, 409, "Reload and review this proposal before deciding.", "conflict");
    if (["published", "publishing", "unknown"].includes(row.state)) return fail(c, 409, "This proposal may already exist on GitHub. Resolve its publication before rejecting it.", "conflict");
    const updated = await c.env.DB.prepare("UPDATE code_change_proposals SET state = 'rejected', updated_at = ? WHERE id = ? AND state IN ('proposed','failed','rejected')")
      .bind(Date.now(), row.id).run();
    if (updated.meta.changes < 1) return fail(c, 409, "Proposal state changed. Reload before deciding.", "conflict");
    return c.json({ proposal: detail((await load(c.env.DB, granted.slug, granted.repository.id, row.id))!) });
  }));
  app.post(`${base}/proposals/:proposalId/publish`, route(async (c) => {
    const granted = await access(c, "manage"); if (granted instanceof Response) return granted;
    const body = await json(c, ["expected_digest", "credential"]);
    if (!body || typeof body.expected_digest !== "string" || !DIGEST.test(body.expected_digest) || !validCredential(body.credential)) return fail(c, 400, "A reviewed digest and a GitHub write credential for this one publication are required.");
    let row = await load(c.env.DB, granted.slug, granted.repository.id, c.req.param("proposalId") ?? "");
    if (!row) return fail(c, 404, "Proposal not found.", "not_found");
    if (row.digest !== body.expected_digest) return fail(c, 409, "Reload and review this proposal before approving it.", "conflict");
    if (row.state === "rejected") return fail(c, 409, "A rejected proposal cannot be published.", "conflict");
    if (row.state === "published") return c.json({ proposal: detail(row), reused: true });
    const now = Date.now(); const leaseToken = crypto.randomUUID();
    // Compare the exact pre-lock state as well as lease ownership. Otherwise a
    // stale 'proposed' read could erase a newer 'unknown' outcome on a failed retry.
    const locked = await c.env.DB.prepare(`UPDATE code_change_proposals SET state = 'publishing', approved_by = ?, approved_at = ?, lease_until = ?, lease_token = ?, error = NULL, updated_at = ?
      WHERE id = ? AND digest = ? AND state = ? AND lease_token IS ? AND lease_until = ? AND lease_until <= ?
        AND state IN ('proposed','failed','unknown','publishing')`)
      .bind(granted.identity.name, now, now + LEASE_MS, leaseToken, now, row.id, row.digest, row.state, row.lease_token, row.lease_until, now).run();
    if (locked.meta.changes < 1) return fail(c, 409, "This proposal is already being published. Reload its status before retrying.", "conflict");
    let savedPublication = false;
    try {
      const published = await publishChanges({
        fullName: granted.repository.full_name, baseBranch: row.base_branch, baseSha: row.base_sha,
        proposalId: row.id, title: row.title, description: row.description,
        files: JSON.parse(row.files_json), credential: body.credential as string,
      }, { timeoutMs: 30_000, beforeWrite: async () => {
        // A paused worker must stop issuing GitHub writes after its lease expires
        // or is taken over. Already in-flight HTTP writes remain uncertain.
        const checkedAt = Date.now();
        const held = await c.env.DB.prepare(`UPDATE code_change_proposals SET lease_until = ?
          WHERE id = ? AND lease_token = ? AND state = 'publishing' AND lease_until > ?`)
          .bind(checkedAt + LEASE_MS, row!.id, leaseToken, checkedAt).run();
        return held.meta.changes > 0;
      } });
      const saved = await c.env.DB.prepare("UPDATE code_change_proposals SET state = 'published', branch = ?, commit_sha = ?, pull_request_url = ?, pull_request_number = ?, error = NULL, updated_at = ? WHERE id = ? AND lease_token = ? AND state = 'publishing'")
        .bind(published.branch, published.commit_sha, published.html_url, published.number, Date.now(), row.id, leaseToken).run();
      savedPublication = saved.meta.changes > 0;
    } catch (error) {
      const uncertain = row.state === "unknown" || row.state === "publishing"
        || !(error instanceof GitHubChangesError) || error.outcomeUnknown;
      const message = error instanceof GitHubChangesError ? error.message : "Publication outcome is unknown. Retry this same proposal to check its dedicated branch and pull request.";
      await c.env.DB.prepare("UPDATE code_change_proposals SET state = ?, error = ?, updated_at = ? WHERE id = ? AND lease_token = ? AND state = 'publishing'")
        .bind(uncertain ? "unknown" : "failed", message, Date.now(), row.id, leaseToken).run();
    } finally {
      // The approval credential exists only in this request; never store, forward to agents, or echo it.
      body.credential = undefined;
      await c.env.DB.prepare("UPDATE code_change_proposals SET lease_until = 0, lease_token = NULL WHERE id = ? AND lease_token = ?").bind(row.id, leaseToken).run();
    }
    row = (await load(c.env.DB, granted.slug, granted.repository.id, row.id))!;
    if (savedPublication && row.state === "published") {
      await Promise.resolve(deps.forward(c, `/api/channels/${encodeURIComponent(granted.slug)}/messages`, {
        method: "POST", body: JSON.stringify({ kind: "message", body: `Code proposal published for review: ${row.title}\n${row.pull_request_url}\nBranch: ${row.branch}. The base branch has not been modified.`, mentions: [], reply_to: null, idempotency_key: `code-published:${row.id}` }),
      })).catch(() => undefined);
    }
    return c.json({ proposal: detail(row), reused: false });
  }));
}
