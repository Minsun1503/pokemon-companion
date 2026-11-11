param([int]$Port = 3000)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$taskProfile = Join-Path $env:LOCALAPPDATA 'pokemon-companion'
[System.IO.Directory]::CreateDirectory($taskProfile) | Out-Null
$taskTokenPath = Join-Path $taskProfile 'http-token.dpapi'
if (Test-Path -LiteralPath $taskTokenPath) {
  if ((Get-Item -LiteralPath $taskTokenPath).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'HTTP token cannot be a link.' }
  $taskTokenBytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($taskTokenPath), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
} else {
  $taskRandom = [Security.Cryptography.RandomNumberGenerator]::Create()
  $taskTokenBytes = New-Object byte[] 32
  $taskRandom.GetBytes($taskTokenBytes)
  $taskRandom.Dispose()
  $taskProtectedToken = [Security.Cryptography.ProtectedData]::Protect($taskTokenBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $taskStream = [IO.File]::Open($taskTokenPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $taskStream.Write($taskProtectedToken, 0, $taskProtectedToken.Length) } finally { $taskStream.Dispose() }
}
if ($taskTokenBytes.Length -ne 32) { throw 'Invalid HTTP token file.' }
$env:POKEMON_HTTP_TOKEN = [Convert]::ToBase64String($taskTokenBytes)
[Array]::Clear($taskTokenBytes, 0, $taskTokenBytes.Length)
$env:MCP_TRANSPORT = 'http'
$env:PORT = [string]$Port
& node (Join-Path $PSScriptRoot '../backend/dist/main.js')
