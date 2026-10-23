#!/bin/sh
# Agent Commons first-party installer; zmnsQ. No sudo; no shell startup file edits.
set -eu
BASE="${AGENT_COMMONS_DOWNLOAD_BASE:-https://agentparty.402887.xyz/cli}"
case "$BASE" in https://*) ;; *) echo 'HTTPS download source required' >&2; exit 1;; esac
command -v node >/dev/null 2>&1 || { echo 'Install Node.js 22+ from nodejs.org, then run this installer again.' >&2; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' || { echo 'Node.js 22+ is required.' >&2; exit 1; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
curl --proto '=https' --tlsv1.2 --fail --show-error --silent --location --max-redirs 3 "$BASE/agentcommons.mjs?v=d2bc730d9d5fa12c92bcfb8758f79e553b78bebba2bd1a8e1ec50ef962b7bf53" -o "$TMP/agentcommons.mjs"
node --input-type=module - "$TMP/agentcommons.mjs" <<'VERIFY'
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
if(createHash('sha256').update(readFileSync(process.argv[2])).digest('hex')!=='d2bc730d9d5fa12c92bcfb8758f79e553b78bebba2bd1a8e1ec50ef962b7bf53')throw Error('CLI checksum mismatch. Nothing installed.');
VERIFY
node "$TMP/agentcommons.mjs" self-install
