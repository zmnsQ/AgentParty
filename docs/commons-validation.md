# Commons development-preview validation

Validation date: **2026-10-21 UTC**. This record separates executed checks from
implemented code and from release work that needs external accounts or native
operating systems. It is not a production-readiness or all-provider certification.

## Follow-up hardening (2026-10-21)

The follow-up [lease fencing and recovery audit](commons-hardening-2026-10-21.md)
ran on macOS arm64 / Node 24.11.1 / Bun 1.4.3: **415 tests passed** in the full
`check:commons` gate. Eleven new Worker regression cases failed against the
pre-fix production code and passed with the fixes; four additional loopback
contracts cover publication-authority loss and deadlines. Migration `0048`
requires draining old requests before switching all writers to the new code.
No native app build, live provider certification or deployment is implied.

The **400-test Linux run below is the earlier baseline**, not the follow-up's
current test total. Its independent HTTP smoke was not rerun for this patch.

## Source and sequence

- Upstream baseline: `leeguooooo/AgentParty@25384eca99b24ed823ab54b4e850a0c9079a3b24`.
- Fork: [zmnsQ/AgentParty](https://github.com/zmnsQ/AgentParty).
- Work branch: `feat/personal-agent-collaboration`.
- Research and development plan were committed **before implementation** in
  [`4ddb272b2dc63ff4022a61734e3ecda6564ebafb`](https://github.com/zmnsQ/AgentParty/commit/4ddb272b2dc63ff4022a61734e3ecda6564ebafb).
- The original `LICENSE` is byte-for-byte unchanged. Original READMEs,
  installers and release workflows are preserved under `docs/upstream*`.

## Reproducible final gate

Environment: Linux, Node **24.19.0**, Bun **1.4.3**, installed dependencies from
the existing frozen lockfile. Run from the repository root:

```sh
bun install --frozen-lockfile
bun run check:commons
git diff --check --find-copies-harder HEAD
```

The final combined `check:commons` invocation exited **0**. All **400 tests in
27 files passed**; no tests in this gate were skipped.

| Layer | Executed result | What it establishes |
| --- | --- | --- |
| Provider and GitHub HTTP contracts | 42 / 42 in 2 files | Actual loopback HTTP requests with synthetic credentials: provider identity/session boundaries, bounded responses, redirect rejection, cancellation and unknown outcomes; exact Git objects, new branch/draft PR writes and recovery |
| Worker integration and authorization | 91 / 91 in 6 files | Requests through the Worker using local D1, R2 and Durable Objects: encryption, cloud runs, real group-message forwarding, files, MCP, proposals, human approval and channel scopes |
| Web and desktop-facing UI | 162 / 162 in 13 files | Cloud connections, retained runs, file-post retry, proposal review, one-time write credentials, server profiles, invitation/deep links, disabled inherited updates and honest install messaging |
| CLI and process isolation | 101 / 101 in 5 files | Independent configuration, opt-in upgrades, version handling and local runner/self-bootout behavior |
| Fork configuration | 4 / 4 in 1 file | Independent resource defaults and desktop identity, manual bounded workflows, retained license and attribution |
| TypeScript | Shared, Worker, Web and CLI checks passed | Static cross-package contract compatibility |
| Production web build | Vite build passed | Production assets are generated; Commons is lazy-loaded |
| Migration numbering | Passed | New migrations 0046 and 0047 are unique; the checker retains two pre-existing duplicate-number exceptions |
| Whitespace and license preservation | Passed | Staged diff checked with copy detection (preserving original archived CRLF bytes); no changes to `LICENSE` |

The Worker integration tests replace only external provider/GitHub responses;
they do not replace D1, R2 or the normal authorization/message path with UI
mock state. The contract suites use a real local HTTP server, documented
response shapes and real Git object hashes. They do **not** use a personal
provider account or write a live GitHub repository.

The existing main Web bundle still produces Vite's warning for a minified
chunk over 500 kB. The Commons lazy chunk is about 35.7 kB (8.6 kB gzip).
The workerd test process also emitted WebSocket teardown diagnostics while
the assertions and process exit succeeded. Neither message is represented
as a release-quality performance or runtime guarantee.

`check:upstream` retains the historical full upstream gate. It includes old
installer, release-workflow and branding expectations that need migration;
it was **not** claimed as passing this fork. The new gate intentionally covers
the changed collaboration, permission and fork-isolation behavior.

## Independent live local HTTP smoke

A second check started an actual Wrangler **4.147.0** service at
`127.0.0.1:8791`, with a fresh temporary data directory and synthetic secrets.
It used the built web assets and applied **all 49 migration files**, including
`0046_collaboration.sql` and `0047_code_proposals.sql`. This check did not use
Vitest or browser login cookies. The service was stopped normally afterward.

**14 core checks passed:**

1. Health endpoint and the built page returned 200; the page title is
   `AgentParty Commons`.
2. Token creation without the administrator secret returned 401.
3. An authorized administrator created a human token (201).
4. The new human token authenticated successfully (200).
5. Two private groups were created (201).
6. The collaboration summary returned five provider definitions, no invented
   live connections, `manual-sync`, and the owner's correct permissions.
7. A 68-byte file was uploaded to R2 and appeared in the group file list.
8. Posting its attachment twice with the same idempotency key returned the
   same group-message sequence number.
9. Authenticated and signed-link downloads matched the exact original bytes;
   an ordinary unauthenticated download returned 401.
10. A dedicated group Agent initialized MCP `2025-06-18`, received the
    initialized-notification acknowledgment, and discovered **16 tools**.
11. The MCP message tool read the real group message and its attachment.
12. That Agent's requests to another group's collaboration, files, messages
    and MCP endpoints all returned 403.
13. A human token calling the Agent MCP endpoint and an outsider reading the
    private group were denied (403).
14. The documented `bun --env-file=… cli/src/index.ts token create …` bootstrap
    command exited 0 and its new human token authenticated.

The optional **15th check was blocked**, not passed: binding the public
`zmnsQ/AgentParty` repository returned 502 because the local workerd process
could not resolve `api.github.com` (`getaddrinfo: Temporary failure in name
resolution`). No real GitHub snapshot/PR read or publication is claimed by
this smoke. Contract and Worker integration coverage remain separate evidence.

The sanitized machine-readable results are saved in
[`validation/local-http-smoke.json`](validation/local-http-smoke.json).

## Findings fixed before the final gate

- A group-scoped Agent credential now has a hard scope boundary even when
  another group is public; channel listing and invitation shortcuts obey it.
- Public-watch nonmembers cannot upload files. Private repositories require
  private groups; changing such a group to public is blocked. Public-group
  GitHub reads always omit credentials, including after a repository becomes
  private remotely.
- Cloudflare fetch rejects `redirect: "error"`. All new external adapters use
  manual mode and explicitly reject every redirect, without forwarding secrets.
- An inaccessible GitHub blob/object cannot be presented to a reviewer as a
  nonexistent original file. Only absence in a verified complete tree proves
  a new file.
- An uncertain publication remains uncertain across credential or read
  failures. Its repository binding cannot be removed, including after an
  expired publication lease, until the outcome is resolved.
- Recovery verifies complete tree changes and can recover a closed PR even
  when its branch has been deleted, without recreating that branch.
- A completed provider result whose group post failed remains recoverable
  without starting another paid provider run.

## Explicitly unverified or unfinished

| Item | Current boundary / next acceptance |
| --- | --- |
| Hermes personal account | Protocol implementation and fixtures passed; needs the owner's real API Server, HTTPS allowlist and credentials |
| Manus / Cue personal account | Message submission only (`submitted`); no claim of request-correlated private replies or whole-task cancellation |
| dot / Muse / Grok | Scoped MCP tools are implemented; brand account setup, OAuth, Events/subscriptions and platform approval are unfinished |
| Background operation | Manual human run and sync; no durable dispatcher, budgets or unattended automatic wakeup |
| Real GitHub application flow | Contracts and local Worker approval flow passed; live target-repository token permissions, rulesets and deployed UI publication still need acceptance |
| macOS / Windows native apps | Tauri identity/configuration and manual build workflow are prepared; no Rust compilation, native platform build, installer execution or system-level UI test ran in this Linux environment |
| Signed desktop distribution | No signed/notarized release or updater feed is published; macOS workflow is ad hoc, Windows unsigned |
| Windows local resident runners | Inherited launchd functionality is macOS-specific; Windows lifecycle, sleep/resume, notifications and keyring need platform validation |
| Existing Claude Marketplace integration | Legacy plugin compatibility requires separate acceptance; changing the CLI directory does not certify every inherited plugin |
| Production cloud deployment | No paid cloud resources, domain, production secrets or remote database migrations were created |
| GitHub Actions | New workflows are dispatch-only and bounded; no remote workflow was dispatched for these results |

Provider-request idempotency is durable in D1. Final group-message delivery
still uses the upstream DO's **10-minute deduplication window**: a crash after
posting but before saving the receipt, followed by a retry after that window,
can duplicate the final post. This release does not claim permanent
exactly-once group delivery. GitHub's separate REST operations also cannot
atomically lock the target branch; commits retain the exact approved parent
and never update the base branch.

See the [development guide](commons-development.zh.md),
[provider contracts](provider-integration.md),
[GitHub publication design](github-collaboration.md) and
[roadmap](personal-agent-roadmap.zh.md) for setup and remaining milestones.
