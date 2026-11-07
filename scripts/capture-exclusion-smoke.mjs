import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import net from 'node:net';
import {mkdtemp, realpath, rm, writeFile, mkdir} from 'node:fs/promises';
import os from 'node:os';
import {dirname, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {connect} from './client.mjs';
const sharp = createRequire(new URL('../backend/package.json', import.meta.url))('sharp');
assert.equal(process.platform, 'win32');
const scratch = await mkdtemp(resolve(os.tmpdir(), 'pokemon-exclusion-'));
const output = resolve(process.argv[2] || 'benchmarks/results/perf-exclusion.json');
const token = randomBytes(32).toString('hex');
let socket, child, session, fixtureUrl, sequence=0;
const pending = new Map();
let authenticated;
const ready = new Promise(resolve => authenticated = resolve);
const bridge = net.createServer(connection => {
  socket=connection; let buffer=''; connection.setEncoding('utf8');
  connection.on('data', chunk => {
    buffer+=chunk;
    while (buffer.includes('\n')) {
      const end=buffer.indexOf('\n'), message=JSON.parse(buffer.slice(0,end)); buffer=buffer.slice(end+1);
      if (message.kind==='hello') {assert.equal(message.token,token); authenticated();}
      if (message.kind==='ack') {const item=pending.get(message.id);pending.delete(message.id); message.error ? item.reject(new Error(message.error)) : item.resolve();}
    }
  });
});
const send = (kind, fields={}) => new Promise((resolve,reject) => {
  const id=++sequence;pending.set(id,{resolve,reject});socket.write(JSON.stringify({id,kind,...fields})+'\n');
});
async function fixture(path) {
  const response=await fetch(fixtureUrl+path,{signal:AbortSignal.timeout(5000)}), result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result));return result;
}
let state={pet:'pikachu',activity:'thinking',message:'Capture exclusion experiment',task:'Test',visible:true,paused:false,completedActions:0};
const samples=[];
let lastCapture;
let affinity=[], protectedState, failure;
async function capture(label, hidden=false) {
  const visible=await fixture('/state');
  const originallyProtected=visible.windows.every(win=>win.protected);
  const protectedCommand=process.argv.includes('--candidate') && label.startsWith('protected-');
  if (hidden) {
    if(originallyProtected)await fixture('/protect?enabled=0');
    await send('capture',{hidden:true});
    assert((await fixture('/state')).windows.every(win=>!win.visible),'Unprotected fallback must hide every companion window.');
  }
  const started=performance.now();
  if(protectedCommand) {
    await send('capture',{hidden:true});
    assert((await fixture('/state')).windows.some(win=>win.visible),'Protected path must keep the companion visible.');
  }
  const result=await session.call('computer',{action:'get_screenshot'});
  const elapsed_ms=performance.now()-started;
  if(protectedCommand)await send('capture',{hidden:false});
  if (hidden) {
    if(originallyProtected)await fixture('/protect?enabled=1');
    await send('capture',{hidden:false});
  }
  const image=result.content.find(item=>item.type==='image'), bytes=Buffer.from(image.data,'base64');
  const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  lastCapture={data,info};
  let sentinel_pixels=0;
  for (let i=0;i<data.length;i+=4) if(Math.abs(data[i]-18)<15&&Math.abs(data[i+1]-228)<15&&Math.abs(data[i+2]-167)<15)sentinel_pixels++;
  const marker=visible.windows.find(win=>win.visible)?.marker;
  assert(marker,'Visible sentinel required.');
  const x=Math.floor(marker.x/visible.display.width*info.width),y=Math.floor(marker.y/visible.display.height*info.height),index=(y*info.width+x)*4;
  const center=[...data.subarray(index,index+3)];
  samples.push({label,elapsed_ms,bytes:bytes.length,image_width:info.width,image_height:info.height,sentinel_pixels,center,marker,visible_windows:visible.windows.filter(win=>win.visible).length});
  return samples.at(-1);
}
try {
  await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));
  const env={...process.env,APPDATA:scratch,POKEMON_BRIDGE_PORT:String(bridge.address().port),POKEMON_BRIDGE_TOKEN:token};delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(resolve('frontend/node_modules/electron/dist/electron.exe'),[resolve('scripts/capture-exclusion-fixture.cjs')],{env,windowsHide:true,stdio:['ignore','pipe','inherit']});
  fixtureUrl=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Fixture startup timeout')),20000);let buffer='';
    child.stdout.on('data',chunk=>{buffer+=chunk.toString();for(const line of buffer.split('\n'))try{const value=JSON.parse(line);if(value.port){clearTimeout(timer);resolve('http://127.0.0.1:'+value.port);}}catch{}});
    child.once('error',reject);
  });
  await ready;
  await send('state',{state});
  await fixture('/sentinel');await delay(300);
  await fixture('/protect?enabled=0');
  session=await connect({env:{...process.env,POKEMON_UI:'off'}});
  const visible=await capture('unprotected-visible');assert(visible.sentinel_pixels>100,'Sentinel must be detectable before protection.');
  const fallback=await capture('hide-show-fallback',true);assert.equal(fallback.sentinel_pixels,0);
  protectedState=await fixture('/protect?enabled=1');
  const probe=resolve(scratch,'affinity.ps1');
  await writeFile(probe,`param([string]$handles)
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class Affinity { [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowDisplayAffinity(IntPtr hwnd, out uint affinity); }'
foreach ($handle in $handles.Split(',')) { [uint32]$value=0; $ok=[Affinity]::GetWindowDisplayAffinity([IntPtr][long]$handle,[ref]$value); [pscustomobject]@{handle=$handle;ok=$ok;affinity=$value} | ConvertTo-Json -Compress }
`);
  affinity=execFileSync(resolve(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-File',probe,protectedState.windows.map(win=>win.handle).join(',')],{windowsHide:true,encoding:'utf8'}).trim().split(/\r?\n/).map(line=>JSON.parse(line));
  assert.equal(affinity.length,protectedState.windows.length);
  assert(affinity.every(win=>win.ok&&win.affinity===17),'Require actual WDA_EXCLUDEFROMCAPTURE, not WDA_MONITOR.');
  const dimensions=protectedState.display;
  const positions=[[.2,.2],[.5,.5],[.7,.2],[.7,.7]];
  for(let position=0;position<positions.length;position++) {
    const [x,y]=positions[position].map((fraction,index)=>Math.round(fraction*(index?dimensions.height:dimensions.width)));
    for(let run=0;run<10;run++) {
      const tray=run%2===1;
      if(tray) {
        state={...state,visible:false};await send('state',{state});
        const width=visible.image_width,height=visible.image_height;
        await session.call('computer',{action:'mouse_move',coordinate:[Math.round(x/dimensions.width*width),Math.round(y/dimensions.height*height)]});
        await fixture('/summon');
      } else {state={...state,visible:true};await send('state',{state,coordinate:[x,y]});}
      await delay(200);
      const reference=await capture('hidden-reference-'+position+'-'+run,true);
      const referencePixels=lastCapture;
      assert.equal(reference.sentinel_pixels,0);
      assert(reference.center.some(channel=>channel>0),'Reference must not already contain a black hole.');
      await delay(120);
      const result=await capture('protected-'+position+'-'+(tray?'tray':'normal')+'-'+run);
      assert.equal(result.sentinel_pixels,0);
      const px=Math.floor(result.marker.x/dimensions.width*referencePixels.info.width),py=Math.floor(result.marker.y/dimensions.height*referencePixels.info.height);
      result.reference_at_same_point=[...referencePixels.data.subarray((py*referencePixels.info.width+px)*4,(py*referencePixels.info.width+px)*4+3)];
      result.underlying_matches=result.center.every((channel,index)=>Math.abs(channel-result.reference_at_same_point[index])<15);
    }
    console.log('Verified position '+position+': 10/10 protected captures, including tray summons.');
  }
  await mkdir(dirname(output),{recursive:true});
  const protectedSamples=samples.filter(sample=>sample.label.startsWith('protected-'));
  assert.equal(protectedSamples.length,40);
  const underlying_mismatches=protectedSamples.filter(sample=>!sample.underlying_matches).length;
  await writeFile(output,JSON.stringify({complete:true,measured_at:new Date().toISOString(),windows_build:os.release(),electron:protectedState.electron,affinity,underlying_mismatches,accepted:underlying_mismatches===0,samples},null,2)+'\n');
  console.log('Completed 40 protected captures; zero sentinel pixels; underlying-reference mismatches: '+underlying_mismatches+'. '+(underlying_mismatches?'Keep hide/show fallback.':'Exclusion verified.'));
} catch(error) {
  failure=error.message;throw error;
} finally {
  if(failure) {await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({complete:false,failure,affinity,electron:protectedState?.electron,samples},null,2)+'\n');}
  if(fixtureUrl)await fixture('/quit').catch(()=>{});child?.kill();socket?.destroy();bridge.close();if(session)await session.client.close();
  const dir=await realpath(scratch),temp=await realpath(os.tmpdir());assert.equal(dirname(dir).toLowerCase(),temp.toLowerCase());assert(dir.includes('pokemon-exclusion-'));await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
