const {app, BrowserWindow} = require('electron');
const {createServer} = require('node:http');
const {writeFileSync, mkdirSync} = require('node:fs');
const {dirname} = require('node:path');
app.setPath('userData', process.env.POKEMON_FIXTURE_PROFILE);
if (process.env.POKEMON_FIXTURE_CDP === 'on') app.commandLine.appendSwitch('remote-debugging-port', '0');
app.commandLine.appendSwitch('force-renderer-accessibility');
let version = 1, apiEnabled = true, window;
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.method === 'POST' && request.url === '/test/update') {version = 2; response.end('{}'); return;}
  if (request.method === 'POST' && request.url === '/test/disable-api') {apiEnabled = false; response.end('{}'); return;}
  if (request.method === 'POST' && request.url === '/test/noise') {
    window.webContents.executeJavaScript(`(() => {
      document.body.innerHTML = '<canvas></canvas>';
      document.body.style.cssText = 'margin:0;padding:0;overflow:hidden';
      const canvas = document.querySelector('canvas'); canvas.width = innerWidth; canvas.height = innerHeight;
      const context = canvas.getContext('2d'), pixels = context.createImageData(canvas.width, canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {pixels.data[i] = Math.random() * 256; pixels.data[i + 1] = Math.random() * 256; pixels.data[i + 2] = Math.random() * 256; pixels.data[i + 3] = 255;}
      context.putImageData(pixels, 0, 0);
    })()`).then(() => response.end('{}')).catch(error => {response.statusCode = 500; response.end(JSON.stringify({error: error.message}));});
    return;
  }
  if (request.method === 'POST' && request.url === '/test/quit') {response.end('{}'); setTimeout(() => app.quit(), 50); return;}
  if (apiEnabled && request.url === '/openapi.json') {
    response.end(JSON.stringify({openapi: '3.0.0', paths: {[`/v${version}/messages`]: {get: {operationId: 'readMessages', responses: {
      '200': {content: {'application/json': {schema: {type: 'object', required: [version === 1 ? 'messages' : 'items']}}}},
    }}}}})); return;
  }
  if (apiEnabled && request.url === `/v${version}/messages`) {response.end(JSON.stringify(version === 1 ? {messages: ['hello']} : {items: ['updated']})); return;}
  if (request.url === '/desktop') {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<title>${process.env.POKEMON_FIXTURE_TITLE}</title><body style="background:#102d45;color:white;font:24px Segoe UI;padding:50px"><h1>Desktop adapter fixture</h1><label for="messages">Messages</label><input id="messages" value="Desktop content"><button>Refresh</button></body>`); return;
  }
  response.statusCode = 404; response.end('{}');
});
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  window = new BrowserWindow({width: 900, height: 650, title: process.env.POKEMON_FIXTURE_TITLE, webPreferences: {nodeIntegration: false, contextIsolation: true}});
  await window.loadURL(endpoint + '/desktop');
  window.setTitle(process.env.POKEMON_FIXTURE_TITLE);
  window.showInactive();
  mkdirSync(dirname(process.env.POKEMON_FIXTURE_STATE), {recursive: true});
  writeFileSync(process.env.POKEMON_FIXTURE_STATE, JSON.stringify({endpoint, pid: process.pid, title: window.getTitle(), visible: window.isVisible()}));
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => server.close());
