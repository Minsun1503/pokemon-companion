import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('movieWindowAPI', {
  minimize: () => ipcRenderer.send('movies:minimize'),
  close: () => ipcRenderer.send('movies:close'),
  hideLibrary: () => ipcRenderer.send('movies:hide-library'),
  toggleAlwaysOnTop: () => ipcRenderer.send('movies:toggle-top'),
})
