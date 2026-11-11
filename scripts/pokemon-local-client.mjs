import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
const protectedToken = await readFile(join(process.env.LOCALAPPDATA, 'pokemon-companion', 'http-token.dpapi'));
const script = 'Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::ReadLine()); [Console]::Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))';
const token = execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',script], {input:protectedToken.toString('base64')+'\n',encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();
export async function callLocal(name, args) {
  const response = await fetch('http://127.0.0.1:3000/mcp', {method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-03-26'},body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(60000)});
  if (!response.ok) throw new Error('Local MCP returned HTTP '+response.status);
  const message = await response.json();
  if (message.error) throw new Error(JSON.stringify(message.error));
  return message.result;
}
