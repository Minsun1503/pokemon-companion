param([ValidateSet('Codex', 'ClaudeCode')][string]$Client)
$ErrorActionPreference = 'Stop'
$taskBundle = [IO.Path]::GetFullPath($PSScriptRoot)
try {
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'This package requires 64-bit Windows.' }
  if (-not (Test-Path -LiteralPath (Join-Path $taskBundle 'runtime\node.exe'))) { throw 'Extract the complete ZIP before installing.' }
  if ($Client -eq 'Codex') {
    $taskCommand = Get-Command codex -ErrorAction Stop
    & $taskCommand.Source plugin marketplace add $taskBundle
    if ($LASTEXITCODE -ne 0) { throw 'Codex could not register the local marketplace.' }
    & $taskCommand.Source plugin add 'pokemon-companion@pokemon-companion'
  } else {
    $taskCommand = Get-Command claude -ErrorAction Stop
    & $taskCommand.Source plugin marketplace add $taskBundle
    if ($LASTEXITCODE -ne 0) { throw 'Claude Code could not register the local marketplace.' }
    & $taskCommand.Source plugin install 'pokemon-companion@pokemon-companion'
  }
  if ($LASTEXITCODE -ne 0) { throw "$Client could not install the plugin." }
  Write-Host "Installed Pokémon Companion for $Client. Restart the app and open a new chat."
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host "Install $Client first, then run this installer again."
  exit 1
}
