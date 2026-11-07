param([switch]$CompileOnly)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
$uiaReferences = @([System.Windows.Automation.AutomationElement].Assembly.Location, [System.Windows.Automation.AutomationPattern].Assembly.Location, [System.Windows.Rect].Assembly.Location) | Select-Object -Unique
$assemblyPath = Join-Path $PSScriptRoot 'uia-worker.dll'
if ($CompileOnly) {
    if (Test-Path -LiteralPath $assemblyPath) { Remove-Item -LiteralPath $assemblyPath }
    Add-Type -Path (Join-Path $PSScriptRoot 'uia-worker.cs') -ReferencedAssemblies $uiaReferences -OutputAssembly $assemblyPath
    exit
}
if (Test-Path -LiteralPath $assemblyPath) {
    # Loading bytes keeps the build artifact replaceable while a worker is alive.
    [System.Reflection.Assembly]::Load([System.IO.File]::ReadAllBytes($assemblyPath)) | Out-Null
} else {
    Add-Type -Path (Join-Path $PSScriptRoot 'uia-worker.cs') -ReferencedAssemblies $uiaReferences
}
while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null
    try {
        $request = ConvertFrom-Json -InputObject $line
        $uiaArgs = $request.args
        switch ($uiaArgs.action) {
            'get_windows' { $result = [PokemonWindowsAutomation]::Windows($uiaArgs.query) }
            'get_ui' { $result = [PokemonWindowsAutomation]::UI($uiaArgs.window_id, $uiaArgs.query, $uiaArgs.control_type, $uiaArgs.max_elements, $uiaArgs.max_depth) }
            'activate' { $result = [PokemonWindowsAutomation]::Activate($uiaArgs.window_id) }
            default { $result = [PokemonWindowsAutomation]::Act($uiaArgs.snapshot, $uiaArgs.element_id, $uiaArgs.action, $uiaArgs.text, $uiaArgs.direction) }
        }
        [Console]::WriteLine((@{ id = $request.id; result = $result } | ConvertTo-Json -Depth 12 -Compress))
    } catch {
        [Console]::WriteLine((@{ id = $request.id; error = $_.Exception.GetBaseException().Message } | ConvertTo-Json -Compress))
    }
}
