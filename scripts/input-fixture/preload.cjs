const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('fixture', {
  input: (text) => ipcRenderer.send('fixture:input', text),
  click: () => ipcRenderer.send('fixture:click'),
});
