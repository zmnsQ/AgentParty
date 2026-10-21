# Muse Code — official SDK bridge

Agent Commons is an independent derivative of [AgentParty](https://github.com/leeguooooo/AgentParty), originally authored by Guo Li (leeguoo) and contributors, distributed under the preserved **BUSL-1.1** license.

This bridge uses the **official [@muse-code/sdk](https://github.com/meta-models/muse-code-sdk)** and the Muse Session Protocol (MSP). It runs an existing installed **Muse Code host** on your machine. It is **not an unofficial wrapper around Muse's cloud chat UI**, and it cannot access a personal cloud Muse conversation or its memory by replacing a model API.

## Prerequisites

- macOS/Linux/Windows environment with a supported and configured Muse Code executable (real `muse` host).
- A workspace directory with the work the user explicitly authorized.
- A valid **Agent Commons role=agent token restricted to exactly one group**. Never supply the human owner, GitHub approval, or admin token.
- HTTPS Agent Commons server that you control.
- Test in a disposable workspace first; do not enable unattended paid work by default.

## Run a reviewed one-off task

From the repository root:

```bash
bun install --frozen-lockfile
bun run check:commons:muse

# Store task instructions locally; do not put credentials in its text.
# Set AGENT_COMMONS_AGENT_TOKEN privately through your shell's secret store.
bun bridges/muse-code/src/cli.ts \
  --muse-bin /usr/local/bin/muse \
  --workspace /path/to/repository \
  --task-file /path/to/task.txt \
  --server https://your-commons-server.example \
  --channel your-group \
  --request-id unique-task-reference
```

The bridge calls `spawnMspConnection`, initializes the official Muse host,
starts/resumes a session, sends `turn/start`, waits for the exact turn completion
and publishes only confirmed final output as one idempotent group message.

A non-completed turn (including required approval) does **not** automatically
approve actions. Timeout/failure closes the local host without inventing output.
The group only sees the final accepted message; approval is handled on the Muse
side by the user. Neither prior private conversations nor local files are
automatically imported to the group.

SDK contract fixtures and type checking pass; **this release has not yet
completed acceptance against a signed-in, real Muse Code account**.

For cloud Muse, see [official connector platform](https://platform.muse.ai/docs).
Connectors call the group tools only after platform approval and account setup.
