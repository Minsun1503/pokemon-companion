param(
    [Parameter(Mandatory=$true)][string]$Checkout,
    [Parameter(Mandatory=$true)][string]$Node
)
$ErrorActionPreference = 'Stop'
$agentHome = Join-Path $env:LOCALAPPDATA 'pokemon-companion/harness'
$profileFile = Join-Path $Checkout 'agent-profile.json'
if (Test-Path -LiteralPath $profileFile) {
    $profile = Get-Content -LiteralPath $profileFile -Raw | ConvertFrom-Json
    if ($profile.id -ne 'deepseek-telegram') { throw 'Unknown agent deployment profile.' }
    $agentHome = Join-Path $env:LOCALAPPDATA 'pokemon-companion/harness-deepseek'
}
$env:POKEMON_HARNESS_HOME = $agentHome
New-Item -ItemType Directory -Force -Path $agentHome | Out-Null
$entry = Join-Path $Checkout 'scripts/harness.cjs'
if (!(Test-Path -LiteralPath $entry) -or !(Test-Path -LiteralPath $Node)) {
    throw 'The saved Pokemon Agent checkout or Node runtime is missing.'
}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PokemonAgentPower {
    [DllImport("kernel32.dll")]
    public static extern uint SetThreadExecutionState(uint flags);
}
'@
$env:POKEMON_AGENT_NO_OPEN = '1'
$env:POKEMON_HARNESS_PORT = '56727'
$env:POKEMON_AGENT_PARENT_PID = [string]$PID
$agentProcess = Start-Process -FilePath $Node -ArgumentList @(('"' + $entry + '"'), 'run') -WorkingDirectory $Checkout -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $agentHome 'agent.stdout.log') -RedirectStandardError (Join-Path $agentHome 'agent.stderr.log')
try {
    # Keep the system awake while the remote gateway runs. Display sleep and lock remain available.
    do {
        [PokemonAgentPower]::SetThreadExecutionState(1) | Out-Null
    } while (!$agentProcess.WaitForExit(30000))
    exit $agentProcess.ExitCode
} finally {
    if (!$agentProcess.HasExited) { Stop-Process -Id $agentProcess.Id }
}
