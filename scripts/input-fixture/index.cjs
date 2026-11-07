const {app, BrowserWindow, ipcMain, screen} = require('electron');
const http = require('node:http');
const path = require('node:path');
let win;
const state = {text: '', clicks: 0};
app.whenReady().then(async () => {
  win = new BrowserWindow({width: 600, height: 360, x: 40, y: 40, webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false}});
  ipcMain.on('fixture:input', (_event, text) => { state.text = text; });
  ipcMain.on('fixture:click', () => { state.clicks += 1; });
  await win.loadFile(path.join(__dirname, 'index.html'));
  if (process.env.POKEMON_INPUT_FIXTURE_TITLE) win.setTitle(process.env.POKEMON_INPUT_FIXTURE_TITLE);
  win.show();
  win.focus();
  const server = http.createServer((req, res) => {
    if (req.url === '/focus' && req.method === 'POST') { win.show(); win.focus(); }
    if (req.url === '/quit' && req.method === 'POST') { res.end('{}'); app.quit(); return; }
    const bounds = win.getContentBounds();
    const position = (x, y) => {
      const point = {x: bounds.x + x, y: bounds.y + y};
      return process.platform === 'win32' ? screen.dipToScreenPoint(point) : point;
    };
    const display = screen.getPrimaryDisplay();
    const size = {width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor)};
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({...state, focused: win.isFocused(), input: position(160, 120), button: position(150, 195), size}));
  });
  server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({port: server.address().port})));
  app.on('will-quit', () => server.close());
});
app.on('window-all-closed', () => app.quit());
