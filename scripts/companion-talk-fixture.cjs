// Runs the actual companion main/preload/renderer against a disposable model and app.
const {app, BrowserWindow} = require('electron');
const assert = require('node:assert/strict');
const {randomBytes} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const {setTimeout: delay} = require('node:timers/promises');
const profile = process.env.POKEMON_USER_DATA_DIR;
assert(profile, 'An isolated profile is required.');
app.setPath('userData', profile);
let pet, input, socket, bridge, model, requests = 0, hold, waiting, mode = 'greeting';
const token = randomBytes(32).toString('hex');
const call = (name, args) => ({role:'assistant', content:'', tool_calls:[{function:{name, arguments:args}}]});
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const wait = async predicate => {
  for (let i=0; i<200; i++) {const value = await predicate(); if (value) return value; await delay(50);}
  throw new Error('Fixture observation timed out: '+(pet ? await evaluate("JSON.stringify({view:document.getElementById('team-panel').dataset.view,error:document.getElementById('chat-error').textContent,messages:document.getElementById('chat-messages').textContent})") : 'no pet'));
};
const evaluate = source => pet.webContents.executeJavaScript(source);
const send = text => evaluate(`window.pokemonAPI.chat.send('pikachu', ${JSON.stringify(text)})`);
const audit = () => fs.existsSync(process.env.POKEMON_AGENT_AUDIT)
  ? fs.readFileSync(process.env.POKEMON_AGENT_AUDIT, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];

(async () => {
  model = http.createServer(async (req, res) => {
    try {
      let body=''; for await (const chunk of req) body+=chunk;
      const request=JSON.parse(body); requests++;
      assert.equal(request.stream, false);
      assert(request.tools.some(item => item.function.name === 'windows'));
      let message;
      if (mode === 'greeting') message={role:'assistant',content:'Hello from the fixture.'};
      else {
        const last=request.messages.at(-1);
        const observed=last.role === 'tool' ? JSON.parse(last.content) : {};
        if (last.tool_name === 'windows' && observed.windows) {
          const found=observed.windows.filter(win=>win.title==='Pokemon Talk Fixture Input');
          assert.equal(found.length,1);
          const win=found[0];
          message=call('windows',{action:'get_ui',window_id:win.id,window_ref:win.window_ref});
        } else if (last.tool_name === 'windows' && observed.nodes) {
          const edit=observed.nodes.find(node=>node.name==='Fixture text' && node.actions.includes('set_value'));
          assert(edit?.target);
          if (mode === 'pause') {waiting=true; await new Promise(resolve=>{hold=resolve;});}
          message=call('windows',{action:'set_value',target:edit.target,text:mode==='pause'?'must not arrive':'fixture received'});
        } else if (observed.action_result) {
          const data=observed.observation;
          message=call('task_done',{window_id:data.window.id,window_ref:data.window.window_ref,query:'Received: fixture received',summary:'Entered and verified the fixture text.'});
        } else throw new Error('Unexpected model round: '+JSON.stringify(observed));
      }
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({message}));
    } catch(error) {console.error(error.stack);res.statusCode=500; res.end(JSON.stringify({error:error.message}));}
  });
  await listen(model);
  const settings=JSON.parse(fs.readFileSync(path.join(__dirname,'../frontend/config/setting.json'),'utf8'));
  settings.ai.provider='ollama'; settings.ai.ollama.baseUrl=`http://127.0.0.1:${model.address().port}`;
  fs.writeFileSync(path.join(profile,'setting.json'),JSON.stringify(settings));
  let hello; const connected=new Promise(resolve=>{hello=resolve;});
  bridge=net.createServer(connection=>{
    socket=connection; let buffer=''; connection.setEncoding('utf8');
    connection.on('data',chunk=>{
      buffer+=chunk;
      while(buffer.includes('\n')) {
        const end=buffer.indexOf('\n'), message=JSON.parse(buffer.slice(0,end)); buffer=buffer.slice(end+1);
        if(message.kind==='hello' && message.token===token) hello();
      }
    });
  });
  await listen(bridge);
  process.env.POKEMON_BRIDGE_PORT=String(bridge.address().port); process.env.POKEMON_BRIDGE_TOKEN=token;
  require('../frontend/build/main/companion/index.js');
  await app.whenReady(); await connected;
  pet=BrowserWindow.getAllWindows()[0];
  await wait(()=>!pet.webContents.isLoadingMainFrame());
  await wait(()=>evaluate('Boolean(window.pokemonAPI)'));
  assert.deepEqual(await evaluate("window.pokemonAPI.chat.history('pikachu')"),[]);
  await evaluate("document.getElementById('pet-container').click();document.getElementById('action-talk').click()");
  await wait(()=>evaluate("document.getElementById('team-panel').dataset.view==='talk'"));
  assert.equal(requests,0,'Opening Talk/history must not contact a model.');
  assert.equal(audit().length,0,'Opening Talk/history must not call native tools.');
  assert.equal(await evaluate("document.getElementById('action-talk').hidden || document.getElementById('action-talk').disabled"),false);
  await evaluate("document.getElementById('chat-input').value='Hello';document.getElementById('chat-form').requestSubmit()");
  await wait(()=>evaluate("document.querySelector('.chat-message.assistant')?.textContent==='Hello from the fixture.'"));
  assert.equal(requests,1);
  assert.equal((await evaluate("window.pokemonAPI.chat.history('pikachu')")).length,2);
  assert.deepEqual(await evaluate("window.pokemonAPI.chat.history('riolu')"),[]);
  const unauthorized=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'../frontend/build/preload/companion.js'),contextIsolation:true}});
  await unauthorized.loadURL('data:text/html,unowned');
  assert.equal((await unauthorized.webContents.executeJavaScript("window.pokemonAPI.chat.send('pikachu','Hello')")).ok,false);
  unauthorized.destroy();
  input=new BrowserWindow({title:'Pokemon Talk Fixture Input',width:650,height:300,webPreferences:{contextIsolation:true,nodeIntegration:false}});
  await input.loadURL('data:text/html,'+encodeURIComponent('<!doctype html><title>Pokemon Talk Fixture Input</title><label>Fixture text<input aria-label="Fixture text"></label><p id="receipt">Received: empty</p><script>document.querySelector("input").oninput=event=>document.getElementById("receipt").textContent="Received: "+event.target.value</script>'));
  input.show();
  // Only the fixture's own pause is changed. The production companion is separate.
  if((await evaluate('window.pokemonAPI.load()')).state.paused) await evaluate('window.pokemonAPI.pause()');
  mode='task';
  assert.deepEqual(await send('Find Pokemon Talk Fixture Input and enter fixture received in Fixture text, then verify the receipt.'),{ok:true,content:'Entered and verified the fixture text.'});
  assert.equal(await input.webContents.executeJavaScript('document.querySelector("input").value'),'fixture received');
  assert.equal(audit().filter(row=>row.name==='windows' && row.args.action==='set_value').length,1);
  mode='pause'; waiting=false;
  const pausedReply=send('Find Pokemon Talk Fixture Input and enter must not arrive in Fixture text.');
  await wait(()=>waiting);
  await evaluate('window.pokemonAPI.pause()'); hold();
  assert.match((await pausedReply).content,/paused/);
  assert.equal(await input.webContents.executeJavaScript('document.querySelector("input").value'),'fixture received');
  assert(audit().some(row=>row.result.paused===true),'The real worker must reject the paused action.');
  console.log(JSON.stringify({ok:true,requests,history_scoped:true,unowned_rejected:true,receipt_verified:true,pause_verified:true,worker_audit:audit()}));
  app.quit();
})().catch(error=>{console.error(error.stack);process.exitCode=1;app.quit();});
app.on('will-quit',()=>{socket?.destroy();bridge?.close();model?.close();model?.closeAllConnections();});
