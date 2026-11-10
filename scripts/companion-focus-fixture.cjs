const {app, BrowserWindow, screen} = require('electron');
const {randomBytes, createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const token = randomBytes(32).toString('hex');
app.setPath('userData', process.env.POKEMON_FOCUS_FIXTURE_DATA);
let socket, server, input, sequence = 0;
const pending = new Map();
let hello;
const connected = new Promise(resolve => { hello = resolve; });
const bridge = net.createServer(connection => {
  socket = connection;
  let buffer = '';
  connection.setEncoding('utf8');
  connection.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.kind === 'hello' && message.token === token) hello();
      if (message.kind === 'ack') {
        const item = pending.get(message.id);
        pending.delete(message.id);
        message.error ? item.reject(new Error(message.error)) : item.resolve();
      }
    }
  });
});
const send = fields => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, {resolve, reject});
  socket.write(JSON.stringify({id, kind: 'state', ...fields}) + '\n');
});
bridge.listen(0, '127.0.0.1', async () => {
  process.env.POKEMON_BRIDGE_PORT = String(bridge.address().port);
  process.env.POKEMON_BRIDGE_TOKEN = token;
  require('../frontend/build/main/companion/index.js');
  await app.whenReady();
  await connected;
  const pet = BrowserWindow.getAllWindows().find(win => win.displayId === screen.getPrimaryDisplay().id);
  pet.setTitle('Pokemon Focus Overlay');
  input = new BrowserWindow({...screen.getPrimaryDisplay().workArea, frame: false, title: 'Pokemon Focus Input', webPreferences: {contextIsolation: true, nodeIntegration: false}});
  await input.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><title>Pokemon Focus Input</title><button id="test" aria-label="Background button" style="margin:50px;width:180px;height:60px">Background button</button><script>window.keys=0;window.clicks=0;document.addEventListener("keydown",e=>{if(e.key==="F8"){e.preventDefault();keys++}});document.getElementById("test").onclick=()=>clicks++;</script>'));
  input.setTitle('Pokemon Focus Input');
  input.show();
  input.focus();
  const state = {pet: 'pikachu', activity: 'working', message: 'Focus regression test', task: 'Test', visible: true, paused: false, completedActions: 0};
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/action') {
        const selected = url.searchParams.get('pet');
        if (selected) {
          if (!['pikachu', 'riolu', 'lucario', 'clodsire', 'bulbasaur', 'charmander', 'squirtle'].includes(selected))
            throw new Error('Unknown fixture Pokémon.');
          state.pet = selected;
        }
        const name = url.searchParams.get('name');
        if (!['type', 'key', 'set_value', 'left_click', 'invoke', 'get_ui', 'idle', 'success', 'error'].includes(name))
          throw new Error('Unknown fixture action.');
        const animation = ['type', 'key', 'set_value'].includes(name) ? 'typing'
          : ['left_click', 'invoke'].includes(name) ? 'clicking' : name === 'get_ui' ? 'thinking' : undefined;
        const coordinate = url.searchParams.has('x') && url.searchParams.has('y')
          ? screen.dipToScreenPoint({x:Number(url.searchParams.get('x')), y:Number(url.searchParams.get('y'))}) : undefined;
        await send({state: {...state, activity: ['idle', 'success', 'error'].includes(name) ? name : url.searchParams.get('finished') === '1' ? 'idle' : name === 'get_ui' ? 'thinking' : 'working',
          action: animation ? {animation, id:sequence + 1, active:url.searchParams.get('busy') === '1'} : undefined},
          ...(coordinate ? {coordinate:[coordinate.x, coordinate.y]} : {})});
      }
      if (url.pathname === '/frame') {
        if (url.searchParams.get('freezeProps') !== '0')
          await pet.webContents.executeJavaScript('document.getElementById("work-prop").style.animation="none";document.querySelector(".pet-aura").style.animation="none";');
        const bounds = await pet.webContents.executeJavaScript('(() => {const r=document.getElementById("pet-container").getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()');
        const png = (await pet.webContents.capturePage(bounds)).toPNG();
        const output = path.join(process.env.POKEMON_FOCUS_FIXTURE_DATA, 'animation-frame.png');
        await fs.writeFile(output, png);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({hash:createHash('sha256').update(png).digest('hex'),path:output}));
        return;
      }
      if (url.pathname === '/move') {
        const point = screen.dipToScreenPoint({x: Number(url.searchParams.get('x')), y: Number(url.searchParams.get('y'))});
        await send({state, coordinate: [point.x, point.y]});
      }
      if (url.pathname === '/cover-bubble') {
        await send({state: {...state, activity: 'thinking'}});
        let previous, stable = 0;
        for (let read = 0; stable < 2 && read < 50; read += 1) {
          const x = await pet.webContents.executeJavaScript('document.getElementById("pet-container").getBoundingClientRect().x');
          stable = x === previous ? stable + 1 : 0;
          previous = x;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (stable < 2) throw new Error('Pet did not finish its target movement.');
        const bubble = await pet.webContents.executeJavaScript('(() => {const r=document.getElementById("bubble").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width};})()');
        if (!bubble.width) throw new Error('A visible speech bubble is required.');
        const petBounds = pet.getBounds(), inputBounds = input.getContentBounds();
        await input.webContents.executeJavaScript(`Object.assign(document.getElementById("test").style,{position:"absolute",margin:"0",left:"${petBounds.x + bubble.x - inputBounds.x - 90}px",top:"${petBounds.y + bubble.y - inputBounds.y - 30}px"})`);
      }
      if (url.pathname === '/quit') {res.end('{}'); app.quit(); return;}
      const counts = await input.webContents.executeJavaScript('(() => {const r=document.getElementById("test").getBoundingClientRect();return {keys,clicks,point:{x:r.x+r.width/2,y:r.y+r.height/2}}})()');
      const petState = await pet.webContents.executeJavaScript('({pet:document.body.dataset.pet,x:document.getElementById("pet-container").getBoundingClientRect().x,y:document.getElementById("pet-container").getBoundingClientRect().y,panel:!document.getElementById("team-panel").hidden,text:document.getElementById("chat-input").value,animation:document.getElementById("pet-container").dataset.animation,source:document.getElementById("pet-image").src,imageReady:document.getElementById("pet-image").complete&&document.getElementById("pet-image").naturalWidth>0,keyboard:getComputedStyle(document.getElementById("work-prop")).display!=="none",mouse:getComputedStyle(document.getElementById("mouse-prop")).display!=="none",scanning:getComputedStyle(document.getElementById("scan-prop")).display!=="none",badge:document.getElementById("state-badge").textContent})');
      const bounds = input.getContentBounds();
      const point = screen.dipToScreenPoint({x: Math.round(bounds.x + counts.point.x), y: Math.round(bounds.y + counts.point.y)});
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({...counts, ...petState, focused: input.isFocused(), petFocused: pet.isFocused(), petFocusable: pet.isFocusable(), point}));
    } catch (error) {res.statusCode = 500; res.end(JSON.stringify({error: error.message}));}
  });
  server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({port: server.address().port})));
});
app.on('will-quit', () => {server?.close(); socket?.destroy(); bridge.close();});
