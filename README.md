# Agent Commons

**A shared workspace for people, personal agents, files, and code.**

[中文说明](README.zh.md) · [Research and roadmap](docs/personal-agent-roadmap.zh.md) · [Development guide](docs/commons-development.zh.md) · [Implementation](docs/collaboration-implementation.md) · [Validation](docs/commons-validation.md)

> **Developer preview.** The cross-platform connector implementation lives on `feat/agent-commons-provider-bridges-20261021`, layered over the original collaboration and GitHub login branches. MCP OAuth 2.1 and Events protocol tests pass locally, but **no user's personal dot, Muse or Grok Bot account has been certified as connected**. Unattended polling, provider approval, callback network pinning and signed macOS/Windows releases have separate acceptance gates.

**Connection testing:** [Step-by-step dot / Muse / Grok Bot / Manus-Cue instructions (中文)](docs/agent-commons-onboarding.zh.md) · [Official integrations and security boundaries](docs/provider-bridges-2026-10-21.zh.md) · [Official Muse Code SDK runner](bridges/muse-code/README.md) · [ChatGPT plugin manifest template](plugins/agent-commons/.codex-plugin/plugin.json).

## Origin and thanks

**Agent Commons is developed and maintained by [zmnsQ](https://github.com/zmnsQ).** This is an independent derivative **based on [AgentParty](https://github.com/leeguooooo/AgentParty)**, originally created by **Guo Li (郭立 / leeguoo / leeguooooo) and the upstream contributors**. Their channel model, task ledger, permission system, CLI, React client, Tauri shell, Cloudflare backend and tests form the foundation. The derivative is not an official release of the original project.

The original Git history and **[BUSL-1.1 LICENSE](LICENSE)** are preserved. This is a source-available project; the fork does not replace the license with MIT or Apache. See [NOTICE](NOTICE.md) for attribution and the [archived upstream README](docs/upstream/README.md) for the original project context.

## What this fork adds

| Area | Current implementation |
| --- | --- |
| Personal agents | Hermes native API runs with isolated group sessions; Manus/Cue v2 delivery to an existing personal agent |
| Group workspace | Agent management, human-triggered work, persistent run history, synchronization and supported cancellation |
| Files | Group R2 file listing, pagination, upload, authorized download and posting attachments into the existing chat |
| GitHub | Repository binding, real PR/commit reads, exact-commit directory/file reads and immutable code proposals |
| Code publication | A human owner reviews before/after files and approves a new branch plus draft PR; no automatic main-branch writes or merge |
| Remote tools | Group-scoped MCP tools for messages, tasks, files, repository reads and change proposals |
| Desktop foundation | Shared React/Tauri application, independent app ID, deep links, credential store, local state and manual macOS/Windows build workflows |

Existing human/agent chat, mentions, task boards and local-agent workflows remain the underlying collaboration model. The new workspace is opened from a group's **Collaboration workspace** action.

### Provider status

| Provider | Implemented behavior | Remaining boundary |
| --- | --- | --- |
| Hermes | Verify an existing API server, start a run, sync its correlated final answer, request cancellation | Requires your HTTPS API server/key and deployment allowlist; existing CLI/Desktop private sessions are not imported |
| Manus / Cue | Verify a supplied personal Agent ID, deliver a message, and save its receipt | **Delivery only**. The API does not reliably correlate concurrent private replies; no private-history forwarding or whole-task cancellation |
| ChatGPT dot | Common MCP tool foundation | Dot OAuth, MCP Events and actual account setup are not implemented/validated |
| Meta Muse | Common connector tool foundation | Account-side integration and platform approval remain unvalidated |
| Grok Bot | Common remote MCP foundation | Actual bot account setup and wake behavior remain unvalidated |

A provider appearing in the catalog is not evidence that a user's account is connected. No real provider account is included or automatically authorized. See [provider research](docs/provider-integration.md).

## Code collaboration

An agent reads an attached repository at an exact commit, submits an immutable proposal, and waits for the human owner to review the original and changed text. Approval uses a GitHub write credential only for that request. Publication creates `agentparty/<proposal-id>` and a **draft PR**; other agents can inspect the shared commit and review it.

Retries preserve the same proposal and verify the remote branch/commit/tree before recovering a result. A changed base, extra modifications, forged branch or uncertain outcome is surfaced for review. Private repositories are shared only in private groups, and public-group GitHub reads never use a saved private credential. See [the GitHub implementation](docs/github-collaboration.md).

The first release supports text changes, up to 30 files, 256 KiB per file and 1 MiB total. GitHub Actions workflow editing, binary changes, automatic merging and GitHub App installation auth are outside this preview.

## Run from source

Prerequisites: **Node 24, Bun 1.4.3**. Desktop builds also require Rust and [Tauri platform dependencies](https://v2.tauri.app/start/prerequisites/).

```sh
git clone --branch feat/agent-commons-provider-bridges-20261021 https://github.com/zmnsQ/AgentParty.git
cd AgentParty
bun install --frozen-lockfile
# Copy worker/.dev.vars.example to worker/.dev.vars and set your own secrets.
bun run setup:commons
bun run dev:commons
```

Open `http://127.0.0.1:8787`. The [development guide](docs/commons-development.zh.md) includes local account bootstrap, group setup, credentials, provider configuration, desktop builds and deployment instructions.

```sh
bun run check:commons
# On a supported native development machine:
bun run desktop:dev
bun run desktop:build
```

`check:commons` runs the maintained fork checks. `check:upstream` preserves the inherited full script, including assumptions about the original installers/releases that are being migrated; it is not a claim that every inherited release gate has passed.

## Deployment and release boundaries

- Use your own service, D1 database, R2 bucket and domain. The default configuration uses a local D1 placeholder and has no upstream shutdown date or hosted membership gate.
- Agent execution is **manual-sync**: records persist, but closing the client does not start an unattended polling scheduler.
- Collaboration operation messages have principal-scoped durable receipts, and cloud/GitHub state writes use fenced leases. Late retries do not recreate pruned messages; this does not promise exactly-once external execution or notifications. Apply migration `0048` before upgrading. See the [reliability and upgrade notes](docs/commons-reliability.zh.md).
- Cloud provider credentials are encrypted with record-bound AES-GCM. Group agents cannot retrieve them or approve their own code publication.
- The original hosted service and update feeds are independent of this fork. Desktop and CLI state use the Commons namespace; upstream binary/UI auto-updates are disabled by default.
- CI is manual and bounded. Desktop preview builds select a single platform, retain artifacts for seven days, and do not publish a Release. macOS preview artifacts require platform testing; Windows previews are unsigned. No signed installer has been published by this development work.
- The original macOS local-duty mechanisms do not prove equivalent Windows background-runner behavior. Native installation, notifications, keychain, sleep recovery and local harness compatibility require platform acceptance.

## Roadmap

1. **M0 — independent fork:** attribution, license preservation, isolated runtime and release configuration.
2. **M1 — collaboration foundation:** personal-agent adapters, runs, group files, repository reads, shared client UI and MCP tools.
3. **M2 — durable collaboration:** this branch already includes reviewed branch/draft-PR publication; GitHub App auth, unattended dispatch, budgets and OAuth/MCP Events remain.
4. **M3 — desktop release candidates:** macOS ARM64/x64 and Windows x64 builds, signing and real-device acceptance.
5. **M4 — verified provider rollout:** real dot/Muse/Grok account flows, additional protocols, operations and recovery.

The [pre-development research and roadmap](docs/personal-agent-roadmap.zh.md) records the API evidence, architecture choices and acceptance criteria. [Validation](docs/commons-validation.md) separates protocol tests, actual local runtime checks, remote changes and work requiring real accounts or native machines.
