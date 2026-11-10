import { mkdirSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { app, clipboard, globalShortcut, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import type { CompanionSnapshot, CompanionState } from '../../types/companion'
import { PetRegistry } from '../services/pet-registry'
import { createPetWindow, type PetWindow } from '../window/pet-window'
import { CompanionChat } from './chat'

app.setName('pokemon-mcp')
if (process.env.POKEMON_USER_DATA_DIR) {
  const profileDirectory = path.resolve(process.env.POKEMON_USER_DATA_DIR)
  mkdirSync(profileDirectory, { recursive: true })
  app.setPath('userData', profileDirectory)
}
const rootDir = path.resolve(__dirname, '../../..')
const registry = new PetRegistry(path.join(rootDir, 'pets'))
const windows = new Map<number, PetWindow>()
let activeDisplayId: number
let tray: Tray
let socket: net.Socket
let capturing = false
let refreshQueued = false
let paused = false
let clipboardBackup: Electron.Data | undefined
let pastedText: string | undefined
let target: { x: number; y: number } | undefined
let state: CompanionState = {
  pet: 'pikachu',
  activity: 'idle',
  message: 'Ready when you are!',
  task: '',
  visible: true,
  paused: false,
  completedActions: 0,
}

function snapshot(displayId: number): CompanionSnapshot {
  return {
    state: { ...state, paused, activity: paused ? 'paused' : state.activity },
    definition: registry.load(state.pet),
    active: displayId === activeDisplayId,
    target,
  }
}

function refresh(): void {
  for (const [id, win] of windows) {
    if (win.isDestroyed()) continue
    if (capturing || !state.visible || id !== activeDisplayId) win.hide()
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
  tray.setToolTip(`Pokémon • ${state.pet} • ${paused ? 'Paused' : state.activity}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: paused ? 'Resume computer control' : 'Pause computer control', click: () => togglePause() },
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
          target = { x: cursor.x - display.workArea.x + 30, y: cursor.y - display.workArea.y + 30 }
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
    target = undefined
  }
  refresh()
}

app
  .whenReady()
  .then(async () => {
    const port = Number(process.env.POKEMON_BRIDGE_PORT)
    const token = process.env.POKEMON_BRIDGE_TOKEN
    if (!Number.isInteger(port) || port <= 0 || !token)
      throw new Error('Launch this companion through the Pokémon MCP server.')
    app.dock?.hide()
    activeDisplayId = screen.getPrimaryDisplay().id
    tray = new Tray(nativeImage.createFromPath(path.join(rootDir, 'assets/trayTemplate.png')))
    ipcMain.handle('companion:load', (event) =>
      snapshot([...windows].find(([, win]) => win.webContents === event.sender)?.[0] ?? activeDisplayId),
    )
    ipcMain.handle('companion:list', () =>
      registry.list().map((pet) => ({ ...pet, definition: registry.load(pet.id) })),
    )
    ipcMain.handle('companion:select', (_event, pet: unknown) => selectPet(pet))
    ipcMain.handle('companion:pause', () => togglePause())
    ipcMain.on('companion:quit', () => app.quit())
    ipcMain.on('companion:panel', (event, open: unknown) => {
      if (open === true && !paused && (state.task || state.interactionLocked)) togglePause()
      const win = [...windows.values()].find((entry) => entry.webContents === event.sender)
      if (!win || win.isDestroyed()) return
      if (open !== true && win.isFocused()) win.blur()
      win.setFocusable(open === true)
      if (open === true) win.focus()
    })
    const chat = new CompanionChat(rootDir, app.getPath('userData'), registry)
    ipcMain.handle('companion:chat-history', (_event, pet: unknown) => {
      if (typeof pet !== 'string' || !registry.list().some((entry) => entry.id === pet)) return []
      return chat.history(pet)
    })
    ipcMain.handle('companion:chat-send', (_event, pet: unknown, text: unknown) => {
      if (typeof pet !== 'string' || !registry.list().some((entry) => entry.id === pet)) {
        return { ok: false, error: 'Please select a Pokémon first.' }
      }
      return chat.reply(pet, text)
    })
    ipcMain.on('companion:ignore-mouse', (event, ignore: unknown) => {
      const win = [...windows.values()].find((entry) => entry.webContents === event.sender)
      const busy = !paused && Boolean(state.interactionLocked)
      win?.setIgnoreMouseEvents(ignore !== false || busy, { forward: true })
    })
    ipcMain.on('companion:regions', (event, regions: unknown) => {
      if (process.platform !== 'win32' || !Array.isArray(regions) || regions.length > 3) return
      const win = [...windows.values()].find((entry) => entry.webContents === event.sender)
      if (!win || win.isDestroyed()) return
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
      win.setShape(regions.map(({ x, y, width, height }) => ({ x, y, width, height })))
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
    socket = net.connect({ host: '127.0.0.1', port })
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
        queue = queue
          .then(async () => {
            const command = JSON.parse(line)
            try {
              if (command.kind === 'state') {
                if (command.lock_only) {
                  state.interactionLocked = Boolean(command.state?.interactionLocked)
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
  if (clipboardBackup && clipboard.readText() === pastedText) clipboard.write(clipboardBackup)
  globalShortcut.unregisterAll()
  tray?.destroy()
  socket?.destroy()
})
