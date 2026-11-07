import fs from 'node:fs'
import { app, clipboard, ipcMain } from 'electron'
import type { ChatMessage, DragOffset, PetProfile, Settings } from '../../types'
import type { ProviderRegistry } from '../ai/provider-registry'
import type { PetRegistry } from '../services/pet-registry'
import type { PetScopedStore } from '../services/pet-scoped-store'
import type { PetWindowManager } from '../window/pet-window-manager'

export function registerIpc({
  windowManager,
  historyStore,
  profileStore,
  petRegistry,
  providerRegistry,
  settings,
  settingsPath,
}: {
  windowManager: PetWindowManager
  historyStore: PetScopedStore<ChatMessage[]>
  profileStore: PetScopedStore<PetProfile>
  petRegistry: PetRegistry
  providerRegistry: ProviderRegistry
  settings: Settings
  settingsPath: string
}): void {
  ipcMain.on('clipboard:write', (_event, text: unknown) => {
    if (typeof text === 'string') {
      clipboard.writeText(text)
    }
  })
  ipcMain.on('window:set-ignore-mouse', (event, ignore: boolean) => {
    windowManager.setIgnoreMouseForSender(event.sender, ignore)
  })
  ipcMain.on('pet:recall', () => {
    windowManager.recallAtCursor()
  })
  ipcMain.on('pet:chat-state', (event, payload: { open: boolean; width?: number; height?: number }) => {
    const win = windowManager.getWindowForSender(event.sender)
    if (win) {
      windowManager.setChatState(win.displayId, payload.open, payload.width, payload.height)
    }
  })
  ipcMain.on('pet:drag-start', (event, offset: DragOffset) => {
    windowManager.startDrag(event.sender, offset)
  })
  ipcMain.on('pet:drag-stop', () => {
    windowManager.stopDrag()
  })

  ipcMain.handle('history:load', () => historyStore.read())
  ipcMain.handle('history:save', (event, history: ChatMessage[]) => {
    const savedHistory = Array.isArray(history) ? history : []
    const saved = historyStore.write(savedHistory)
    if (saved) {
      windowManager.broadcastExcept('history:updated', { history: savedHistory }, event.sender)
    }
    return saved
  })
  ipcMain.handle('pet:load-active', () => petRegistry.load(settings.pet.active))
  ipcMain.handle('pet:list', () => petRegistry.list())
  ipcMain.handle('pet:switch-active', (_event, petId: unknown) => {
    const availablePets = petRegistry.list()
    if (typeof petId !== 'string' || !availablePets.some((pet) => pet.id === petId)) {
      return false
    }
    if (petId === settings.pet.active) {
      return true
    }

    settings.pet.active = petId
    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
    setTimeout(() => {
      const petIds = new Set(availablePets.map((pet) => pet.id))
      const args = process.argv
        .slice(1)
        .filter(
          (arg) => !petIds.has(arg) && !arg.startsWith('--pet=') && !(arg.startsWith('--') && petIds.has(arg.slice(2))),
        )
      app.relaunch({ args })
      app.exit(0)
    }, 100)
    return true
  })
  ipcMain.handle('pet:profile-load', () => profileStore.read())
  ipcMain.handle('pet:nickname-save', (_event, nickname: unknown) => {
    const profile = profileStore.read()
    const sanitized = typeof nickname === 'string' ? nickname.trim().slice(0, 20) : ''
    return profileStore.write({ ...profile, nickname: sanitized })
  })
  ipcMain.handle('settings:load', () => settings)

  ipcMain.on('chat:pending', (event, pending: boolean) => {
    windowManager.broadcastExcept('chat:pending-changed', { pending: Boolean(pending) }, event.sender)
  })

  ipcMain.on(
    'chat:stream',
    async (
      event,
      payload: {
        requestId: string
        provider: string
        model: string
        messages: ChatMessage[]
      },
    ) => {
      const requestId = payload?.requestId
      try {
        const providerId = payload.provider || settings.ai.provider
        const provider = providerRegistry.get(providerId)
        await provider.streamChat(payload, {
          onChunk: (chunk) => {
            event.sender.send('chat:chunk', { requestId, chunk })
          },
        })
        event.sender.send('chat:done', { requestId })
      } catch (error) {
        event.sender.send('chat:error', {
          requestId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  )
}
