import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scratch=await mkdtemp(join(tmpdir(),'pokemon-recording-ui-'));
await mkdir(join(root,'output'),{recursive:true});
const env={...process.env,POKEMON_USER_DATA_DIR:scratch,POKEMON_LEARNING:'off'};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(join(root,'frontend/node_modules/electron/dist/electron.exe'),[join(root,'scripts/recording-ui-fixture.cjs')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='',error='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);
const timer=setTimeout(()=>child.kill(),60000);
try{
  const code=await new Promise((done,reject)=>{child.once('exit',done);child.once('error',reject);});
  if(code!==0)throw new Error(error+output);
  console.log(output.trim());
}finally{clearTimeout(timer);await rm(scratch,{recursive:true,force:true});}
