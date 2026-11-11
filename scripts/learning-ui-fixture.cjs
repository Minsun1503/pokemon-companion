// Owned integration harness. Production renderer, preload and companion main remain in use.
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
require(path.join(process.env.POKEMON_TEST_REPO, 'frontend/build/main/companion/index.js'));
let timer, busy = false;
app.whenReady().then(() => {
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    const directory = process.env.POKEMON_TEST_DATA;
    try {
      let request;
      try { request = JSON.parse(await fs.readFile(path.join(directory, 'command.json'), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      await fs.unlink(path.join(directory, 'command.json'));
      const win = BrowserWindow.getAllWindows().find(item => item.isVisible()) || BrowserWindow.getAllWindows()[0];
      if (!win || win.webContents.isLoading()) throw new Error('Renderer not ready.');
      if (request.action === 'open') await win.webContents.executeJavaScript('document.getElementById("pet-container").click()');
      else if (request.action === 'feedback') {
        if (!['good', 'bad'].includes(request.value)) throw new Error('Invalid fixture feedback');
        await win.webContents.executeJavaScript(`document.getElementById("feedback-${request.value}").click()`);
      } else if (request.action === 'frame') {
        const rect = await win.webContents.executeJavaScript('(() => {const r=document.getElementById("team-panel").getBoundingClientRect();return {x:Math.max(0,Math.floor(r.x)),y:Math.max(0,Math.floor(r.y)),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()');
        await fs.writeFile(path.join(directory, 'feedback.png'), (await win.webContents.capturePage(rect)).toPNG());
      } else if (request.action !== 'state') throw new Error('Unknown fixture command');
      const state = await win.webContents.executeJavaScript('({panel:!document.getElementById("team-panel").hidden,feedback:!document.getElementById("learning-feedback").hidden,status:document.getElementById("feedback-status").textContent,goodDisabled:document.getElementById("feedback-good").disabled,sprite:document.getElementById("pet-image").src})');
      await fs.writeFile(path.join(directory, 'response.json'), JSON.stringify({id:request.id,state,metrics:app.getAppMetrics(),gpu:app.getGPUFeatureStatus()}));
    } catch (error) {
      await fs.writeFile(path.join(directory, 'response.json'), JSON.stringify({error:error.message}));
    } finally { busy = false; }
  }, 100);
});
app.on('will-quit', () => clearInterval(timer));
