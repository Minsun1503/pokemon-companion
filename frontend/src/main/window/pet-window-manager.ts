import type { Display, Point, WebContents } from 'electron'
import { screen } from 'electron'
import type { DragOffset, PetState } from '../../types'
import type { PetWindow } from './pet-window'
import { createPetWindow } from './pet-window'

export class PetWindowManager {
  private readonly windows = new Map<number, PetWindow>()
  private readonly states = new Map<number, PetState>()
  private readonly chatStates = new Map<number, { open: boolean; width?: number; height?: number }>()
  private activeDisplayId: number | null = null
  private dragTimer: ReturnType<typeof setInterval> | null = null
  private dragDisplayId: number | null = null
  private dragOffset = { x: 0, y: 0 }
  private dragStartCursor: Point | null = null
  private dragStartPosition: { x: number; y: number } | null = null
  private dragSourceDisplayId: number | null = null
  private pendingChatOpen: boolean | undefined = undefined
  private pendingChatWidth: number | undefined = undefined
  private pendingChatHeight: number | undefined = undefined

  constructor(
    private readonly rootDir: string,
    private readonly preloadPath: string,
  ) {}

  createAll(): void {
    const primaryId = screen.getPrimaryDisplay().id
    this.activeDisplayId = primaryId
    for (const display of screen.getAllDisplays()) {
      this.createForDisplay(display, display.id === primaryId)
    }
  }

  createForDisplay(display: Display, active = false): PetWindow {
    const existing = this.windows.get(display.id)
    if (existing) {
      return existing
    }
    const win = createPetWindow({
      rootDir: this.rootDir,
      preloadPath: this.preloadPath,
      display,
      active,
    })
    this.windows.set(display.id, win)
    this.states.set(display.id, { active })
    win.webContents.on('did-finish-load', () => this.sendState(display.id))
    win.on('closed', () => {
      this.windows.delete(display.id)
      this.states.delete(display.id)
    })
    return win
  }

  private sendState(displayId: number): void {
    const win = this.windows.get(displayId)
    const state = this.states.get(displayId)
    if (!win || win.isDestroyed() || !state) {
      return
    }
    win.webContents.send('pet:set-active', state)
  }

  private setState(displayId: number, state: PetState): void {
    this.states.set(displayId, state)
    const win = this.windows.get(displayId)
    if (!win || win.isDestroyed() || win.webContents.isLoadingMainFrame()) {
      return
    }
    this.sendState(displayId)
  }

  syncDisplays(): void {
    const displays = screen.getAllDisplays()
    const displayIds = new Set(displays.map((d) => d.id))

    for (const display of displays) {
      const win = this.createForDisplay(display, false)
      if (!win.isDestroyed()) {
        win.setBounds(display.workArea)
      }
    }

    for (const [displayId, win] of this.windows) {
      if (!displayIds.has(displayId)) {
        win.destroy()
      }
    }

    if (this.activeDisplayId !== null && !displayIds.has(this.activeDisplayId)) {
      this.activeDisplayId = screen.getPrimaryDisplay().id
      this.activateDisplay(this.activeDisplayId)
    }
  }

  getActiveWindow(): PetWindow | undefined {
    return this.activeDisplayId !== null ? this.windows.get(this.activeDisplayId) : undefined
  }

  getWindowForSender(sender: WebContents): PetWindow | undefined {
    for (const win of this.windows.values()) {
      if (win.webContents === sender) {
        return win
      }
    }
    return undefined
  }

  broadcast(channel: string, payload: unknown): void {
    for (const win of this.windows.values()) {
      if (win.isDestroyed() || win.webContents.isLoadingMainFrame()) {
        continue
      }
      win.webContents.send(channel, payload)
    }
  }

  broadcastExcept(channel: string, payload: unknown, excludeSender: WebContents): void {
    for (const win of this.windows.values()) {
      if (win.webContents === excludeSender) {
        continue
      }
      if (win.isDestroyed() || win.webContents.isLoadingMainFrame()) {
        continue
      }
      win.webContents.send(channel, payload)
    }
  }

  setIgnoreMouseForSender(sender: WebContents, ignore: boolean): void {
    const win = this.getWindowForSender(sender)
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(ignore, { forward: true })
    }
  }

  activateDisplay(displayId: number, payload: Partial<PetState> = {}): void {
    const target = this.windows.get(displayId)
    if (!target || target.isDestroyed()) {
      return
    }

    const previous = this.getActiveWindow()
    if (previous && previous !== target && !previous.isDestroyed()) {
      this.setState(previous.displayId, { active: false })
      previous.setIgnoreMouseEvents(true, { forward: true })
    }

    this.activeDisplayId = displayId
    target.setIgnoreMouseEvents(!payload.dragging, { forward: true })
    const state: PetState = { active: true, ...payload }
    if (this.dragTimer && this.pendingChatOpen !== undefined) {
      state.chatOpen = this.pendingChatOpen
      state.chatWidth = this.pendingChatWidth
      state.chatHeight = this.pendingChatHeight
    }
    this.setState(displayId, state)
    target.showInactive()
    target.moveTop()
  }

  setChatState(displayId: number, open: boolean, width?: number, height?: number): void {
    this.chatStates.set(displayId, { open, width, height })
  }

  private getWindowLocalPoint(display: Display, cursor: Point): { x: number; y: number } {
    const win = this.windows.get(display.id)
    const bounds = win && !win.isDestroyed() ? win.getBounds() : display.workArea
    return {
      x: cursor.x - bounds.x,
      y: cursor.y - bounds.y,
    }
  }

  recallAtCursor(): void {
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const point = this.getWindowLocalPoint(display, cursor)
    const chatState = this.activeDisplayId !== null ? this.chatStates.get(this.activeDisplayId) : undefined
    this.activateDisplay(display.id, {
      x: point.x,
      y: point.y,
      recall: true,
      chatOpen: chatState?.open,
      chatWidth: chatState?.width,
      chatHeight: chatState?.height,
    })
  }

  startDrag(sender: WebContents, offset: DragOffset): void {
    this.stopDrag(false)
    const source = this.getWindowForSender(sender)
    if (!source) {
      return
    }

    this.activeDisplayId = source.displayId
    this.dragDisplayId = source.displayId
    this.dragSourceDisplayId = source.displayId
    this.dragOffset = {
      x: Number(offset?.x) || 0,
      y: Number(offset?.y) || 0,
    }
    this.dragStartCursor = screen.getCursorScreenPoint()
    this.dragStartPosition =
      Number.isFinite(offset?.startX) && Number.isFinite(offset?.startY)
        ? { x: Number(offset.startX), y: Number(offset.startY) }
        : null
    this.pendingChatOpen = offset?.chatOpen !== undefined ? Boolean(offset.chatOpen) : undefined
    this.pendingChatWidth = offset?.chatWidth !== undefined ? Number(offset.chatWidth) : undefined
    this.pendingChatHeight = offset?.chatHeight !== undefined ? Number(offset.chatHeight) : undefined

    this.dragTimer = setInterval(() => {
      const cursor = screen.getCursorScreenPoint()
      const display = screen.getDisplayNearestPoint(cursor)
      const point = this.getWindowLocalPoint(display, cursor)
      const dragStartCursor = this.dragStartCursor
      const dragStartPosition = this.dragStartPosition
      const sameDisplayDrag =
        display.id === this.dragSourceDisplayId && dragStartCursor !== null && dragStartPosition !== null
      const position = sameDisplayDrag
        ? {
            x: dragStartPosition.x + cursor.x - dragStartCursor.x,
            y: dragStartPosition.y + cursor.y - dragStartCursor.y,
            dragging: true,
          }
        : {
            x: point.x - this.dragOffset.x,
            y: point.y - this.dragOffset.y,
            dragging: true,
          }

      if (display.id !== this.dragDisplayId) {
        this.dragDisplayId = display.id
        this.activateDisplay(display.id, position)
      } else {
        const target = this.windows.get(display.id)
        if (target && !target.isDestroyed()) {
          target.webContents.send('pet:drag-position', position)
        }
      }
    }, 16)
  }

  stopDrag(notify = true): void {
    const wasDragging = Boolean(this.dragTimer)
    if (this.dragTimer) {
      clearInterval(this.dragTimer)
    }
    this.dragTimer = null
    this.dragDisplayId = null
    this.dragStartCursor = null
    this.dragStartPosition = null
    this.dragSourceDisplayId = null
    this.pendingChatOpen = undefined
    const active = this.getActiveWindow()
    if (notify && wasDragging && active && !active.isDestroyed()) {
      active.webContents.send('pet:drag-stop')
      active.setIgnoreMouseEvents(true, { forward: true })
    }
  }

  showActive(): void {
    const active = this.getActiveWindow()
    if (active && !active.isDestroyed()) {
      active.showInactive()
      active.moveTop()
    }
  }

  destroyAll(): void {
    this.stopDrag()
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) {
        win.destroy()
      }
    }
    this.windows.clear()
    this.states.clear()
  }
}
