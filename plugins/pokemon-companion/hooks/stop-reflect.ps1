$ErrorActionPreference = 'Stop'
# Stop hook: after a turn that used pokemon-companion tools, ask the agent to review the
# task for lessons, but only when the turn shows a signal (failed calls, many calls, or a
# secret in tool output). Names the signal so the review is concrete. Never blocks twice.
try {
  $raw = [Console]::In.ReadToEnd()
  $data = if ($raw) { $raw | ConvertFrom-Json } else { $null }
} catch { exit 0 }
if (-not $data -or $data.stop_hook_active) { exit 0 }
$path = $data.transcript_path
if (-not $path -or -not (Test-Path -LiteralPath $path)) { exit 0 }

# Current turn only: entries after the last real user message.
$lines = Get-Content -LiteralPath $path -Tail 1500 -Encoding UTF8
$turn = New-Object System.Collections.Generic.List[string]
foreach ($line in $lines) {
  if ($line -match '"type"\s*:\s*"user"' -and $line -notmatch '"tool_result"' -and $line -notmatch '"tool_use_id"') {
    $turn.Clear()
  }
  $turn.Add($line)
}

$calls = 0
$errors = 0
$codes = @{}
$secret = $false
$secretPattern = 'github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_\-]{30,}|sk-[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{20,}'
foreach ($line in $turn) {
  if ($line -match '"name"\s*:\s*"mcp__pokemon-companion__') {
    $calls += ([regex]::Matches($line, '"name"\s*:\s*"mcp__pokemon-companion__')).Count
  }
  if ($line -match '"tool_result"') {
    if ($line -match '"is_error"\s*:\s*true') { $errors++ }
    foreach ($m in [regex]::Matches($line, '\\?"code\\?"\s*:\s*\\?"([A-Z_]{4,})\\?"')) {
      $c = $m.Groups[1].Value
      $codes[$c] = 1 + [int]$codes[$c]
    }
    if (-not $secret -and $line -match $secretPattern) { $secret = $true }
  }
}
if ($calls -eq 0) { exit 0 }
if ($errors -eq 0 -and $calls -lt 15 -and -not $secret) { exit 0 }

$signals = New-Object System.Collections.Generic.List[string]
if ($errors -gt 0) { $signals.Add("$errors failed tool call(s)") }
if ($codes.Count -gt 0) {
  $top = ($codes.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 4 |
    ForEach-Object { "$($_.Key) x$($_.Value)" }) -join ', '
  $signals.Add("error codes: $top")
}
if ($calls -ge 15) { $signals.Add("$calls pokemon-companion calls") }
if ($signals.Count -eq 0) { $signals.Add('a secret-like value in tool output') }

$reason = 'Before finishing, follow "Learn from the task" in the pokemon-companion skill. This turn had ' +
  ($signals -join '; ') + '. Check what caused retries or detours and whether the user corrected you or approved a way of working. ' +
  'Save clear, reusable lessons (skill for app how-to, memory for the user''s preferences) and mention in one line what you saved; if nothing is worth saving, finish normally.'
if ($secret) {
  $reason += ' A token or key pattern appeared in tool output this turn: do not save or repeat it, tell the user it was exposed, and recommend revoking or regenerating it.'
}
[Console]::Out.Write((@{ decision = 'block'; reason = $reason } | ConvertTo-Json -Compress))
