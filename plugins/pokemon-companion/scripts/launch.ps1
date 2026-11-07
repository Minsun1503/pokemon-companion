$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$taskVersion = 'v0.1.0'
$taskArchiveName = 'pokemon-companion-win32-x64.zip'
$taskBaseUrl = "https://github.com/Minsun1503/pokemon-companion/releases/download/$taskVersion"
$taskCacheBase = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'pokemon-companion\packages'))
$taskPackage = [IO.Path]::GetFullPath((Join-Path $taskCacheBase $taskVersion))
if (-not $taskPackage.StartsWith($taskCacheBase + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid package cache path.' }
$taskMutex = New-Object Threading.Mutex($false, 'Local\pokemon-companion-package-v0.1.0')
$taskLocked = $false
try {
  $taskLocked = $taskMutex.WaitOne(300000)
  if (-not $taskLocked) { throw 'Another installation is still running. Reconnect the MCP server shortly.' }
  if (-not (Test-Path -LiteralPath (Join-Path $taskPackage 'runtime\node.exe'))) {
    [Console]::Error.WriteLine('Downloading Pokemon Companion for the first run...')
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    New-Item -ItemType Directory -Path $taskCacheBase -Force | Out-Null
    $taskId = [Guid]::NewGuid().ToString('N')
    $taskDownload = [IO.Path]::GetFullPath((Join-Path $taskCacheBase ('.download-' + $taskId + '.zip')))
    $taskStage = [IO.Path]::GetFullPath((Join-Path $taskCacheBase ('.install-' + $taskId)))
    if (-not $taskStage.StartsWith($taskCacheBase + '\', [StringComparison]::OrdinalIgnoreCase) -or -not $taskDownload.StartsWith($taskCacheBase + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid staging path.' }
    $taskSums = (Invoke-WebRequest -UseBasicParsing -Uri "$taskBaseUrl/SHA256SUMS.txt").Content
    $taskExpected = $null
    foreach ($taskLine in ($taskSums -split '\n')) {
      if ($taskLine -match '^([a-fA-F0-9]{64})\s+pokemon-companion-win32-x64\.zip\s*$') { $taskExpected = $Matches[1].ToLowerInvariant() }
    }
    if (-not $taskExpected) { throw 'Release checksum not found.' }
    Invoke-WebRequest -UseBasicParsing -Uri "$taskBaseUrl/$taskArchiveName" -OutFile $taskDownload
    if ((Get-FileHash -LiteralPath $taskDownload -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskExpected) { throw 'Release checksum verification failed.' }
    Expand-Archive -LiteralPath $taskDownload -DestinationPath $taskStage
    if (-not (Test-Path -LiteralPath (Join-Path $taskStage 'runtime\node.exe')) -or -not (Test-Path -LiteralPath (Join-Path $taskStage 'backend\dist\main.js'))) { throw 'Release package is incomplete.' }
    if (Test-Path -LiteralPath $taskPackage) { throw "An incomplete package exists at $taskPackage. Move it aside, then reconnect." }
    Move-Item -LiteralPath $taskStage -Destination $taskPackage
    Remove-Item -LiteralPath $taskDownload
  }
} finally {
  if ($taskLocked) { $taskMutex.ReleaseMutex() }
  $taskMutex.Dispose()
}

# Relay on background threads; each write is flushed so small MCP messages arrive immediately.
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
public static class PokemonMcpRelay {
    private static void Copy(Stream source, Stream destination) {
        byte[] buffer = new byte[16384];
        int count;
        while ((count = source.Read(buffer, 0, buffer.Length)) > 0) {
            destination.Write(buffer, 0, count);
            destination.Flush();
        }
    }
    public static int Run(ProcessStartInfo info) {
        using (Process process = Process.Start(info)) {
            Task input = Task.Run(() => {
                try { Copy(Console.OpenStandardInput(), process.StandardInput.BaseStream); }
                catch (IOException) { }
                finally { try { process.StandardInput.Close(); } catch (InvalidOperationException) { } }
            });
            Task output = Task.Run(() => Copy(process.StandardOutput.BaseStream, Console.OpenStandardOutput()));
            Task error = Task.Run(() => Copy(process.StandardError.BaseStream, Console.OpenStandardError()));
            process.WaitForExit();
            Task.WaitAll(output, error);
            return process.ExitCode;
        }
    }
}
'@
$taskStart = New-Object Diagnostics.ProcessStartInfo
$taskStart.FileName = Join-Path $taskPackage 'runtime\node.exe'
$taskStart.Arguments = '"' + (Join-Path $taskPackage 'backend\dist\main.js') + '"'
$taskStart.WorkingDirectory = $taskPackage
$taskStart.UseShellExecute = $false
$taskStart.CreateNoWindow = $true
$taskStart.RedirectStandardInput = $true
$taskStart.RedirectStandardOutput = $true
$taskStart.RedirectStandardError = $true
$taskStart.EnvironmentVariables['MCP_TRANSPORT'] = 'stdio'
$taskStart.EnvironmentVariables['POKEMON_FRONTEND_DIR'] = Join-Path $taskPackage 'frontend'
exit [PokemonMcpRelay]::Run($taskStart)
