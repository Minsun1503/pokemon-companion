$ErrorActionPreference = 'Stop'
# Stop hook: once per turn that used pokemon-companion tools, ask the agent to review
# the task for lessons before it finishes. Never blocks twice in a row.
try {
  $raw = [Console]::In.ReadToEnd()
  $data = if ($raw) { $raw | ConvertFrom-Json } else { $null }
} catch { exit 0 }
if (-not $data -or $data.stop_hook_active) { exit 0 }
$path = $data.transcript_path
if (-not $path -or -not (Test-Path -LiteralPath $path)) { exit 0 }

# Look at the current turn only: entries after the last real user message.
$lines = Get-Content -LiteralPath $path -Tail 400 -Encoding UTF8
$turn = New-Object System.Collections.Generic.List[string]
foreach ($line in $lines) {
  if ($line -match '"type"\s*:\s*"user"' -and $line -notmatch '"tool_result"' -and $line -notmatch '"tool_use_id"') {
    $turn.Clear()
  }
  $turn.Add($line)
}
$usedCompanion = $false
foreach ($line in $turn) { if ($line -match 'pokemon-companion') { $usedCompanion = $true; break } }
if (-not $usedCompanion) { exit 0 }

$reason = 'Before finishing, follow "Learn from the task" in the pokemon-companion skill: check whether the user corrected you, approved a way of working, or you needed several attempts. Save clear, reusable lessons (skill for app how-to, memory for the user''s preferences), never private data in shared files, and mention in one line what you saved. If there is nothing worth saving, finish normally.'
[Console]::Out.Write((@{ decision = 'block'; reason = $reason } | ConvertTo-Json -Compress))
