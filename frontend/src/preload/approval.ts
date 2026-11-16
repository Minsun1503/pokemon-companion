import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('approvalUI', {
  load: () => ipcRenderer.invoke('approval:load'),
  decide: (choice: boolean | 'deny') => ipcRenderer.invoke('approval:decide', choice),
})
