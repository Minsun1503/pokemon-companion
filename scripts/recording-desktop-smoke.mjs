import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {DesktopRecorder} from '../backend/dist/recording/desktop.js';
const scratch=await mkdtemp(join(tmpdir(),'pokemon-desktop-recording-'));
const server=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end('{"token":"RESPONSE_SECRET"}');});
await new Promise(done=>server.listen(0,'0.0.0.0',done));
const child=fork(resolve('scripts/recording-desktop-fixture.cjs'),[],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
await new Promise(done=>child.once('message',done));
const traces=[];const recorder=new DesktopRecorder(scratch,entry=>traces.push(entry),()=>{});
try{
  await recorder.start([child.pid]);
  // Windows local redirectors may exclude loopback; example.com is a read-only HTTP fixture.
  child.send({url:'http://example.com/?token=QUERY_SECRET'});
  const result=await new Promise(done=>child.once('message',done));assert(result.status>0);
  for(let i=0;i<40&&!traces.length;i++)await delay(100);
  assert(traces.length,'The local redirector must observe the selected fixture process request.');
  assert(!/QUERY_SECRET|SYNTHETIC_HEADER|RESPONSE_SECRET/.test(JSON.stringify(traces)));
  await recorder.stop();const count=traces.length;
  child.send({url:'http://127.0.0.1:'+server.address().port+'/api/list'});
  await new Promise(done=>child.once('message',done));await delay(200);assert.equal(traces.length,count);
  console.log(JSON.stringify({ok:true,local_mode:true,selected_process:child.pid,captured:count,stop_verified:true,credentials_omitted:true}));
}finally{await recorder.stop();child.kill();server.closeAllConnections();server.close();await rm(scratch,{recursive:true,force:true});}
