# Installs Geld Nightly for the browser profiles you pick: irm https://www.geld.sh/nightly.ps1 | iex
# It downloads the installer from Geld's latest GitHub release, checks it against the SHA-256 published
# beside it, and runs it with Node.js.
$ErrorActionPreference = 'Stop'
$base = 'https://github.com/brandonmcconnell/geld/releases/latest/download'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Geld's installer needs Node.js 20 or newer: https://nodejs.org" -ForegroundColor Red
  return
}
$major = [int](node -p 'process.versions.node.split(".")[0]')
if ($major -lt 20) {
  Write-Host "Geld's installer needs Node.js 20 or newer. This is $(node -v)." -ForegroundColor Red
  return
}

$dir = Join-Path ([IO.Path]::GetTempPath()) ('geld-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $dir | Out-Null
try {
  $file = Join-Path $dir 'geld-nightly.mjs'
  Invoke-WebRequest "$base/geld-nightly.mjs" -OutFile $file -UseBasicParsing
  Invoke-WebRequest "$base/geld-nightly.mjs.sha256" -OutFile "$file.sha256" -UseBasicParsing
  $expected = ((Get-Content "$file.sha256" -Raw) -split '\s+')[0].ToLower()
  $actual = (Get-FileHash $file -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) {
    Write-Host 'The installer does not match its published checksum, so it was not run.' -ForegroundColor Red
    return
  }
  node $file @args
} finally {
  Remove-Item -Recurse -Force $dir
}
