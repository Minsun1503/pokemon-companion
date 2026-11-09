const {app, BrowserWindow, ipcMain, screen} = require('electron');
const http = require('node:http');
const path = require('node:path');
let win;
const state = {text: '', clicks: 0};
if (process.env.POKEMON_INPUT_FIXTURE_DATA) app.setPath('userData', process.env.POKEMON_INPUT_FIXTURE_DATA);
app.whenReady().then(async () => {
  win = new BrowserWindow({width: 600, height: 360, x: 40, y: 40, webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false}});
  ipcMain.on('fixture:input', (_event, text) => { state.text = text; });
  ipcMain.on('fixture:click', () => { state.clicks += 1; });
  await win.loadFile(path.join(__dirname, 'index.html'));
  if (process.env.POKEMON_INPUT_FIXTURE_PASSWORD === '1') {
    await win.webContents.executeJavaScript('const secret = document.createElement("input"); secret.type = "password"; secret.setAttribute("aria-label", "Secret password"); secret.value = "hidden-test-password"; secret.style.top = "280px"; secret.style.width = "150px"; document.body.appendChild(secret);');
  }
  if (process.env.POKEMON_INPUT_FIXTURE_SINGLELINE === '1') {
    await win.webContents.executeJavaScript('const blank = document.createElement("input"); blank.setAttribute("aria-label", "Blank field"); blank.style.top = "260px"; document.body.appendChild(blank);');
  }
  if (process.env.POKEMON_INPUT_FIXTURE_WRAPPERS === '1') {
    // Deep anonymous ARIA groups exercise Chromium wrapper flattening and sibling traversal.
    await win.webContents.executeJavaScript(`
      let container = document.body;
      for (let depth = 0; depth < 35; depth++) {
        const group = document.createElement('div');
        group.setAttribute('role', 'group');
        container.appendChild(group);
        container = group;
      }
      container.appendChild(document.getElementById('note'));
      container.appendChild(document.getElementById('verify'));
    `);
  }
  if (process.env.POKEMON_INPUT_FIXTURE_TITLE) win.setTitle(process.env.POKEMON_INPUT_FIXTURE_TITLE);
  if (process.env.POKEMON_INPUT_FIXTURE_KEYCOUNT === '1') {
    await win.webContents.executeJavaScript('window.__fixtureKeys = {down: 0, up: 0, logical: 0, events: []}; document.getElementById("note").addEventListener("input", () => { window.__fixtureKeys.logical += 1; }); for (const phase of ["down", "up"]) document.addEventListener("key" + phase, event => { window.__fixtureKeys.events.push([phase, event.key, event.code]); window.__fixtureKeys[phase] += 1; if (event.key === "F8") { event.preventDefault(); if (phase === "down") window.__fixtureKeys.logical += 1; } });');
  }
  win.show();
  win.focus();
  const server = http.createServer(async (req, res) => {
    if (req.url === '/focus' && req.method === 'POST') { win.show(); win.focus(); }
    if (req.url === '/quit' && req.method === 'POST') { res.end('{}'); app.quit(); return; }
    const editor = req.url === '/state' ? await win.webContents.executeJavaScript('({text: document.getElementById("note").value, focusedElement: document.activeElement.id, maxLength: document.getElementById("note").maxLength, keys: window.__fixtureKeys})') : {};
    const bounds = win.getContentBounds();
    const position = (x, y) => {
      const point = {x: bounds.x + x, y: bounds.y + y};
      return process.platform === 'win32' ? screen.dipToScreenPoint(point) : point;
    };
    const display = screen.getPrimaryDisplay();
    const size = {width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor)};
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({...state, ...editor, focused: win.isFocused(), input: position(160, 120), button: position(150, 195), size}));
  });
  server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({port: server.address().port})));
  app.on('will-quit', () => server.close());
});
app.on('window-all-closed', () => app.quit());
