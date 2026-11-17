// Exercises the actual companion renderer/preload/IPC with a synthetic web API.
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const net=require('node:net');
const {pathToFileURL}=require('node:url');
const {setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'..'),profile=process.env.POKEMON_USER_DATA_DIR;
assert(profile);app.setPath('userData',profile);
let pet,socket,bridge,site,recorder,browser,api;
const evaluate=source=>pet.webContents.executeJavaScript(source);
const wait=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await delay(100);}throw new Error('UI condition timed out');};
(async()=>{
  const {BrowserAutomation}=await import(pathToFileURL(path.join(root,'backend/dist/browser/automation.js')));
  const {SessionApi}=await import(pathToFileURL(path.join(root,'backend/dist/browser/api.js')));
  const {RecordingService}=await import(pathToFileURL(path.join(root,'backend/dist/recording/service.js')));
  browser=new BrowserAutomation();
  // The test authorization callback only applies to this disposable synthetic site.
  api=new SessionApi({browser,authorize:async()=>{},paused:()=>false,reconcile:async()=>false},path.join(profile,'api'));
  recorder=new RecordingService({browser,api,companion:{state:{paused:false}},windows:{request:async()=>({windows:[]})}},path.join(profile,'recorder'));
  site=http.createServer((req,res)=>{
    if(req.url.startsWith('/api/list')){res.setHeader('Content-Type','application/json');res.end('{"items":["demo"],"token":"RESPONSE_SECRET"}');}
    else {res.setHeader('Content-Type','text/html');res.setHeader('Set-Cookie','session=COOKIE_SECRET; HttpOnly; Path=/');res.end('<button onclick="fetch(\'/api/list?token=QUERY_SECRET\').then(()=>document.querySelector(\'p\').textContent=\'Loaded\')">Inbox</button><p>Ready</p>');}
  });
  await new Promise(done=>site.listen(0,'127.0.0.1',done));
  const opened=await browser.launch('chromium',true,path.join(profile,'browser'));
  const page=browser.page(opened.page_id);await page.goto('http://127.0.0.1:'+site.address().port);
  const token=randomBytes(32).toString('hex');let hello;const connected=new Promise(done=>{hello=done;});
  bridge=net.createServer(connection=>{
    socket=connection;let buffer='';connection.setEncoding('utf8');
    connection.on('data',chunk=>{buffer+=chunk;while(buffer.includes('\n')){
      const end=buffer.indexOf('\n'),message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
      if(message.kind==='hello'&&message.token===token)hello();
      if(message.kind==='recording_request')void recorder.request(message.request).then(result=>connection.write(JSON.stringify({kind:'recording_result',id:message.id,ok:true,result})+'\n')).catch(error=>connection.write(JSON.stringify({kind:'recording_result',id:message.id,ok:false,error:error.message})+'\n'));
    }});
  });
  await new Promise(done=>bridge.listen(0,'127.0.0.1',done));
  process.env.POKEMON_BRIDGE_PORT=String(bridge.address().port);process.env.POKEMON_BRIDGE_TOKEN=token;
  require('../frontend/build/main/companion/index.js');await app.whenReady();await connected;
  await wait(()=>{pet=BrowserWindow.getAllWindows().find(win=>win.getTitle()==='Pokémon Companion');return pet;});
  await wait(()=>evaluate('Boolean(window.pokemonAPI)'));
  await evaluate("document.getElementById('pet-container').click();document.getElementById('action-record').click()");
  await wait(()=>evaluate("document.getElementById('record-target').value!==''"));
  await evaluate("document.getElementById('record-label').value='Open inbox';document.getElementById('record-toggle').click()");
  await wait(()=>evaluate("document.getElementById('record-toggle').textContent.includes('Stop')"));
  await page.getByRole('button',{name:'Inbox'}).click();
  await wait(()=>evaluate("document.querySelector('#record-entries li')?.textContent.includes('/api/list')"));
  assert((await evaluate("document.getElementById('record-entries').textContent")).includes('Near click: Inbox'));
  const exported=await evaluate("window.pokemonAPI.recording({action:'export'})");
  assert(exported.ok);assert(!/COOKIE_SECRET|QUERY_SECRET|RESPONSE_SECRET/.test(exported.result.text));
  const rogue=new BrowserWindow({show:false,webPreferences:{preload:path.join(root,'frontend/build/preload/companion.js'),contextIsolation:true}});
  await rogue.loadURL('data:text/html,untrusted');
  assert.equal((await rogue.webContents.executeJavaScript("window.pokemonAPI.recording({action:'start',mode:'desktop',target:'x'})")).ok,false);rogue.destroy();
  const rect=await evaluate("(()=>{const r=document.getElementById('team-panel').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()");
  fs.writeFileSync(path.join(root,'output/recording-panel.png'),(await pet.webContents.capturePage(rect)).toPNG());
  await evaluate("document.getElementById('record-toggle').click()");
  await wait(()=>evaluate("document.getElementById('record-toggle').textContent.includes('Record')"));
  console.log(JSON.stringify({ok:true,button_capture:true,click_correlated:true,export_redacted:true,untrusted_renderer_rejected:true,stop_verified:true,screenshot:'output/recording-panel.png'}));
  await recorder.close();await api.close();await browser.close();app.quit();
})().catch(error=>{console.error(error.stack);process.exitCode=1;app.quit();});
app.on('will-quit',()=>{socket?.destroy();bridge?.close();site?.closeAllConnections();site?.close();});
