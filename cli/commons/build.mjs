/** Reproducible first-party CLI distribution; no external package publish. */
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {VERSION} from './agentcommons.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const out=resolve(root,'web/public/cli');mkdirSync(out,{recursive:true});
const code=readFileSync(resolve(root,'cli/commons/agentcommons.mjs'));
const hash=createHash('sha256').update(code).digest('hex');
const manifest={product:'Agent Commons CLI',version:VERSION,sha256:hash,node: '>=22',author:'zmnsQ',source:'https://github.com/zmnsQ/AgentParty',license:'BUSL-1.1',upstream:'https://github.com/leeguooooo/AgentParty'};
writeFileSync(resolve(out,'agentcommons.mjs'),code);
writeFileSync(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(resolve(out,'install.sh'),`#!/bin/sh
# Agent Commons first-party installer; zmnsQ. No sudo; no shell startup file edits.
set -eu
BASE="\${AGENT_COMMONS_DOWNLOAD_BASE:-https://agentparty.402887.xyz/cli}"
case "$BASE" in https://*) ;; *) echo 'HTTPS download source required' >&2; exit 1;; esac
command -v node >/dev/null 2>&1 || { echo 'Install Node.js 22+ from nodejs.org, then run this installer again.' >&2; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' || { echo 'Node.js 22+ is required.' >&2; exit 1; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
curl --proto '=https' --tlsv1.2 --fail --show-error --silent --location --max-redirs 3 "$BASE/agentcommons.mjs?v=${hash}" -o "$TMP/agentcommons.mjs"
node --input-type=module - "$TMP/agentcommons.mjs" <<'VERIFY'
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
if(createHash('sha256').update(readFileSync(process.argv[2])).digest('hex')!=='${hash}')throw Error('CLI checksum mismatch. Nothing installed.');
VERIFY
node "$TMP/agentcommons.mjs" self-install
`);
writeFileSync(resolve(out,'install.ps1'),`# Agent Commons first-party installer; no administrator privileges or persistent PATH changes.
$ErrorActionPreference = 'Stop'
$Base = if ($env:AGENT_COMMONS_DOWNLOAD_BASE) { $env:AGENT_COMMONS_DOWNLOAD_BASE } else { 'https://agentparty.402887.xyz/cli' }
if (-not $Base.StartsWith('https://')) { throw 'HTTPS download source required' }
$Node = (Get-Command node -ErrorAction Stop).Source
& $Node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'
if ($LASTEXITCODE -ne 0) { throw 'Install Node.js 22+ from nodejs.org first.' }
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ('agentcommons-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  $File = Join-Path $Tmp 'agentcommons.mjs'
  Invoke-WebRequest -Uri ($Base.TrimEnd('/') + '/agentcommons.mjs?v=${hash}') -OutFile $File
  if ((Get-FileHash -Algorithm SHA256 $File).Hash.ToLowerInvariant() -ne '${hash}') { throw 'CLI checksum mismatch. Nothing installed.' }
  & $Node $File self-install
  if ($LASTEXITCODE -ne 0) { throw 'Agent Commons installation failed.' }
} finally { Remove-Item -LiteralPath $Tmp -Recurse -Force }
`);
for(const name of ['LICENSE','NOTICE.md'])writeFileSync(resolve(out,name),readFileSync(resolve(root,name)));
console.log('Agent Commons CLI',VERSION,hash);

const guide=readFileSync(resolve(root,'docs/agentcommons-cli.zh.md'),'utf8');
const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
writeFileSync(resolve(out,'guide.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent Commons CLI 安装与配置</title><style>body{max-width:900px;margin:40px auto;padding:0 20px;font:16px/1.85 system-ui;background:#faf9f6;color:#292824}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}a{color:#9b4a30}</style><h1>Agent Commons CLI</h1><a href="/">返回网站</a><pre>${esc(guide)}</pre></html>`);

// Root entry points use exactly the same pinned first-party payload.
for(const file of ["install.sh","install.ps1"])writeFileSync(resolve(root,file),readFileSync(resolve(out,file)));
