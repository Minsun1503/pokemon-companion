param([string]$Assembly)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
[System.Reflection.Assembly]::Load([System.IO.File]::ReadAllBytes($Assembly)) | Out-Null
$windows = [PokemonWindowsAutomation]::Windows('msedge')['windows']
if ($windows.Count -eq 0) { throw 'Test requires an existing Edge window; no window is opened.' }
$selected = $windows[0]
$token = $selected['window_ref']
$proofsField = [PokemonWindowsAutomation].GetField('windowProofs', [System.Reflection.BindingFlags]'NonPublic,Static')
$proofs = $proofsField.GetValue($null)
$proof = $proofs[$token]
$created = $proof.GetType().GetField('Created')
# Age only this test process's private proof; never change production worker state.
$created.SetValue($proof, [DateTime]::UtcNow.AddSeconds(-119))
$observed = [PokemonWindowsAutomation]::Windows('msedge')['windows'] | Where-Object { $_['id'] -eq $selected['id'] }
if ($observed['window_ref'] -ne $token) { throw 'Fresh discovery rebound the existing proven token.' }
if (([DateTime]::UtcNow - $created.GetValue($proof)).TotalSeconds -gt 2) { throw 'Fresh discovery did not renew the window proof.' }
[PokemonWindowsAutomation]::CheckWindow($selected['id'], $token)
$created.SetValue($proof, [DateTime]::UtcNow.AddSeconds(-121))
$rejected = $false
try { [PokemonWindowsAutomation]::CheckWindow($selected['id'], $token) } catch { $rejected = $_.Exception.GetBaseException().Data['code'] -eq 'STALE_REF' }
if (-not $rejected) { throw 'Idle expired proof was incorrectly accepted.' }
$fresh = [PokemonWindowsAutomation]::Windows('msedge')['windows'] | Where-Object { $_['id'] -eq $selected['id'] }
if ($fresh['window_ref'] -eq $token) { throw 'Expired proof was revived instead of creating a fresh observation.' }
[PokemonWindowsAutomation]::CheckWindow($selected['id'], $fresh['window_ref'])
$rejected = $false
try { [PokemonWindowsAutomation]::CheckWindow('1', $fresh['window_ref']) } catch { $rejected = $_.Exception.GetBaseException().Data['code'] -eq 'STALE_REF' }
if (-not $rejected) { throw 'Mismatched window was accepted.' }
'PASS: fresh discovery renews the same verified window; idle expiry and mismatched-window rejection remain enforced.'
