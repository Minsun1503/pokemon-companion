import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const token=randomBytes(32).toString('hex');
const launch=(port,secret)=>spawn(process.execPath,[resolve(root,'backend/dist/main.js')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,MCP_TRANSPORT:'http',PORT:String(port),POKEMON_UI:'off',POKEMON_HTTP_TOKEN:secret}});
const reservation=createServer();
await new Promise(done=>reservation.listen(0,'127.0.0.1',done));
const port=reservation.address().port;
await new Promise(done=>reservation.close(done));
const invalid=launch(port,'short');
assert.equal(await new Promise(done=>invalid.once('exit',done)),1);
const child=launch(port,token);
let diagnostics='';child.stderr.on('data',data=>{diagnostics+=data;});
try{
  const url=`http://127.0.0.1:${port}/mcp`,headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-03-26'};
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(url,{signal:AbortSignal.timeout(500)})).status===401){ready=true;break;}}catch{}await delay(100);}
  assert(ready,'HTTP server did not start: '+diagnostics);
  for(const authorization of [undefined,'Bearer incorrect','Basic '+token]){
    const result=await fetch(url,{method:'POST',headers:{...headers,...(authorization?{Authorization:authorization}:{})},body:'{not valid JSON',signal:AbortSignal.timeout(3000)});
    assert.equal(result.status,401,'Authentication must precede JSON parsing');
  }
  const result=await fetch(url,{method:'POST',headers:{...headers,Authorization:'Bearer '+token},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}}),signal:AbortSignal.timeout(5000)});
  assert.equal(result.status,200);
  assert((await result.json()).result.tools.some(tool=>tool.name==='learning'));
  assert(!diagnostics.includes(token));
  console.log('PASS: HTTP refuses short configuration, rejects missing/wrong credentials before parsing, and accepts authenticated MCP requests.');
}finally{if(child.exitCode===null){const stopped=new Promise(done=>child.once('exit',done));child.kill();await stopped;}}
