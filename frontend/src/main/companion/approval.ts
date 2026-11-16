import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { BrowserWindow, ipcMain, safeStorage } from 'electron'
import { type ApprovalRequest, ScopedGrants } from './grants'

// biome-ignore lint/suspicious/noControlCharactersInRegex: Approval display deliberately rejects invisible controls.
const unsafeDisplay = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/
type PendingApproval = { window: BrowserWindow; request: ApprovalRequest; resolve?: (authorized: boolean) => void }

export class CompanionApprovals {
  private readonly grants: ScopedGrants
  private readonly anchor: BrowserWindow
  private readonly protectionReady: Promise<void>
  private readonly windows = new Map<string, PendingApproval>()
  constructor(
    private readonly root: string,
    directory: string,
    private readonly protect: (window: BrowserWindow, approval: boolean) => Promise<void>,
    clock = Date.now,
  ) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS-protected approval key storage is unavailable.')
    mkdirSync(directory, { recursive: true })
    const keyFile = path.join(directory, 'approval-key.dpapi')
    let key: Buffer
    try {
      key = Buffer.from(safeStorage.decryptString(readFileSync(keyFile)), 'hex')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      key = randomBytes(32)
      writeFileSync(keyFile, safeStorage.encryptString(key.toString('hex')), { flag: 'wx', mode: 0o600 })
    }
    if (key.length !== 32) throw new Error('Invalid approval signing key.')
    this.grants = new ScopedGrants(key, clock)
    this.anchor = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
    })
    this.anchor.setContentProtection(true)
    this.protectionReady = this.protect(this.anchor, false)
    void this.protectionReady.catch(() => undefined)
    ipcMain.handle(
      'approval:load',
      (event) => [...this.windows.values()].find((entry) => entry.window.webContents === event.sender)?.request ?? null,
    )
    ipcMain.handle('approval:decide', (event, standing: unknown) => {
      const selected = [...this.windows].find(([, entry]) => entry.window.webContents === event.sender)
      if (!selected || ![false, true, 'deny'].includes(standing as boolean | string)) return false
      return this.decide(selected[0], standing as boolean | 'deny')
    })
  }

  async check(request: ApprovalRequest): Promise<{ authorized: boolean; action_id: string }> {
    await this.protectionReady
    if (!request || Buffer.byteLength(JSON.stringify(request)) > 32768)
      throw new Error('Invalid server approval request.')
    for (const [key, limit] of Object.entries({
      action_id: 100,
      digest: 64,
      scope_hash: 64,
      tool: 50,
      operation: 100,
      target: 200,
      origin: 4096,
      path: 4096,
      input_preview: 8000,
      input_hash: 64,
      state_hash: 64,
      conversation: 200,
    })) {
      const value = request[key as keyof ApprovalRequest]
      if (typeof value !== 'string' || value.length > limit || unsafeDisplay.test(value))
        throw new Error('Invalid approval display field.')
    }
    if (
      !/^[a-f0-9]{64}$/.test(request.digest) ||
      !/^[a-f0-9]{64}$/.test(request.scope_hash) ||
      typeof request.scope_allowed !== 'boolean' ||
      !Number.isSafeInteger(request.target_length) ||
      !Number.isSafeInteger(request.input_length) ||
      request.target_length < 0 ||
      request.input_length < 0
    )
      throw new Error('Invalid approval identity.')
    if (request.wait_for_decision !== undefined && typeof request.wait_for_decision !== 'boolean')
      throw new Error('Invalid approval wait mode.')
    if (this.grants.consume(request)) {
      if (request.reconciliation) this.revokeScope(request.scope_hash, true)
      return { authorized: true, action_id: request.action_id }
    }
    const existing = this.windows.get(request.digest)
    if (existing)
      return request.wait_for_decision
        ? this.waitForDecision(existing)
        : { authorized: false, action_id: existing.request.action_id }
    if (this.windows.size >= 3) return { authorized: false, action_id: request.action_id }
    const window = new BrowserWindow({
      width: 680,
      height: 640,
      show: false,
      title: 'Pokémon action approval',
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(this.root, 'build/preload/approval.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    window.setContentProtection(true) // WDA_EXCLUDEFROMCAPTURE on supported Windows versions.
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('will-redirect', (event) => event.preventDefault())
    const entry: PendingApproval = { window, request }
    this.windows.set(request.digest, entry)
    window.on('closed', () => {
      entry.resolve?.(false)
      if (this.windows.get(request.digest)?.window === window) this.windows.delete(request.digest)
    })
    try {
      await this.protect(window, true) // Register native process denial before anything is shown or rendered.
      await window.loadFile(path.join(this.root, 'build/renderer/approval.html'))
      window.showInactive()
      if (!window.isVisible()) window.show()
      await this.protect(window, true) // Revalidate the live HWND after Electron finishes loading/showing it.
    } catch (error) {
      this.windows.delete(request.digest)
      window.destroy()
      throw error
    }
    return request.wait_for_decision ? this.waitForDecision(entry) : { authorized: false, action_id: request.action_id }
  }

  close(): void {
    this.grants.revokeAll()
    for (const entry of this.windows.values()) entry.window.destroy()
    this.windows.clear()
    this.anchor.destroy()
  }
  decide(digest: string, choice: boolean | 'deny'): boolean {
    const entry = this.windows.get(digest)
    if (!entry || (choice === true && (!entry.request.scope_allowed || entry.request.reconciliation))) return false
    if (choice !== 'deny') this.grants.issue(entry.request, choice === true)
    // Consume only a real human-issued grant while this original request is still waiting.
    if (entry.resolve) entry.resolve(choice !== 'deny' && this.grants.consume(entry.request))
    this.windows.delete(digest)
    entry.window.close()
    return true
  }
  revokeScope(scope: string, includeReconciliation = false): void {
    this.grants.revokeScope(scope, includeReconciliation)
    for (const [digest, entry] of this.windows) {
      if (entry.request.scope_hash === scope && (includeReconciliation || !entry.request.reconciliation)) {
        this.windows.delete(digest)
        entry.window.close()
      }
    }
  }
  private waitForDecision(entry: PendingApproval): Promise<{ authorized: boolean; action_id: string }> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => entry.resolve?.(false), 45000)
      entry.resolve = (authorized) => {
        clearTimeout(timer)
        delete entry.resolve
        resolve({ authorized, action_id: entry.request.action_id })
      }
    })
  }
}
