const {app, BrowserWindow} = require('electron');
const http = require('node:http');
let clicks = 0;
app.setPath('userData', process.argv[2]);
app.whenReady().then(async () => {
  const window = new BrowserWindow({width: 620, height: 520, show: false, webPreferences: {nodeIntegration: false, contextIsolation: true}});
  await window.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><title>' + process.argv[3] + '</title><input id="editor" aria-label="Editable field" value="initial"><button id="action" aria-label="Original item">Item</button><section aria-label="Nested region"><input aria-label="Nested field" value="nested"></section>'));
  await window.webContents.executeJavaScript('window.fixtureClicks = 0; document.getElementById("action").addEventListener("click", () => {window.fixtureClicks++;});');
  await window.webContents.executeJavaScript('const other = document.createElement("section"); other.setAttribute("role", "group"); other.setAttribute("aria-label", "Other region"); for (let i = 0; i < 30; i++) {const field = document.createElement("input"); field.id = "other" + i; field.setAttribute("aria-label", "Other field " + i); field.value = "unrelated value " + i; field.style.width = "90px"; other.appendChild(field);} document.body.appendChild(other);');
  window.showInactive();
  const server = http.createServer(async (request, response) => {
    try {
      if (request.url === '/rename') await window.webContents.executeJavaScript('document.getElementById("action").setAttribute("aria-label", "Replacement item")');
      if (request.url === '/value') await window.webContents.executeJavaScript('document.getElementById("editor").value = "changed outside automation"');
      if (request.url === '/twin') await window.webContents.executeJavaScript('const twin = document.getElementById("action").cloneNode(true); twin.addEventListener("click", () => {window.fixtureClicks++;}); document.body.appendChild(twin);');
      if (request.url === '/title') await window.webContents.executeJavaScript('document.title += " changed"');
      if (request.url === '/hide') await window.webContents.executeJavaScript('document.getElementById("action").hidden = true');
      if (request.url === '/show') await window.webContents.executeJavaScript('document.getElementById("action").hidden = false');
      // Chromium does not reliably invalidate AutomationId for an in-place ID
      // edit. Replace the fixture node so the changed provider identity is real.
      if (['/automation-id', '/role', '/identity-reset'].includes(request.url)) {
        await window.webContents.executeJavaScript('(() => {const previous = document.querySelector("button"); const target = previous.cloneNode(true); target.id = ' + JSON.stringify(request.url === '/automation-id' ? 'replacement-action' : 'action') + '; target.removeAttribute("role"); ' + (request.url === '/role' ? 'target.setAttribute("role", "checkbox"); ' : '') + 'target.addEventListener("click", () => {window.fixtureClicks++;}); previous.replaceWith(target);})()');
      }
      if (request.url === '/quit') {response.end('{}'); app.quit(); return;}
      const state = await window.webContents.executeJavaScript('({clicks: window.fixtureClicks, text: document.getElementById("editor").value, nested: document.querySelector("section input").value, name: document.querySelector("button").getAttribute("aria-label")})');
      clicks = state.clicks;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(state));
    } catch (error) {response.statusCode = 500; response.end(JSON.stringify({error: error.message, clicks}));}
  });
  server.listen(0, '127.0.0.1', () => process.stdout.write(JSON.stringify({port: server.address().port}) + '\n'));
  app.on('will-quit', () => server.close());
});
app.on('window-all-closed', () => app.quit());
