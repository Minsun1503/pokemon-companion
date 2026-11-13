import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scratch=await mkdtemp(resolve(tmpdir(),'pokemon-talk-ui-'));
const env={...process.env,POKEMON_USER_DATA_DIR:scratch,POKEMON_AGENT_AUDIT:resolve(scratch,'audit.jsonl'),POKEMON_LEARNING:'off'};
delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(resolve(root,'frontend/node_modules/electron/dist/electron.exe'),[resolve(root,'scripts/companion-talk-fixture.cjs'),'--force-renderer-accessibility'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='',error='',workerPids=[];
child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{error+=chunk;});
const descendants=()=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`@((Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${child.pid} -and $_.CommandLine -match 'talk[/\\\\]worker.js' }).ProcessId) | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true}));
const sampler=setInterval(()=>{try {workerPids.push(...[].concat(descendants()||[]));} catch {}},500);
const timeout=setTimeout(()=>child.kill(),60000);
try {
  const code=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
  assert.equal(code,0,error+output);
  const result=output.split('\n').map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(row=>row?.ok);
  assert(result,error+output);assert(workerPids.length,'A native worker must actually start during the task.');
  const alive=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`@(Get-Process -Id ${[...new Set(workerPids)].join(',')} -ErrorAction SilentlyContinue).Count`],{encoding:'utf8',windowsHide:true});
  assert.equal(Number(alive.trim()),0,'Quitting the companion must close its worker.');
  console.log(JSON.stringify({...result,worker_cleanup_verified:true},null,2));
} finally {
  clearInterval(sampler);clearTimeout(timeout);
  if(child.exitCode===null && child.signalCode===null) child.kill();
  const checked=await realpath(scratch);assert.equal(dirname(checked).toLowerCase(),(await realpath(tmpdir())).toLowerCase());
  assert(checked.split(/[\\/]/).at(-1).startsWith('pokemon-talk-ui-'));
  await rm(checked,{recursive:true,force:true});
}
