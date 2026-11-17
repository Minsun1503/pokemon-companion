import type { RecordingReply, RecordingRequest, RecordingResult } from '../../types/recording.js'

interface RecordingTransport {
  recording(request: RecordingRequest): Promise<RecordingReply>
  recordingExport(): Promise<RecordingReply>
  recordingCertificate(): Promise<RecordingReply>
  pause(): Promise<boolean>
}
const get = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

export class RecordingController {
  private active = false
  private visible = false
  private busy = false
  private targets: NonNullable<RecordingResult['targets']> = []
  private desktop?: RecordingResult['desktop']
  constructor(
    private readonly api: RecordingTransport,
    private readonly layout: () => void,
    private readonly activityChanged: () => void,
  ) {
    get('record-refresh').onclick = () => void this.call({ action: 'targets' })
    get('record-browser').onclick = () => void this.call({ action: 'open_browser' })
    get('record-mode').onchange = () => this.renderTargets()
    get('record-toggle').onclick = () => {
      const mode = get<HTMLSelectElement>('record-mode').value as 'browser' | 'desktop'
      void this.call(
        this.active
          ? { action: 'stop' }
          : {
              action: 'start',
              mode,
              target: get<HTMLSelectElement>('record-target').value,
              label: get<HTMLInputElement>('record-label').value,
            },
      )
    }
    get('record-mark').onclick = () =>
      void this.call({ action: 'mark', label: get<HTMLInputElement>('record-label').value })
    get('record-export').onclick = () => void this.special(() => api.recordingExport())
    get('record-certificate').onclick = () => void this.special(() => api.recordingCertificate())
    get('record-resume').onclick = () => {
      void api.pause().then(() => this.call({ action: 'status' }))
    }
    setInterval(() => {
      if ((this.visible || this.active) && !this.busy) void this.call({ action: 'status' }, true)
    }, 2000)
  }
  show(visible: boolean): void {
    this.visible = visible
    if (visible) void this.call({ action: 'targets' })
  }
  private async special(run: () => Promise<RecordingReply>): Promise<void> {
    try {
      const reply = await run()
      get('record-status').textContent = reply.ok ? (reply.result.text ?? 'Done.') : reply.error
    } catch {
      get('record-status').textContent = 'Recorder could not complete this action.'
    }
  }
  private async call(request: RecordingRequest, quiet = false): Promise<void> {
    if (this.busy) return
    this.busy = true
    get<HTMLButtonElement>('record-toggle').disabled = true
    if (!quiet)
      get('record-status').textContent =
        request.action === 'start' ? 'Starting… review any Pokémon or Windows approval dialog.' : 'Loading…'
    try {
      const reply = await this.api.recording(request)
      if (!reply.ok) {
        get('record-status').textContent = reply.error
        return
      }
      if (reply.result.request_preview) {
        get('record-preview').hidden = false
        get('record-preview').textContent = reply.result.request_preview
      } else this.apply(reply.result)
    } catch {
      get('record-status').textContent = 'Recorder disconnected. Reopen Pokémon to reconnect.'
    } finally {
      this.busy = false
      get<HTMLButtonElement>('record-toggle').disabled = false
      this.layout()
    }
  }
  private renderTargets(): void {
    const mode = get<HTMLSelectElement>('record-mode').value
    const select = get<HTMLSelectElement>('record-target')
    const previous = select.value
    select.replaceChildren()
    for (const target of this.targets.filter((item) => item.mode === mode)) {
      const option = document.createElement('option')
      option.value = target.id
      option.textContent = target.label
      select.append(option)
    }
    if (Array.from(select.options).some((item) => item.value === previous)) select.value = previous
    if (!select.options.length) {
      const option = document.createElement('option')
      option.value = ''
      option.textContent =
        mode === 'browser' ? 'Open the recorder browser, navigate, then refresh' : 'Open an app, then refresh targets'
      select.append(option)
    }
    get('record-browser').hidden = mode !== 'browser'
    get('record-certificate').hidden = mode !== 'desktop'
    get('record-setup').textContent =
      mode === 'desktop'
        ? this.desktop?.installed
          ? this.desktop.note
          : 'Optional mitmproxy dependency is missing. Install the recorder setup first.'
        : 'Captures same-origin fetch/XHR in Pokémon browser sessions. Navigate and sign in yourself, then refresh targets.'
    this.layout()
  }
  private apply(result: RecordingResult): void {
    if (result.targets) {
      this.targets = result.targets
      this.desktop = result.desktop
      this.renderTargets()
    }
    this.active = result.active === true
    get('pet-container').dataset.recording = String(this.active)
    this.activityChanged()
    const recording = result.recording
    get('record-menu-label').textContent = this.active ? '● Recording' : 'Record'
    get('record-toggle').textContent = this.active ? '■ Stop' : '● Record'
    get<HTMLButtonElement>('record-mark').disabled = !this.active || result.paused === true
    get('record-resume').hidden = result.paused !== true
    for (const id of ['record-mode', 'record-target', 'record-refresh', 'record-browser']) {
      ;(get(id) as HTMLButtonElement).disabled = this.active
    }
    get('record-status').textContent = recording
      ? `${this.active ? (result.paused ? 'Paused' : 'Recording') : 'Stopped'} · ${recording.entries.length} request patterns · ${recording.label}${recording.truncated ? ' · showing a bounded recent trace' : ''}${recording.reason ? ` · ${recording.reason}` : ''}`
      : result.paused
        ? 'Control is paused. Resume to record.'
        : 'Choose a target to begin.'
    get('record-entries').replaceChildren()
    for (const entry of recording?.entries ?? []) {
      const row = document.createElement('li')
      const title = document.createElement('strong')
      title.textContent = `${entry.method} · ${entry.status} · ${entry.endpoint}`
      row.append(title)
      const trigger = entry.trigger as { label?: string } | undefined
      const detail = document.createElement('small')
      detail.textContent = trigger?.label
        ? `Near click: ${trigger.label}`
        : entry.near_step
          ? `Near step: ${entry.near_step}`
          : 'No nearby action identified'
      row.append(detail)
      if (entry.operation_id && entry.revision) {
        const inspect = document.createElement('button')
        inspect.textContent = 'Inspect request'
        inspect.onclick = () =>
          void this.call({ action: 'inspect', operation: String(entry.operation_id), revision: Number(entry.revision) })
        row.append(inspect)
      }
      get('record-entries').append(row)
    }
  }
}
