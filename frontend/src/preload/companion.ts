import { contextBridge, ipcRenderer } from 'electron'
import type { CompanionSnapshot } from '../types/companion'

contextBridge.exposeInMainWorld('pokemonAPI', {
  load: () => ipcRenderer.invoke('companion:load'),
  list: () => ipcRenderer.invoke('companion:list'),
  select: (pet: string) => ipcRenderer.invoke('companion:select', pet),
  pause: () => ipcRenderer.invoke('companion:pause'),
  movement: (allowed: boolean) => ipcRenderer.invoke('companion:movement', allowed),
  dragStart: (offset: { x: number; y: number }) => ipcRenderer.send('companion:drag-start', offset),
  dragStop: () => ipcRenderer.send('companion:drag-stop'),
  onDragPosition: (listener: (position: { x: number; y: number }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, position: { x: number; y: number }) => listener(position)
    ipcRenderer.on('companion:drag-position', wrapped)
    return () => ipcRenderer.removeListener('companion:drag-position', wrapped)
  },
  feedback: (satisfaction: 'satisfied' | 'unsatisfied') => ipcRenderer.invoke('companion:feedback', satisfaction),
  quit: () => ipcRenderer.send('companion:quit'),
  panel: (open: boolean) => ipcRenderer.send('companion:panel', open),
  chat: {
    history: (pet: string) => ipcRenderer.invoke('companion:chat-history', pet),
    send: (pet: string, text: string) => ipcRenderer.invoke('companion:chat-send', pet, text),
  },
  ignoreMouse: (ignore: boolean) => ipcRenderer.send('companion:ignore-mouse', ignore),
  regions: (regions: { x: number; y: number; width: number; height: number; interactive: boolean }[]) =>
    ipcRenderer.send('companion:regions', regions),
  onState: (listener: (snapshot: CompanionSnapshot) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, snapshot: CompanionSnapshot) => listener(snapshot)
    ipcRenderer.on('companion:state', wrapped)
    return () => ipcRenderer.removeListener('companion:state', wrapped)
  },
})
