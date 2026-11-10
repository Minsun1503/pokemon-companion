param([switch]$CompileOnly)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase, System.Web.Extensions
$uiaReferences = @([System.Windows.Automation.AutomationElement].Assembly.Location, [System.Windows.Automation.AutomationPattern].Assembly.Location, [System.Windows.Rect].Assembly.Location, [System.Web.Script.Serialization.JavaScriptSerializer].Assembly.Location) | Select-Object -Unique
$uiaSources = @('uia-worker.cs', 'uia-identity.cs', 'uia-observation.cs', 'uia-coordination.cs', 'excel-worker.cs') | ForEach-Object { Join-Path $PSScriptRoot $_ }
$assemblyPath = Join-Path $PSScriptRoot 'uia-worker.dll'
if ($CompileOnly) {
    if (Test-Path -LiteralPath $assemblyPath) { Remove-Item -LiteralPath $assemblyPath }
    Add-Type -Path $uiaSources -ReferencedAssemblies $uiaReferences -OutputAssembly $assemblyPath
    exit
}
if (Test-Path -LiteralPath $assemblyPath) {
    # Loading bytes keeps the build artifact replaceable while a worker is alive.
    [System.Reflection.Assembly]::Load([System.IO.File]::ReadAllBytes($assemblyPath)) | Out-Null
} else {
    Add-Type -Path $uiaSources -ReferencedAssemblies $uiaReferences
}
while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null
    try {
        $request = ConvertFrom-Json -InputObject $line
        $uiaArgs = $request.args
        if ($uiaArgs.window_ref) { [PokemonWindowsAutomation]::CheckWindow($uiaArgs.window_id, $uiaArgs.window_ref) }
        switch ($uiaArgs.action) {
            'acquire_control' { $result = [PokemonWindowsAutomation]::AcquireControl() }
            'release_control' { $result = [PokemonWindowsAutomation]::ReleaseControl() }
            'status' { $result = [PokemonWindowsAutomation]::Status() }
            'get_windows' { $result = [PokemonWindowsAutomation]::Windows($uiaArgs.query) }
            'get_ui' { $result = [PokemonWindowsAutomation]::UI($uiaArgs.window_id, $uiaArgs.query, $uiaArgs.control_type, $uiaArgs.max_elements, $uiaArgs.max_depth, $uiaArgs.view, $uiaArgs.root_snapshot, $uiaArgs.root_element_id, $uiaArgs.window_ref) }
            'wait_baseline' { $result = [PokemonWindowsAutomation]::WaitBaseline($uiaArgs.window_id, $uiaArgs.snapshot, $uiaArgs.element_id, $uiaArgs.query, $uiaArgs.control_type) }
            'activate' { $result = [PokemonWindowsAutomation]::Activate($uiaArgs.window_id, $uiaArgs.window_ref) }
            'launch' { $result = [PokemonWindowsAutomation]::Launch($uiaArgs.text) }
            'input_method' { $result = [PokemonWindowsAutomation]::InputMethod() }
            'foreground' { $result = [PokemonWindowsAutomation]::Foreground() }
            'read_text_page' { $result = [PokemonWindowsAutomation]::TextPage($uiaArgs.snapshot, $uiaArgs.element_id, $uiaArgs.text_offset, $uiaArgs.text_length, $uiaArgs.expected_version, $uiaArgs.required_text) }
            { $_ -like 'excel_*' } { $result = [PokemonExcelAutomation]::Execute(($uiaArgs | ConvertTo-Json -Depth 12 -Compress)) }
            default { $result = [PokemonWindowsAutomation]::Act($uiaArgs.snapshot, $uiaArgs.element_id, $uiaArgs.action, $uiaArgs.text, $uiaArgs.direction) }
        }
        [Console]::WriteLine((@{ id = $request.id; result = $result } | ConvertTo-Json -Depth 12 -Compress))
    } catch {
        $cause = $_.Exception.GetBaseException()
        $message = $cause.Message
        if ([string]::IsNullOrWhiteSpace($message)) { $message = $cause.ToString() }
        $failure = @{ id = $request.id; error = $message }
        if ($cause.Data.Contains('code')) {
            $failure.error_details = @{ code = $cause.Data['code']; disposition = @{ delivery = $cause.Data['delivery']; retry = $cause.Data['retry'] } }
        }
        [Console]::WriteLine(($failure | ConvertTo-Json -Depth 6 -Compress))
    }
}
