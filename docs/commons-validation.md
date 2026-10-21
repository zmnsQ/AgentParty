# Commons development-preview validation

## Current review branch: durable receipts and identity export (2026-10-21)

Based on `01866a7`, branch `fix/durable-receipts-export-20261021` preserves all
existing collaboration/security changes and adds the reliability work described
in [the review](commons-reliability.zh.md). The combined `check:commons` gate
exited **0**: **522 / 522 tests in 38 files**, no skipped cases (HTTP 53,
Worker 179, Web 175, CLI 111, configuration 4). Type checks, Vite production
build and migration numbering passed. A separate full Worker run also exited
**0**, with **1086 / 1086 tests in 131 files** and no skipped cases. Its cases
include the 179 Worker cases above. See the [machine-readable summary](validation/durable-receipts-2026-10-21.json).
The older totals below are historical.



## Historical merged validation: workspace isolation (2026-10-21)

The final merged `bun run check:commons` exited **0**: **463 / 463 tests passed
in 28 files**, no skipped cases. Counts: HTTP contracts **53**, local Worker /
D1 / DO / R2 **130**, Web **175**, CLI **101**, fork configuration **4**.
Shared / Worker / Web / CLI type checks, Vite production build and migration
numbering passed. Original license, attribution, lockfile and manual-only
workflows are unchanged. No native installer or live-provider certification.

All parallel branch changes through `b215c4b` were retained; the earlier 429-test
workspace pass was revalidated after integration, not substituted for it.
[Workspace review](commons-workspace-isolation-2026-10-21.zh.md) and
[machine-readable results](validation/workspace-isolation-2026-10-21.json)
explain the scope, negative controls and remaining boundaries. All other totals
below that section are **historical checkpoints**, not the latest test count.


> **Historical merged gate: 442 / 442 tests passed, 27 files, exit 0.**
> This retains the 423-test incoming branch and adds 19 further checks, including
> client-session isolation. Intermediate 400/408/423-test records below are historical.

Validation date: **2026-10-21 UTC**. This record separates executed checks from
implemented code and from release work that needs external accounts or native
operating systems. It is not a production-readiness or all-provider certification.

## Follow-up reliability review

The original **400-test** result below is the first-preview baseline, not the
current expanded gate. That same baseline was independently rerun on macOS
ARM64 (Node 24.11.1 / Bun 1.4.3) before this follow-up's changes. The follow-up
adds durable collaboration receipts, transactional concurrent-send checks,
and paginated identity-export recovery while retaining the concurrent branch's
cloud/GitHub lease fencing. Its exact
results, upgrade requirements and limits are recorded in
[the reliability review](commons-reliability.zh.md).

## Historical intermediate hardening — 423 tests (2026-10-21)

The follow-up [lease fencing and recovery audit](commons-hardening-2026-10-21.md)
ran on macOS arm64 / Node 24.11.1 / Bun 1.4.3: **423 tests passed** in the full
`check:commons` gate after preserving the eight parallel regression cases from
`4d0ea5e`. An initial merged attempt had three existing 1-second loopback timeouts;
the unchanged full command passed on rerun. Their root cause remains unresolved.
Eleven new Worker regression cases failed against the
pre-fix production code and passed with the fixes; four additional loopback
contracts cover publication-authority loss and deadlines. Migration `0048`
requires draining old requests before switching all writers to the new code.
No native app build, live provider certification or deployment is implied.

The **400-test Linux run below is the earlier baseline**, not the follow-up's
current test total. Its independent HTTP smoke was not rerun for this patch.

## Parallel hardening baseline (2026-10-21, commit 4d0ea5e)

The subsequent concurrency/revocation review ran the entire current gate on
macOS ARM64 (Node 24.11.1, Bun 1.4.3): **408 / 408 tests passed in 27 files**,
with no skipped tests and exit code 0. Worker coverage increased from 91 to 99;
the other layer counts are unchanged. Eight new deterministic regressions also
failed against the original implementation before the fixed code was restored.

See the [historical review and migration notes](commons-lease-review-2026-10-21.zh.md)
and [historical check summary](validation/hardening-leases-2026-10-21.json).
Migration `0048_collaboration_lease_fencing.sql` must be applied before the new
Worker is enabled; drain old handlers rather than mixing unfenced writers with
new ones. This adds request-owner fencing and purges saved credentials for
revoked connections. It does not establish permanent exactly-once messaging or
live-provider/native-desktop acceptance.

The original 400-test Linux run below is retained as the **initial preview's
historical validation**, not the latest gate count. Its independent HTTP smoke
was not rerun for this hardening pass.

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

At the first-preview commit, provider-request identity was durable in D1 but
final group-message deduplication was limited to **10 minutes**. The follow-up
replaces that limit for immutable collaboration operation UUIDs with a
principal-scoped durable receipt written in the message transaction. Ordinary
chat keys retain their original window. Identity/group erasure and already-pruned
pre-upgrade rows are explicit exclusions. This still does not claim permanent
end-to-end exactly-once provider execution or external notification delivery.
GitHub's separate REST operations also cannot atomically lock the target branch;
commits retain the exact approved parent and never update the base branch.

See the [development guide](commons-development.zh.md),
[provider contracts](provider-integration.md),
[GitHub publication design](github-collaboration.md) and
[roadmap](personal-agent-roadmap.zh.md) for setup and remaining milestones.


## Follow-up hardening validation after branch reconciliation — 2026-10-21

A second review ran on **macOS ARM64, Node 24.11.1, Bun 1.4.3**. The complete
`bun run check:commons` gate exited **0**: **442 / 442 tests in 27 files**, with
**42 new regression cases relative to the original 400-test preview**. This is a newly executed gate, not a reinterpretation
of the original Linux result above. No dependency or lockfile upgrade was made.

| Layer | Follow-up result |
| --- | --- |
| Provider / GitHub loopback HTTP contracts | 49 / 49 |
| Worker integration and authorization | 121 / 121 |
| Web / desktop-facing React UI | 167 / 167 |
| CLI and process isolation | 101 / 101 |
| Fork configuration | 4 / 4 |

Shared, Worker, Web and CLI type checks, Vite production build, migration numbering
and whitespace checks passed. The tests apply migration `0048_collaboration_lease_fencing.sql`.
The original standalone 14-check HTTP smoke was **not** rerun in this follow-up.

The new coverage exercises stale task outcomes, conditional lease release,
revocation during a provider request, saved-result/receipt failures, post-lock
state reload, superseded PR publishers, per-write publication authority, account
and group UI isolation, revoked access, and post-upload side effects after unmount.
An isolated old-baseline probe failed all three new publication-authority contract
cases and four of five session-isolation UI cases; the repaired full gate passed.

The existing large-bundle warning remains, alongside Node transform-types,
react-test-renderer deprecation and an attachment test body-decoding warning.
Native clients, real provider accounts and production deployment remain unverified;
no GitHub Actions job, release or paid cloud deployment was initiated.
The 10-minute message deduplication limitation above remains in effect.

See the [review and upgrade notes](commons-hardening-2026-10-21.zh.md) and
[machine-readable results](validation/hardening-2026-10-21.json).

The final merged gate retains all eight concurrent regression cases from incoming
commit `4d0ea5e2d340a0652b080e005a02e3d3d454f45a` and adds nineteen further cases.
The previous 408-test review is preserved in
[its historical report](commons-lease-review-2026-10-21.zh.md) and
[JSON record](validation/hardening-leases-2026-10-21.json), including its observed
intermittent loopback HTTP timeout. No force push or history rewrite was used.

The last incoming commit, `1fdb25d101b83f099c4d52b8e8576060b61a1cb6`,
was also merged without removing its test coverage. The combined totals are
49 contract + 121 Worker + 167 Web + 101 CLI + 4 configuration checks = **442**.
Authority loss or an unverified ownership lookup now conservatively retains
uncertainty even before this request writes, because a successor may have acted.
The incoming timeout/no-post tests remain present; two ownership-loss assertions
were updated to reflect this explicit conservative outcome contract.
