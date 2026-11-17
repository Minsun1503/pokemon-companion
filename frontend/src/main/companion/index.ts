import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron'
import express from 'express'
import { createServer, type Server } from 'node:http'
import type { CompanionSnapshot, CompanionState } from '../../types/companion'
import { PetRegistry } from '../services/pet-registry'
import { createPetWindow, type PetWindow } from '../window/pet-window'
import { CompanionAgentTools } from './agent'
import { CompanionApprovals } from './approval'
import { CompanionChat } from './chat'
import { registerCompanionChat } from './chat-ipc'
import { CompanionRecordingBridge } from './recording-ipc'
import { createApiRouter } from '../../renderer/movies/server/apiRouter'

app.setName('pokemon-mcp')
if (process.env.POKEMON_USER_DATA_DIR) {
  const profileDirectory = path.resolve(process.env.POKEMON_USER_DATA_DIR)
  mkdirSync(profileDirectory, { recursive: true })
  app.setPath('userData', profileDirectory)
}
const rootDir = path.resolve(__dirname, '../../..')
const registry = new PetRegistry(path.join(rootDir, 'pets'))
const windows = new Map<number, PetWindow>()
const movieWindows = new Set<BrowserWindow>()
let movieLibraryWindow: BrowserWindow | undefined
let movieServer: Server | undefined
let moviePort = 0
let activeDisplayId: number
let tray: Tray
let socket: net.Socket
const recorder = new CompanionRecordingBridge((value) => {
  if (!socket || socket.destroyed) return false
  send(value)
  return true
})
let capturing = false
let refreshQueued = false
let paused = false
let chatTools: CompanionAgentTools | undefined
let clipboardBackup: Electron.Data | undefined
let approvals: CompanionApprovals | undefined
const protectionWaits = new Map<
  number,
  { resolve: (protectedWindow: boolean) => void; timer: ReturnType<typeof setTimeout> }
>()
let protectionSequence = 0
let pastedText: string | undefined
let target: { x: number; y: number } | undefined
let movementAllowed = true
let idleAnimation = process.env.POKEMON_IDLE_ANIMATION === 'on'
let placed: { displayId: number; x: number; y: number } | undefined
let dragOwner: PetWindow | undefined
let dragTimer: ReturnType<typeof setInterval> | undefined
let dragOffset = { x: 0, y: 0 }
const preferencesPath = path.join(app.getPath('userData'), 'companion-preferences.json')

function savePreferences(): void {
  mkdirSync(path.dirname(preferencesPath), { recursive: true })
  const temporary = `${preferencesPath}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify({ movementAllowed, idleAnimation, placed })}\n`)
  renameSync(temporary, preferencesPath)
}

function updateMovementAllowed(allowed: boolean): boolean {
  const previous = { movementAllowed, idleAnimation }
  movementAllowed = allowed
  idleAnimation = allowed
  try {
    savePreferences()
  } catch (error) {
    movementAllowed = previous.movementAllowed
    idleAnimation = previous.idleAnimation
    console.error(error)
    return false
  }
  target = undefined
  refresh()
  return true
}

function stopDrag(): void {
  if (!dragOwner) return
  clearInterval(dragTimer)
  dragTimer = undefined
  dragOwner = undefined
  for (const win of windows.values()) {
    shapeCache.delete(win.id)
    if (!win.isDestroyed()) win.setIgnoreMouseEvents(true, { forward: true })
  }
  try {
    savePreferences()
  } catch (error) {
    console.error(error)
  }
  refresh()
}

function updateDragPosition(): void {
  if (!dragOwner || dragOwner.isDestroyed() || capturing || !state.visible) {
    stopDrag()
    return
  }
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const win = windows.get(display.id)
  if (!win || win.isDestroyed()) return
  const bounds = win.getBounds()
  const previousPlaced = placed
  placed = {
    displayId: display.id,
    x: Math.max(0, Math.min(bounds.width - 100, cursor.x - bounds.x - dragOffset.x)),
    y: Math.max(0, Math.min(bounds.height - 118, cursor.y - bounds.y - dragOffset.y)),
  }
  const changedDisplay = activeDisplayId !== display.id
  activeDisplayId = display.id
  if (
    !changedDisplay &&
    previousPlaced?.displayId === placed.displayId &&
    previousPlaced.x === placed.x &&
    previousPlaced.y === placed.y
  )
    return
  // Keep the captured source window alive across monitor handoff. The target
  // paints freely but remains click-through until the source releases capture.
  if (process.platform === 'win32' && shapeCache.get(win.id) !== 'drag') {
    win.setShape([{ x: 0, y: 0, width: bounds.width, height: bounds.height }])
    shapeCache.set(win.id, 'drag')
  }
  if (win !== dragOwner) win.setIgnoreMouseEvents(true, { forward: true })
  if (changedDisplay) refresh()
  else win.webContents.send('companion:drag-position', { x: placed.x, y: placed.y })
}
let state: CompanionState = {
  pet: 'pikachu',
  activity: 'idle',
  message: 'Ready when you are!',
  task: '',
  visible: true,
  paused: false,
  completedActions: 0,
}
let feedbackSequence = 0
const pendingFeedback = new Map<number, { resolve: (saved: boolean) => void; timer: ReturnType<typeof setTimeout> }>()
const shapeCache = new Map<number, string>()
let trayKey = ''

function openMovieWindow(): void {
  if (movieLibraryWindow && !movieLibraryWindow.isDestroyed()) {
    if (movieLibraryWindow.isMinimized()) movieLibraryWindow.restore()
    movieLibraryWindow.show()
    movieLibraryWindow.focus()
    return
  }
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 560,
    minHeight: 400,
    frame: false,
    backgroundColor: '#0d0f14',
    title: 'Felix and chill',
    alwaysOnTop: true,
    resizable: true,
    webPreferences: {
      preload: path.join(rootDir, 'build/preload/movie-window.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  movieWindows.add(window)
  movieLibraryWindow = window
  window.once('closed', () => {
    movieWindows.delete(window)
    if (movieLibraryWindow === window) movieLibraryWindow = undefined
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault()
  })
  void window.loadFile(path.join(rootDir, 'build/renderer/movies/index.html'), { query: { apiPort: String(moviePort) } })
}

function snapshot(displayId: number): CompanionSnapshot {
  return {
    state: { ...state, paused, activity: paused ? 'paused' : state.activity },
    definition: registry.load(state.pet),
    active: displayId === activeDisplayId,
    idleAnimation,
    movementAllowed,
    dragging: Boolean(dragOwner),
    position: placed?.displayId === displayId ? { x: placed.x, y: placed.y } : undefined,
    target,
  }
}

function refresh(): void {
  for (const [id, win] of windows) {
    if (win.isDestroyed()) continue
    if (capturing || !state.visible || (id !== activeDisplayId && win !== dragOwner)) win.hide()
    else win.showInactive()
    if (!win.webContents.isLoadingMainFrame()) win.webContents.send('companion:state', snapshot(id))
    if (!paused && state.interactionLocked) {
      win.setIgnoreMouseEvents(true, { forward: true })
    }
  }
  updateTray()
}

function send(data: unknown): void {
  if (socket && !socket.destroyed) socket.write(`${JSON.stringify(data)}\n`)
}

function scheduleRefresh(): void {
  if (refreshQueued) return
  refreshQueued = true
  setImmediate(() => {
    refreshQueued = false
    try {
      refresh()
    } catch (error) {
      console.error(error)
    }
  })
}

function togglePause(): boolean {
  paused = !paused
  if (!paused) {
    state.activity = 'idle'
    state.task = ''
    state.message = 'Ready to continue!'
  }
  send({ kind: 'pause', paused })
  chatTools?.syncPause()
  refresh()
  return paused
}

function selectPet(pet: unknown): boolean {
  if (typeof pet !== 'string' || !registry.list().some((entry) => entry.id === pet)) return false
  state.pet = pet
  send({ kind: 'select', pet })
  refresh()
  return true
}

function updateTray(): void {
  if (!tray) return
  const key = `${state.pet}:${paused}:${state.activity}:${movementAllowed}`
  if (key === trayKey) return
  trayKey = key
  tray.setToolTip(`Pokémon • ${state.pet} • ${paused ? 'Paused' : state.activity}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: paused ? 'Resume computer control' : 'Pause computer control', click: () => togglePause() },
      {
        label: 'Allow movement',
        type: 'checkbox',
        checked: movementAllowed,
        click: (item) => {
          if (!updateMovementAllowed(item.checked)) item.checked = movementAllowed
        },
      },
      {
        label: 'Choose Pokémon',
        submenu: registry.list().map((pet) => ({
          label: pet.id,
          type: 'radio' as const,
          checked: pet.id === state.pet,
          click: () => selectPet(pet.id),
        })),
      },
      {
        label: 'Summon at cursor',
        click: () => {
          const cursor = screen.getCursorScreenPoint()
          const display = screen.getDisplayNearestPoint(cursor)
          activeDisplayId = display.id
          target = undefined
          placed = {
            displayId: display.id,
            x: cursor.x - display.workArea.x - 50,
            y: cursor.y - display.workArea.y - 59,
          }
          try {
            savePreferences()
          } catch (error) {
            console.error(error)
          }
          state.visible = true
          refresh()
        },
      },
      { type: 'separator' },
      { label: 'Quit companion (stops computer control)', click: () => app.quit() },
    ]),
  )
}

async function syncDisplays(): Promise<void> {
  stopDrag()
  const displays = screen.getAllDisplays()
  for (const display of displays) {
    const existing = windows.get(display.id)
    if (existing) {
      existing.setBounds(display.workArea)
      continue
    }
    const win = createPetWindow({
      rootDir,
      preloadPath: path.join(rootDir, 'build/preload/companion.js'),
      display,
      active: display.id === activeDisplayId,
      rendererFile: 'companion.html',
      focusable: false,
    })
    windows.set(display.id, win)
    if (process.env.POKEMON_WINDOW_TITLE) {
      win.on('page-title-updated', (event) => event.preventDefault())
      win.setTitle(process.env.POKEMON_WINDOW_TITLE)
    }
    await new Promise<void>((resolve, reject) => {
      win.webContents.once('did-finish-load', resolve)
      win.webContents.once('did-fail-load', (_event, code, description) =>
        reject(new Error(`Companion page failed: ${code} ${description}`)),
      )
    })
  }
  for (const [id, win] of windows) {
    if (!displays.some((display) => display.id === id)) {
      win.destroy()
      windows.delete(id)
    }
  }
  if (!windows.has(activeDisplayId)) {
    activeDisplayId = screen.getPrimaryDisplay().id
    if (placed) placed.displayId = activeDisplayId
    target = undefined
  }
  refresh()
}

app
  .whenReady()
  .then(async () => {
    const port = Number(process.env.POKEMON_BRIDGE_PORT)
    const token = process.env.POKEMON_BRIDGE_TOKEN
    const pipe = process.env.POKEMON_BRIDGE_PIPE
    if ((!pipe && (!Number.isInteger(port) || port <= 0)) || !token)
      throw new Error('Launch this companion through the Pokémon MCP server.')
    app.dock?.hide()
    const apiRouter = createApiRouter()
    const movieJsonCache = new Map<string, { expiresAt: number; payload: unknown }>()
    const movieApi = express()
    movieApi.use((request, response, next) => {
      // The movie renderer is loaded from file://, so Chromium sends Origin: null.
      // The API is loopback-only and uses no cookies or credentials; allow these
      // read-only requests without enabling credentialed cross-origin access.
      response.setHeader('Access-Control-Allow-Origin', '*')
      response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
      response.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type')
      if (request.method === 'OPTIONS') {
        response.status(204).end()
        return
      }
      if (request.method !== 'GET') {
        response.status(405).end()
        return
      }
      if (request.path.startsWith('/api/') && !request.path.startsWith('/api/poster')) {
        const key = request.originalUrl
        const cached = movieJsonCache.get(key)
        if (cached && cached.expiresAt > Date.now()) {
          response.setHeader('X-Movie-Cache', 'HIT')
          response.json(cached.payload)
          return
        }
        const sendJson = response.json.bind(response)
        response.json = ((payload: unknown) => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            movieJsonCache.set(key, { expiresAt: Date.now() + 5 * 60_000, payload })
            if (movieJsonCache.size > 300) {
              const oldest = movieJsonCache.keys().next().value
              if (oldest) movieJsonCache.delete(oldest)
            }
          }
          return sendJson(payload)
        }) as typeof response.json
      }
      next()
    })
    movieApi.use('/api', apiRouter)
    movieApi.use((_request, response) => response.status(404).end())
    movieServer = createServer(movieApi)
    await new Promise<void>((resolve, reject) => {
      movieServer?.once('error', reject)
      movieServer?.listen(0, '127.0.0.1', () => {
        const address = movieServer?.address()
        if (!address || typeof address === 'string') return reject(new Error('Movie API listener failed to start.'))
        moviePort = address.port
        resolve()
      })
    })
    ipcMain.on('movies:open', (event) => {
      const trusted = [...windows.values(), ...movieWindows].some(
        (win) => !win.isDestroyed() && win.webContents === event.sender,
      )
      if (!trusted) return
      openMovieWindow()
    })
    ipcMain.on('movies:hide-library', (event) => {
      const win = [...movieWindows].find((entry) => !entry.isDestroyed() && entry.webContents === event.sender)
      if (win) win.hide()
    })
    ipcMain.on('movies:minimize', (event) => {
      const win = [...movieWindows].find((entry) => !entry.isDestroyed() && entry.webContents === event.sender)
      win?.minimize()
    })
    ipcMain.on('movies:close', (event) => {
      const win = [...movieWindows].find((entry) => !entry.isDestroyed() && entry.webContents === event.sender)
      win?.close()
    })
    ipcMain.on('movies:toggle-top', (event) => {
      const win = [...movieWindows].find((entry) => !entry.isDestroyed() && entry.webContents === event.sender)
      if (win) win.setAlwaysOnTop(!win.isAlwaysOnTop())
    })
    try {
      const saved = JSON.parse(readFileSync(preferencesPath, 'utf8'))
      if (typeof saved.movementAllowed === 'boolean') movementAllowed = saved.movementAllowed
      if (typeof saved.idleAnimation === 'boolean') idleAnimation = saved.idleAnimation
      if (saved.placed && [saved.placed.displayId, saved.placed.x, saved.placed.y].every(Number.isFinite))
        placed = saved.placed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error(error)
    }
    activeDisplayId = screen.getAllDisplays().some((display) => display.id === placed?.displayId)
      ? (placed?.displayId as number)
      : screen.getPrimaryDisplay().id
    if (placed) placed.displayId = activeDisplayId
    tray = new Tray(nativeImage.createFromPath(path.join(rootDir, 'assets/trayTemplate.png')))
    ipcMain.handle('companion:load', (event) =>
      snapshot([...windows].find(([, win]) => win.webContents === event.sender)?.[0] ?? activeDisplayId),
    )
    ipcMain.handle('companion:list', () =>
      registry.list().map((pet) => ({ ...pet, definition: registry.load(pet.id) })),
    )
    ipcMain.handle('companion:select', (_event, pet: unknown) => selectPet(pet))
    ipcMain.handle('companion:pause', () => togglePause())
    ipcMain.handle('companion:movement', (event, allowed: unknown) => {
      if (typeof allowed !== 'boolean' || ![...windows.values()].some((win) => win.webContents === event.sender))
        return false
      return updateMovementAllowed(allowed)
    })
    ipcMain.on('companion:drag-start', (event, offset: { x?: unknown; y?: unknown }) => {
      const win = [...windows.values()].find((entry) => entry.webContents === event.sender)
      if (
        !win ||
        win.isDestroyed() ||
        win.displayId !== activeDisplayId ||
        capturing ||
        !state.visible ||
        typeof offset?.x !== 'number' ||
        typeof offset.y !== 'number' ||
        !Number.isFinite(offset.x) ||
        !Number.isFinite(offset.y) ||
        offset.x < 0 ||
        offset.x > 100 ||
        offset.y < 0 ||
        offset.y > 118
      )
        return
      stopDrag()
      if (!paused && (state.task || state.interactionLocked)) togglePause()
      dragOwner = win
      dragOffset = { x: offset.x, y: offset.y }
      target = undefined
      win.setIgnoreMouseEvents(false)
      const bounds = win.getBounds()
      if (process.platform === 'win32') win.setShape([{ x: 0, y: 0, width: bounds.width, height: bounds.height }])
      shapeCache.set(win.id, 'drag')
      updateDragPosition()
      refresh()
      dragTimer = setInterval(updateDragPosition, 16)
    })
    ipcMain.on('companion:drag-stop', (event) => {
      if (dragOwner?.webContents === event.sender) stopDrag()
    })
    ipcMain.handle('companion:feedback', (event, satisfaction: unknown) => {
      const trusted = [...windows.values()].some((win) => !win.isDestroyed() && win.webContents === event.sender)
      if (
        !trusted ||
        !state.learningTaskId ||
        !state.learningFeedbackPending ||
        !['satisfied', 'unsatisfied'].includes(String(satisfaction))
      )
        return false
      if (pendingFeedback.size || !socket || socket.destroyed) return false
      return new Promise<boolean>((resolve) => {
        const id = ++feedbackSequence
        const timer = setTimeout(() => {
          pendingFeedback.delete(id)
          resolve(false)
        }, 5000)
        pendingFeedback.set(id, { resolve, timer })
        send({ kind: 'learning_feedback', id, task_id: state.learningTaskId, satisfaction })
      })
    })
    ipcMain.handle('companion:recording', (event, input: unknown) =>
      recorder.request(
        [...windows.values()].some((win) => !win.isDestroyed() && win.webContents === event.sender),
        input,
      ),
    )
    ipcMain.handle('companion:recording-export', async (event) => {
      const trusted = [...windows.values()].some((win) => !win.isDestroyed() && win.webContents === event.sender)
      const reply = await recorder.request(trusted, { action: 'export' })
      if (!reply.ok || !reply.result.text) return reply
      const chosen = await dialog.showSaveDialog({
        title: 'Save Pokémon API trace',
        defaultPath: 'pokemon-recording.json',
        filters: [{ name: 'JSON trace', extensions: ['json'] }],
      })
      if (!chosen.canceled && chosen.filePath) writeFileSync(chosen.filePath, reply.result.text, { mode: 0o600 })
      return { ok: true, result: { text: chosen.canceled ? 'Export canceled.' : 'Trace saved.' } }
    })
    ipcMain.handle('companion:recording-certificate', async (event) => {
      const trusted = [...windows.values()].some((win) => !win.isDestroyed() && win.webContents === event.sender)
      const reply = await recorder.request(trusted, { action: 'certificate' })
      if (!reply.ok) return reply
      if (!reply.result.desktop?.certificate_exists) return { ok: false, error: 'Recorder certificate is unavailable.' }
      const error = await shell.openPath(reply.result.desktop.certificate)
      return error
        ? { ok: false, error }
        : { ok: true, result: { text: 'Certificate opened. Review the trust settings yourself.' } }
    })
    ipcMain.on('companion:quit', () => app.quit())
    ipcMain.on('companion:panel', (event, open: unknown) => {
      if (open === true && !paused && (state.task || state.interactionLocked)) togglePause()
      const win = [...windows.values()].find((entry) => entry.webContents === event.sender)
      if (!win || win.isDestroyed()) return
      if (open !== true && win.isFocused()) win.blur()
      win.setFocusable(open === true)
      if (open === true) win.focus()
    })
    // The native worker remains lazy: opening Talk/history does not start it or contact a model.
    chatTools = new CompanionAgentTools(
      rootDir,
      app.getPath('userData'),
      () => paused,
      (patch) => {
        if (patch.pet && patch.pet !== state.pet) return
        state = { ...state, ...patch, paused }
        scheduleRefresh()
      },
    )
    registerCompanionChat(ipcMain, new CompanionChat(rootDir, app.getPath('userData'), registry, chatTools), (sender) =>
      [...windows.values()].some((win) => !win.isDestroyed() && win.webContents === sender),
    )
    ipcMain.on('companion:ignore-mouse', (event, ignore: unknown) => {
      const win = [...windows.values()].find((entry) => entry.webContents === event.sender)
      if (dragOwner) return
      const busy = !paused && Boolean(state.interactionLocked)
      win?.setIgnoreMouseEvents(ignore !== false || busy, { forward: true })
    })
    ipcMain.on('companion:regions', (event, regions: unknown) => {
      if (process.platform !== 'win32' || !Array.isArray(regions) || regions.length > 3) return
      const win = [...windows.values()].find((entry) => entry.webContents === event.sender)
      if (!win || win.isDestroyed()) return
      if (dragOwner) return
      if (regions.length === 0 || win.displayId !== activeDisplayId) {
        win.setIgnoreMouseEvents(true, { forward: true })
        return
      }
      if (
        !regions.every(
          (region) =>
            typeof region.interactive === 'boolean' &&
            [region.x, region.y, region.width, region.height].every(Number.isInteger) &&
            region.x >= 0 &&
            region.y >= 0 &&
            region.width > 0 &&
            region.height > 0,
        )
      )
        return
      const shape = regions.map(({ x, y, width, height }) => ({ x, y, width, height }))
      const shapeKey = JSON.stringify(shape)
      if (shapeCache.get(win.id) !== shapeKey) {
        win.setShape(shape)
        shapeCache.set(win.id, shapeKey)
      }
      const cursor = screen.getCursorScreenPoint()
      const bounds = win.getBounds()
      // The bubble must stay painted while clicks pass through it to the app below.
      const inside = regions.some(
        (region) =>
          region.interactive &&
          cursor.x >= bounds.x + region.x &&
          cursor.x < bounds.x + region.x + region.width &&
          cursor.y >= bounds.y + region.y &&
          cursor.y < bounds.y + region.y + region.height,
      )
      const busy = !paused && Boolean(state.interactionLocked)
      win.setIgnoreMouseEvents(!inside || busy, { forward: true })
    })
    await syncDisplays()
    globalShortcut.register('CommandOrControl+Shift+P', togglePause)
    const sync = () => {
      void syncDisplays().catch((error) => console.error(error))
    }
    screen.on('display-added', sync)
    screen.on('display-removed', sync)
    screen.on('display-metrics-changed', sync)
    socket = pipe ? net.connect(pipe) : net.connect({ host: '127.0.0.1', port })
    socket.setEncoding('utf8')
    socket.on('connect', () => send({ kind: 'hello', token }))
    socket.on('close', () => app.quit())
    socket.on('error', (error) => {
      console.error(error)
      app.quit()
    })
    let buffer = ''
    let queue = Promise.resolve()
    socket.on('data', (data: string) => {
      buffer += data
      if (buffer.length > 65536) {
        app.quit()
        return
      }
      while (buffer.includes('\n')) {
        const newline = buffer.indexOf('\n')
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        const urgent = JSON.parse(line)
        if (urgent.kind === 'recording_result') {
          recorder.finish(
            urgent.id,
            urgent.ok === true ? { ok: true, result: urgent.result } : { ok: false, error: String(urgent.error) },
          )
          continue
        }
        if (urgent.kind === 'protection_result') {
          const pending = protectionWaits.get(urgent.id)
          if (pending) {
            clearTimeout(pending.timer)
            protectionWaits.delete(urgent.id)
            pending.resolve(urgent.protected === true)
          }
          continue
        }
        queue = queue
          .then(async () => {
            const command = JSON.parse(line)
            try {
              if (command.kind === 'learning_feedback_result') {
                const pending = pendingFeedback.get(command.id)
                if (pending) {
                  clearTimeout(pending.timer)
                  pendingFeedback.delete(command.id)
                  pending.resolve(command.recorded === true)
                }
                return
              }
              if (command.kind === 'approval_check') {
                approvals ??= new CompanionApprovals(rootDir, app.getPath('userData'), async (window, approval) => {
                  const handle = window.getNativeWindowHandle()
                  const windowId = (
                    handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())
                  ).toString()
                  const id = ++protectionSequence
                  const protectedWindow = await new Promise<boolean>((resolve) => {
                    const timer = setTimeout(() => {
                      protectionWaits.delete(id)
                      resolve(false)
                    }, 15000)
                    protectionWaits.set(id, { resolve, timer })
                    send({ kind: 'protect_window', id, window_id: windowId, process_id: process.pid, approval })
                  })
                  if (!protectedWindow) throw new Error('Native approval-window protection is unavailable.')
                })
                const result = await approvals.check(command.request)
                send({ kind: 'approval_result', id: command.id, ...result })
                return
              }
              if (command.kind === 'approval_revoke') {
                approvals?.revokeScope(command.scope)
                send({ kind: 'ack', id: command.id })
                return
              }
              if (command.kind === 'state') {
                if (command.lock_only) {
                  state.interactionLocked = Boolean(command.state?.interactionLocked)
                  if (!paused && state.interactionLocked) stopDrag()
                  for (const win of windows.values()) {
                    if (!win.isDestroyed() && !paused && state.interactionLocked)
                      win.setIgnoreMouseEvents(true, { forward: true })
                  }
                  send({ kind: 'ack', id: command.id })
                  return
                }
                if (
                  (!command.cosmetic || command.state?.pet !== state.pet) &&
                  !registry.list().some((pet) => pet.id === command.state?.pet)
                )
                  throw new Error('Unknown Pokémon.')
                const interactionLocked = state.interactionLocked
                state = { ...command.state, paused, ...(command.cosmetic ? { interactionLocked } : {}) }
                if (
                  movementAllowed &&
                  !dragOwner &&
                  Array.isArray(command.coordinate) &&
                  command.coordinate.length === 2 &&
                  command.coordinate.every(Number.isFinite)
                ) {
                  const point = { x: command.coordinate[0], y: command.coordinate[1] }
                  const logical = process.platform === 'win32' ? screen.screenToDipPoint(point) : point
                  const display = screen.getDisplayNearestPoint(logical)
                  activeDisplayId = display.id
                  target = { x: logical.x - display.workArea.x + 36, y: logical.y - display.workArea.y + 24 }
                }
                if (command.cosmetic) scheduleRefresh()
                else refresh()
              } else if (command.kind === 'clipboard') {
                if (typeof command.text === 'string') {
                  if (clipboardBackup) throw new Error('A paste is already in progress.')
                  clipboardBackup = {
                    text: clipboard.readText(),
                    html: clipboard.readHTML(),
                    rtf: clipboard.readRTF(),
                    image: clipboard.readImage(),
                  }
                  pastedText = command.text
                  clipboard.writeText(command.text)
                } else if (command.text === null && clipboardBackup) {
                  // Preserve new clipboard content if the user copied something during the paste.
                  if (clipboard.readText() === pastedText) clipboard.write(clipboardBackup)
                  clipboardBackup = undefined
                  pastedText = undefined
                } else throw new Error('Invalid paste command.')
              } else if (command.kind === 'capture') {
                capturing = Boolean(command.hidden)
                if (capturing) stopDrag()
                refresh()
                // Give the desktop compositor time to remove the overlay before the screenshot.
                if (capturing) await new Promise((resolve) => setTimeout(resolve, 120))
              } else if (command.kind === 'quit') {
                send({ kind: 'ack', id: command.id })
                app.quit()
                return
              } else throw new Error('Unknown companion command.')
              send({ kind: 'ack', id: command.id })
            } catch (error) {
              if (command.kind === 'approval_check') {
                console.error('Approval UI unavailable:', error instanceof Error ? error.message : 'Unknown error')
                send({
                  kind: 'approval_result',
                  id: command.id,
                  authorized: false,
                  action_id: command.request?.action_id,
                })
                return
              }
              send({ kind: 'ack', id: command.id, error: String(error) })
            }
          })
          .catch((error) => {
            console.error(error)
            app.quit()
          })
      }
    })
  })
  .catch((error) => {
    console.error(error)
    app.quit()
  })

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => {
  movieServer?.close()
  for (const window of movieWindows) if (!window.isDestroyed()) window.close()
  recorder.close()
  approvals?.close()
  chatTools?.close()
  clearInterval(dragTimer)
  for (const pending of pendingFeedback.values()) {
    clearTimeout(pending.timer)
    pending.resolve(false)
  }
  pendingFeedback.clear()
  if (clipboardBackup && clipboard.readText() === pastedText) clipboard.write(clipboardBackup)
  globalShortcut.unregisterAll()
  tray?.destroy()
  socket?.destroy()
})
