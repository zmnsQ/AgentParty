# Agent Commons first-party installer; no administrator privileges or persistent PATH changes.
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
  Invoke-WebRequest -Uri ($Base.TrimEnd('/') + '/agentcommons.mjs?v=7f8721aadd103b720cc5b9d98b29729cedfc182b0759511823e4bf8464b9c115') -OutFile $File
  if ((Get-FileHash -Algorithm SHA256 $File).Hash.ToLowerInvariant() -ne '7f8721aadd103b720cc5b9d98b29729cedfc182b0759511823e4bf8464b9c115') { throw 'CLI checksum mismatch. Nothing installed.' }
  & $Node $File self-install
  if ($LASTEXITCODE -ne 0) { throw 'Agent Commons installation failed.' }
} finally { Remove-Item -LiteralPath $Tmp -Recurse -Force }
