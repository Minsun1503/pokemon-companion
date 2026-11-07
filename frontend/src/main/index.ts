import fs from 'node:fs'
import path from 'node:path'
import type { Tray } from 'electron'
import { app, dialog, globalShortcut, screen } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ChatMessage, PetProfile, Settings } from '../types'
import { ProviderRegistry } from './ai/provider-registry'
import { AnthropicProvider } from './ai/providers/anthropic-provider'
import { GeminiProvider } from './ai/providers/gemini-provider'
import { OllamaProvider } from './ai/providers/ollama-provider'
import { OpenAIProvider } from './ai/providers/openai-provider'
import { registerIpc } from './ipc/register-ipc'
import { PetRegistry } from './services/pet-registry'
import { PetScopedStore } from './services/pet-scoped-store'
import { seedUserPets } from './services/seed-user-pets'
import { createTray } from './tray'
import { PetWindowManager } from './window/pet-window-manager'

let windowManager: PetWindowManager | null = null
let tray: Tray | null = null

function resolveDevelopmentPetId(userPetsDir: string): string | null {
  if (app.isPackaged) {
    return null
  }

  const petIds = fs
    .readdirSync(userPetsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  const petIdSet = new Set(petIds)
  const args = process.argv.slice(2)
  const petArg =
    args.find((arg) => petIdSet.has(arg)) ??
    args.find((arg) => arg.startsWith('--pet='))?.slice('--pet='.length) ??
    args.find((arg) => arg.startsWith('--') && petIdSet.has(arg.slice(2)))?.slice(2) ??
    process.env.npm_config_pet ??
    petIds.find((petId) => process.env[`npm_config_${petId}`] === 'true')

  if (!petArg) {
    return null
  }
  if (!petIdSet.has(petArg)) {
    console.warn(`Unknown pet "${petArg}". Available pets: ${petIds.join(', ')}`)
    return null
  }
  return petArg
}

function loadEnvironment(rootDir: string): void {
  const loadEnvFile = (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile
  if (typeof loadEnvFile !== 'function') {
    return
  }
  for (const envPath of [path.join(rootDir, '.env'), path.join(app.getPath('userData'), '.env')]) {
    try {
      loadEnvFile(envPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('second-instance', () => {
  if (windowManager) {
    windowManager.showActive()
  }
})

app
  .whenReady()
  .then(() => {
    const rootDir = path.resolve(__dirname, '../..')
    loadEnvironment(rootDir)

    const userSettingPath = path.join(app.getPath('userData'), 'setting.json')
    if (!fs.existsSync(userSettingPath)) {
      fs.copyFileSync(path.join(rootDir, 'config/setting.json'), userSettingPath)
    }
    const settings = JSON.parse(fs.readFileSync(userSettingPath, 'utf8')) as Settings
    const bundledPetsDir = path.join(rootDir, 'pets')
    const userPetsDir = path.join(app.getPath('userData'), 'pets')
    const petsDir = app.isPackaged ? userPetsDir : bundledPetsDir
    if (app.isPackaged) {
      seedUserPets(bundledPetsDir, userPetsDir)
    }
    const activePet = resolveDevelopmentPetId(petsDir) ?? settings.pet.active
    const runtimeSettings: Settings = {
      ...settings,
      pet: { ...settings.pet, active: activePet },
    }

    const historyStore = new PetScopedStore<ChatMessage[]>(
      path.join(app.getPath('userData'), 'chat_history.json'),
      runtimeSettings.pet.active,
      [],
      (value): value is ChatMessage[] => Array.isArray(value),
    )
    const profileStore = new PetScopedStore<PetProfile>(
      path.join(app.getPath('userData'), 'pet_profile.json'),
      runtimeSettings.pet.active,
      {},
      (value): value is PetProfile =>
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        ('nickname' in value || Object.keys(value).length === 0),
    )
    const petRegistry = new PetRegistry(petsDir)
    const providerRegistry = new ProviderRegistry()

    providerRegistry.register(new OllamaProvider(runtimeSettings.ai.ollama))
    providerRegistry.register(new OpenAIProvider(runtimeSettings.ai.openai))
    providerRegistry.register(new AnthropicProvider(runtimeSettings.ai.anthropic))
    providerRegistry.register(new GeminiProvider(runtimeSettings.ai.gemini))

    if (process.platform === 'darwin') {
      app.dock?.hide()
    }
    windowManager = new PetWindowManager(rootDir, path.join(rootDir, 'build/preload/index.js'))
    windowManager.createAll()
    tray = createTray(rootDir, windowManager)

    registerIpc({
      windowManager,
      historyStore,
      profileStore,
      petRegistry,
      providerRegistry,
      settings: runtimeSettings,
      settingsPath: userSettingPath,
    })

    autoUpdater.checkForUpdatesAndNotify()

    globalShortcut.register('CommandOrControl+Shift+R', () => {
      if (windowManager) {
        windowManager.recallAtCursor()
      }
    })

    const syncWindows = (): void => {
      if (windowManager) {
        windowManager.syncDisplays()
      }
    }
    screen.on('display-added', syncWindows)
    screen.on('display-removed', syncWindows)
    screen.on('display-metrics-changed', syncWindows)
  })
  .catch((error) => {
    dialog.showErrorBox('초기화 실패', String(error?.stack ?? error))
    app.quit()
  })

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => {
  tray?.destroy()
  tray = null
  globalShortcut.unregisterAll()
  if (windowManager) {
    windowManager.destroyAll()
  }
})
