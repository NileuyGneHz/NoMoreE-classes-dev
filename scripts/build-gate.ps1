# Build site_gate.exe (Windows x64) with MinGW g++.
# Usage: powershell -File scripts/build-gate.ps1 [-Gxx <path-to-g++.exe>] [-Out <exe path>]
param(
    [string]$Gxx = 'F:\Mingw\mingw64\bin\g++.exe',
    [string]$Out = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Out)) { $Out = Join-Path $root 'bin\win32-x64\site_gate.exe' }
New-Item -ItemType Directory -Force (Split-Path -Parent $Out) | Out-Null

& $Gxx -std=c++17 -O2 -Wall -Wextra -static -o $Out `
    (Join-Path $root 'gate\src\gate.cpp') `
    (Join-Path $root 'gate\src\bt.cpp')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $Out --validate --sites (Join-Path $root 'gate\sites.json') --tree (Join-Path $root 'gate\gate.tree.json')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $Out --cases (Join-Path $root 'gate\tests\cases.json') --sites (Join-Path $root 'gate\sites.json') --tree (Join-Path $root 'gate\gate.tree.json')
exit $LASTEXITCODE
