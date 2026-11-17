import type { RecordingReply, RecordingRequest } from '../../types/recording'

export function validRecordingRequest(value: unknown): value is RecordingRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  if (Object.keys(request).some((key) => !['action', 'mode', 'target', 'label', 'operation', 'revision'].includes(key)))
    return false
  return (
    ['targets', 'open_browser', 'start', 'stop', 'status', 'mark', 'export', 'inspect', 'certificate'].includes(
      String(request.action),
    ) &&
    (request.mode === undefined || ['browser', 'desktop'].includes(String(request.mode))) &&
    ['target', 'label', 'operation'].every(
      (key) => request[key] === undefined || (typeof request[key] === 'string' && request[key].length <= 200),
    ) &&
    (request.revision === undefined || (Number.isSafeInteger(request.revision) && Number(request.revision) > 0))
  )
}

export class CompanionRecordingBridge {
  private sequence = 0
  private pending = new Map<
    number,
    { resolve: (reply: RecordingReply) => void; timer: ReturnType<typeof setTimeout> }
  >()
  constructor(private readonly send: (value: unknown) => boolean) {}
  request(trusted: boolean, input: unknown): Promise<RecordingReply> {
    if (!trusted || !validRecordingRequest(input))
      return Promise.resolve({ ok: false, error: 'Invalid recording request.' })
    if (this.pending.size >= 4)
      return Promise.resolve({ ok: false, error: 'Recorder is busy. Wait for the current action.' })
    return new Promise((resolve) => {
      const id = ++this.sequence
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({
          ok: false,
          error: 'Recorder is still waiting. Check the approval/setup window, then refresh status.',
        })
      }, 110000)
      this.pending.set(id, { resolve, timer })
      if (!this.send({ kind: 'recording_request', id, request: input }))
        this.finish(id, { ok: false, error: 'Recorder is disconnected.' })
    })
  }
  finish(id: number, reply: RecordingReply): void {
    const pending = this.pending.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(id)
    pending.resolve(reply)
  }
  close(): void {
    for (const id of this.pending.keys()) this.finish(id, { ok: false, error: 'Recorder disconnected.' })
  }
}
