import {spawn} from 'node:child_process';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scratch=await mkdtemp(resolve(tmpdir(),'pokemon-readiness-'));
const env={...process.env,POKEMON_READINESS_DATA:scratch};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(resolve(root,'frontend/node_modules/electron/dist/electron.exe'),[resolve(root,'scripts/talk-readiness-fixture.cjs'),'--force-renderer-accessibility'],{env,windowsHide:true,stdio:['ignore','inherit','inherit']});
const code=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
if(code===0) {
  // This exact owned fixture directory is the only recursive cleanup target.
  const checked=await realpath(scratch);assert.equal(dirname(checked).toLowerCase(),(await realpath(tmpdir())).toLowerCase());
  assert(checked.split(/[\\/]/).at(-1).startsWith('pokemon-readiness-'));await rm(checked,{recursive:true,force:true});
}else {console.error('Fixture failed; preserved '+scratch);process.exitCode=1;}
