const {app, BrowserWindow, Menu, screen} = require('electron');
const http = require('node:http');
let template = [];
const buildMenu = Menu.buildFromTemplate;
Menu.buildFromTemplate = items => {if (items.some(item => item.label === 'Summon at cursor')) template = items; return buildMenu(items);};
require('../frontend/build/main/companion/index.js');
const pets = () => BrowserWindow.getAllWindows().filter(win => win.displayId !== undefined);
let backdrop, server;
app.whenReady().then(async () => {
  const display = screen.getPrimaryDisplay();
  backdrop = new BrowserWindow({...display.bounds, frame: false, alwaysOnTop: true, backgroundColor: '#38679d', show: false, webPreferences: {contextIsolation: true, nodeIntegration: false}});
  await backdrop.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><html style="background:#38679d"><body style="margin:0;min-height:100vh;background:#38679d"></body></html>'));
  backdrop.show();
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/protect') for (const win of pets()) win.setContentProtection(url.searchParams.get('enabled') === '1');
      if (url.pathname === '/summon') template.find(item => item.label === 'Summon at cursor').click();
      if (url.pathname === '/sentinel') {
        for (const win of pets()) await win.webContents.executeJavaScript(`(() => {
          let marker = document.getElementById('capture-sentinel');
          if (!marker) {
            marker = document.createElement('span'); marker.id = 'capture-sentinel';
            marker.style.cssText = 'position:absolute;left:25px;top:30px;width:50px;height:50px;background:#12e4a7;z-index:9999;pointer-events:none';
            document.getElementById('pet-container').append(marker);
          }
        })()`);
      }
      if (url.pathname === '/quit') {res.end('{}'); app.quit(); return;}
      const windows = [];
      for (const win of pets()) {
        const marker = await win.webContents.executeJavaScript(`(() => {
          const marker = document.getElementById('capture-sentinel');
          if (!marker) return null;
          const rect = marker.getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
        })()`);
        const bounds = win.getBounds();
        windows.push({handle: win.getNativeWindowHandle().readBigUInt64LE().toString(), visible: win.isVisible(), protected: win.isContentProtected(), marker: marker && screen.dipToScreenPoint({x:bounds.x+Math.round(marker.x),y:bounds.y+Math.round(marker.y)})});
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({windows, display: {width: Math.round(display.size.width*display.scaleFactor),height: Math.round(display.size.height*display.scaleFactor)}, electron: process.versions.electron}));
    } catch (error) {res.statusCode=500;res.end(JSON.stringify({error:error.message}));}
  });
  server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({port:server.address().port})));
});
app.on('will-quit', () => server?.close());
