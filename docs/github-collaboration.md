# GitHub code proposals and draft publication

Implementation: `worker/src/collaboration/github-changes.ts`.
Official REST contract reviewed on **2026-10-21**.

The group can read an exact repository snapshot and submit proposed file changes.
Publication creates a new `agentparty/<proposalId>` branch and a draft pull
request for review. The adapter has no operation to update an existing ref,
force push, merge a PR, delete a branch, or write the base branch.

## Backend contract

```ts
interface GitHubChangesOptions {
  fetch?: typeof fetch;
  timeoutMs?: number; // whole operation; default 30,000, maximum 120,000
}

interface GitHubChangeFile {
  path: string;
  content: string | null; // null deletes an existing regular file
}

getRepositorySnapshot(fullName, baseBranch, credential?, options?)
  // => { commit_sha, tree_sha }

readRepositoryFile(fullName, commitSha, path, credential?, options?)
  // => { path, content, encoding: "utf-8", blob_sha, commit_sha }

listRepositoryFiles(fullName, commitSha, path = "", credential?, options?)
  // => { commit_sha, path, entries: [{ name, path, type, sha, mode }], truncated }

validateChangeFiles(files: unknown)
  // => GitHubChangeFile[], copied and sorted by path

publishChanges({
  fullName, baseBranch, baseSha, proposalId,
  title, description, files, credential
}, options?)
  // => { branch, commit_sha, html_url, number }
```

Types are exported as `RepositorySnapshot`, `RepositoryFile`, `RepositoryDirectory`, `RepositoryDirectoryEntry`,
`GitHubChangeFile`, `PublishChangesInput`, and `PublishedChanges`.

Errors are instances of `GitHubChangesError` with a safe `message`, `code`,
HTTP `status`, and `outcomeUnknown`. The backend may return these fields without
returning a raw GitHub body, exception cause, credential, title, description or
file content. `outcomeUnknown: true` means at least one remote write was
attempted during the operation; it does not claim that nothing was created.
Only `file_not_found` proves that a path is absent from a complete Git tree at
the exact commit. Generic `not_found` includes inaccessible commit/tree/blob
objects and must fail review creation, never be saved as an absent original.

The caller owns room authorization, repository bindings, durable immutable
proposal records, approval, concurrency and audit records. Only an authorized
human group owner should call publication. Agent tools may read and submit
proposals under their channel scopes; they must not receive the owner's write
credential. Keep the approved repository, base branch, base SHA, proposal ID,
title, description and files unchanged when retrying.

Credentials are used only inside the function invocation and are not included
in the returned result or recorded by this module. Public reads can omit a
credential. Private reads need repository Contents access. Publication needs
repository Contents write and Pull requests write permissions. Restrict the
credential to the intended repository; this adapter does not request workflow
permissions.

## Input boundaries

| Input | Limit or behavior |
| --- | --- |
| Files | 1–30 entries |
| File content | Valid UTF-8 text, at most 256 KiB per file |
| All contents | At most 1 MiB of UTF-8 bytes |
| Deletion | `content: null`; the path must exist as a regular file at the approved base |
| Path | At most 300 characters; relative repository path |
| Proposal ID | 1–120 ASCII letters, digits, `_` or `-`; starts with a letter or digit |
| Title | Nonempty, one line; REST/MCP creation allows at most 200 characters, the underlying adapter at most 256 |
| Description | At most 20,000 characters |
| SHA | A complete lowercase 40-character Git SHA-1 |
| Original review snapshot | Serialized `originals_json` is at most 1,300,000 bytes; larger original contents require smaller proposals, even when the new content fits the 1 MiB limit |

Validation rejects traversal, absolute paths, backslashes, control characters,
`.git` components, `.github/workflows` paths, repeated paths and a file colliding
with one of its own descendants. Proposal path duplicates are checked without
case and after NFC normalization. Windows reserved characters/device names and
components ending in spaces or dots are also rejected. The returned paths
retain their exact spelling; file contents are not reformatted. Invalid Unicode
surrogates and NUL bytes are rejected.

Edits preserve the original executable mode (`100755`) or regular mode
(`100644`); new files use `100644`. Directories, symlinks and submodules cannot
be replaced or traversed as files. Blob reads follow the Git object hierarchy
at the supplied commit and verify the returned content's size, UTF-8 decoding
and Git blob SHA. Reading never follows a repository symlink to another path.
Directory discovery returns one level with at most 500 entries and a truncation
flag. It exposes symlink/submodule metadata without following those objects or
fetching blobs. A truncated discovery list cannot establish that a file is
absent; exact file reads and publication still require complete tree listings.

## Publication and recovery

1. Validate and copy the immutable proposal. Read the exact base commit and
   relevant directory trees. Verify existing file types and deletion targets.
2. Compute the expected UTF-8 blob hashes and a SHA-256 manifest covering all
   proposal fields. A no-op proposal is rejected.
3. Look up the deterministic proposal branch. If it already exists, validate
   its single parent against `baseSha`, its exact commit message/manifest, and
   its actual tree against the approved file changes.
   If the branch is gone but a matching PR exists, verify that PR's original
   head commit and recover it without recreating a deleted branch.
4. For a new branch, check that the current base ref still equals `baseSha`.
   Create a tree using that commit's `base_tree`, then a commit whose only
   parent is `baseSha`. Recheck the base ref and create the new proposal ref.
5. Find an existing pull request for the exact head across **all** PR states,
   including closed PRs. A matching PR is returned without another write.
   Conflicting base/head/manifest metadata fails with 409.
6. If no PR exists, recheck the base and proposal refs, then create a PR with
   `draft: true`. Return a locally constructed GitHub PR URL and the confirmed
   proposal commit SHA.

Recovery does not trust a branch name or commit marker alone. The adapter walks
the changed directories and compares complete before/after listings. Every
requested content hash and mode must match; all unrelated entries and subtrees
must retain their original identities. A hidden extra change, different parent,
modified proposal, changed executable bit, or truncated tree response is
rejected. It never overwrites or cleans up a conflicting ref.

A lost create-ref or create-PR response can be recovered by retrying the **same
immutable proposal**. Existing valid objects and the matching PR are reused.
Do not mint a new proposal ID to bypass a conflict or uncertain response. Failed
attempts before ref creation may leave unreachable Git tree/commit objects;
these are not published branches, and the adapter does not delete anything.

An unknown outcome remains unknown across failed recovery reads. While a
proposal is publishing or unknown, Commons blocks rejection and
repository-binding removal, including when a publication lease has expired.
Recovery can still require maintainer investigation when the base or proposal
branch has changed. This preview has no "confirm not published" reset action;
do not bypass the uncertainty by creating a new proposal ID.

If the base advances before a required publication write, the operation returns
409 for human review. A read-only retry may return an already verified PR after
its base branch has advanced. Existing closed or ready-for-review PRs are
returned as existing results; retry does not reopen them or change their draft
state. **GitHub's separate REST calls are not an atomic base-ref transaction.**
The base can move after a check. The created commit still has the exact approved
parent, and the adapter never writes that base ref; review the PR against its
current target branch before merging.

## Publication lease fencing

Migration `0048` adds a random token to each publication claim. Acquisition
compares the prior state, proposal digest, and prior lease token/deadline; every completion,
error and release compares the acquired token. A late publisher cannot replace
a newer confirmed `published` state with `unknown`, clear a successor's active
lease, or emit an additional publication notice after losing ownership. The
existing exact-tree/parent/PR recovery rules remain in force; tokens do not make
separate GitHub REST writes transactional.

Proposal and publication notices use `code-proposal:<UUID>` and
`code-published:<UUID>` receipts in the group DO. Receipt scope includes the
authenticated sender's name, kind and owner. It does not deduplicate independent
senders globally, nor repair a notification that was never committed. Identity
erasure ends this receipt history. Group insertion and receipt metadata commit
atomically, but remote notifications and their acknowledgements do not.

## Transport and resource limits

All URLs are constructed beneath `https://api.github.com/repos/<owner>/<repo>`.
No user-controlled endpoint or response URL is fetched. The API version header
is `2022-11-28`. Authentication uses a Bearer header only.

The runtime is Cloudflare Workers. Its fetch implementation accepts
`redirect: "manual"` and `"follow"`, but rejects `"error"`; this module uses
**manual mode plus explicit rejection of every 3xx response**. Location headers
are never followed and credentials are never forwarded to redirect targets.

A single operation deadline covers every request, response-body read and
verification step. Each JSON response is streamed with a 2 MiB cap. Directory
trees must be complete, non-recursive responses with no more than 20,000
entries; the operation makes at most 200 HTTP requests. Oversized repositories
or deep proposals may require smaller separately reviewed proposals, a higher
timeout within the configured maximum, or a more capable execution service.
Platform subrequest limits can be lower than this adapter's own cap.

There are no automatic write retries. Network failures and interrupted writes
return typed, scrubbed errors. A timeout also aborts outstanding fetches; no
later step starts a new write after that deadline.

## Validation

Run the local HTTP contract suite on Node 24:

```sh
node --experimental-transform-types --test worker/test/github-changes.contract.mjs
```

The fixture uses documented Git Data and Pull Request response shapes, actual
Git blob/tree object hashes, a loopback HTTP server and a synthetic token.
Injected fetch maps only the validated fixed GitHub origin to that server.
The suite verifies exact snapshot reads, UTF-8 and blob integrity, input limits,
preserved executable modes, new branch/draft PR publication, lost-response
recovery, closed-PR deduplication, base movement, forged branches, hidden changes,
timeouts, redirects and error redaction. No real repository or personal account
is written during these tests.

The filename deliberately differs from workerd's test glob: this suite requires
a local TCP listener. Actual-account permissions, GitHub repository rulesets
and a complete deployed UI approval flow remain separate integration checks.

## Official sources

- [Git trees: create from a base tree, inline content and null-SHA deletion](https://docs.github.com/en/rest/git/trees?apiVersion=2022-11-28)
- [Git commits: explicit tree and parent commits](https://docs.github.com/en/rest/git/commits?apiVersion=2022-11-28)
- [Git references: exact ref lookup and create-reference operation](https://docs.github.com/en/rest/git/refs?apiVersion=2022-11-28)
- [Git blobs: content encoding and blob objects](https://docs.github.com/en/rest/git/blobs?apiVersion=2022-11-28)
- [Pull requests: head filtering, all states and draft creation](https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28)
