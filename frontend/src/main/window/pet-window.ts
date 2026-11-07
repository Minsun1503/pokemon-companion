import path from 'node:path'
import type { Display } from 'electron'
import { BrowserWindow } from 'electron'

export type PetWindow = BrowserWindow & { displayId: number }

export function createPetWindow({
  rootDir,
  preloadPath,
  display,
  active,
  rendererFile = 'index.html',
}: {
  rootDir: string
  preloadPath: string
  display: Display
  active: boolean
  rendererFile?: string
}): PetWindow {
  const area = display.workArea
  const spawnX = Math.round(area.width / 2)
  const spawnY = area.height - 160
  const win = new BrowserWindow({
    width: area.width,
    height: area.height,
    x: area.x,
    y: area.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
  }) as PetWindow

  win.displayId = display.id
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(true, { forward: true })
  win.once('ready-to-show', () => win.showInactive())
  win.loadFile(path.join(rootDir, 'build/renderer', rendererFile), {
    query: {
      displayId: String(display.id),
      active: String(active),
      spawnX: String(spawnX),
      spawnY: String(spawnY),
    },
  })

  return win
}
