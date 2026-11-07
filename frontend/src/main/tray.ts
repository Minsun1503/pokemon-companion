import path from 'node:path'
import { app, Menu, nativeImage, Tray } from 'electron'
import type { PetWindowManager } from './window/pet-window-manager'

export function createTray(rootDir: string, windowManager: PetWindowManager): Tray {
  const iconPath = path.join(rootDir, 'assets', 'trayTemplate.png')
  const icon = nativeImage.createFromPath(iconPath)
  icon.setTemplateImage(process.platform === 'darwin')

  const tray = new Tray(icon)
  tray.setToolTip('Pokemon Pet')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '소환',
        click: () => windowManager.recallAtCursor(),
      },
      { type: 'separator' },
      {
        label: 'Pokemon Pet 종료',
        click: () => app.quit(),
      },
    ]),
  )

  return tray
}
