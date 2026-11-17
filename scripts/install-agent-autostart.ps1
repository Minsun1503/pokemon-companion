$ErrorActionPreference = 'Stop'
$checkout = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if (!(Test-Path -LiteralPath (Join-Path $checkout 'backend/dist/harness/main.js'))) {
    throw 'Build this checkout before installing Pokemon Agent autostart.'
}
$bundledNode = Join-Path $checkout 'runtime/node.exe'
$nodePath = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node.exe -ErrorAction Stop).Source }
$servicePath = Join-Path $PSScriptRoot 'agent-service.ps1'
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $servicePath + '" -Checkout "' + $checkout + '" -Node "' + $nodePath + '"'
$action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument $arguments -WorkingDirectory $checkout
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Pokemon Agent Telegram' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Runs the owner-configured Pokemon Telegram gateway while the Windows owner is signed in.' -Force | Out-Null
Write-Output 'Installed Pokemon Agent Telegram autostart. Use Start-ScheduledTask or Task Scheduler to start it now.'
