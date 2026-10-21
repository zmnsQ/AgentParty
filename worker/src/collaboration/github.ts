import type { RepositoryCommit, RepositoryPullRequest } from "@agentparty/shared/collaboration";

export class GitHubReadError extends Error {
  constructor(message: string, readonly status = 502) { super(message); this.name = "GitHubReadError"; }
}
export function validRepositoryName(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(value)
    && !value.split("/").some((part) => part === "." || part === "..");
}
export function validBranch(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 250
    && !/[\x00-\x20\x7f~^:?*\[\\]/.test(value) && !value.includes("..") && !value.includes("@{")
    && !value.startsWith("/") && !value.endsWith("/") && !value.endsWith(".") && !value.endsWith(".lock")
    && !value.includes("//") && value !== "@" && !value.startsWith("-");
}
export function validCredential(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 8192 && !/[\x00-\x20\x7f]/.test(value);
}
function record(value: unknown): value is Record<string, any> { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** Read-only, fixed-origin API. Never follow redirects with credentials. */
async function read(path: string, credential?: string): Promise<unknown> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json", "user-agent": "AgentParty-Commons",
      "x-github-api-version": "2022-11-28",
      ...(credential ? { authorization: `Bearer ${credential}` } : {}),
    },
    // workerd supports manual/follow, not the browser/Node-only "error" mode.
    // Every 3xx is rejected below before any redirected credential-bearing call.
    redirect: "manual", signal: AbortSignal.timeout(15_000),
  }).catch(() => { throw new GitHubReadError("GitHub could not be reached. No repository changes were made."); });
  if (response.status === 404) throw new GitHubReadError("Repository or branch is not accessible with this credential.", 404);
  if (response.status === 401 || response.status === 403) throw new GitHubReadError("GitHub denied the read request; check repository access and API rate limits.", 403);
  if (!response.ok) throw new GitHubReadError("GitHub could not complete the read request.");
  if (!response.body || !response.headers.get("content-type")?.toLowerCase().match(/^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/)) {
    throw new GitHubReadError("GitHub returned an invalid response.");
  }
  // Limit actual bytes while streaming, before allocating a complete response.
  const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let bytes = 0; let text = "";
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 2_000_000) throw new GitHubReadError("GitHub response exceeds the supported size.");
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof GitHubReadError) throw error;
    throw new GitHubReadError("GitHub returned an invalid response.");
  } finally { void reader.cancel().catch(() => undefined); }
}
function repoPath(fullName: string): string {
  if (!validRepositoryName(fullName)) throw new GitHubReadError("Use a GitHub repository in owner/name format.", 400);
  return `/repos/${fullName.split("/").map(encodeURIComponent).join("/")}`;
}
export async function inspectRepository(fullName: string, branch?: string, credential?: string): Promise<{ fullName: string; baseBranch: string; isPrivate: boolean }> {
  const path = repoPath(fullName);
  const metadata = await read(path, credential);
  if (!record(metadata) || !validRepositoryName(metadata.full_name) || !validBranch(metadata.default_branch)
    || metadata.full_name.toLowerCase() !== fullName.toLowerCase() || typeof metadata.private !== "boolean") {
    throw new GitHubReadError("GitHub returned incomplete repository metadata.");
  }
  // A redirect to a renamed repository is intentionally not followed; rebind its new canonical name.
  const baseBranch = branch ?? metadata.default_branch;
  if (!validBranch(baseBranch)) throw new GitHubReadError("Invalid base branch.", 400);
  const branchMetadata = await read(`${path}/branches/${encodeURIComponent(baseBranch)}`, credential);
  if (!record(branchMetadata) || branchMetadata.name !== baseBranch) throw new GitHubReadError("GitHub returned incomplete branch metadata.");
  return { fullName: metadata.full_name, baseBranch, isPrivate: metadata.private === true };
}
export async function listPullRequests(fullName: string, credential?: string): Promise<RepositoryPullRequest[]> {
  const data = await read(`${repoPath(fullName)}/pulls?state=open&sort=updated&direction=desc&per_page=30`, credential);
  if (!Array.isArray(data)) throw new GitHubReadError("GitHub returned an invalid pull-request list.");
  return data.filter(record).map((pull): RepositoryPullRequest => ({
    number: Number(pull.number), title: String(pull.title ?? ""),
    html_url: `https://github.com/${fullName}/pull/${Number(pull.number)}`,
    state: pull.state === "closed" ? "closed" : "open", draft: pull.draft === true,
    author: String(pull.user?.login ?? ""), head_branch: String(pull.head?.ref ?? ""),
    base_branch: String(pull.base?.ref ?? ""), updated_at: String(pull.updated_at ?? ""),
  })).filter((pull) => Number.isSafeInteger(pull.number) && pull.number > 0);
}
export async function listRepositoryCommits(fullName: string, branch: string, credential?: string): Promise<RepositoryCommit[]> {
  const data = await read(`${repoPath(fullName)}/commits?sha=${encodeURIComponent(branch)}&per_page=30`, credential);
  if (!Array.isArray(data)) throw new GitHubReadError("GitHub returned an invalid commit list.");
  return data.filter(record).filter((commit) => typeof commit.sha === "string" && /^[a-f0-9]{40}$/.test(commit.sha)).map((commit) => ({
    sha: commit.sha, html_url: `https://github.com/${fullName}/commit/${commit.sha}`,
    message: String(commit.commit?.message ?? ""), author: String(commit.author?.login ?? commit.commit?.author?.name ?? ""),
    date: typeof commit.commit?.author?.date === "string" ? commit.commit.author.date : null,
  }));
}
