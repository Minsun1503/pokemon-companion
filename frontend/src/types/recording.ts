export interface RecordingRequest {
  action: 'targets' | 'open_browser' | 'start' | 'stop' | 'status' | 'mark' | 'export' | 'inspect' | 'certificate'
  mode?: 'browser' | 'desktop'
  target?: string
  label?: string
  operation?: string
  revision?: number
}
export interface RecordingResult {
  active?: boolean
  paused?: boolean
  targets?: { id: string; label: string; mode: 'browser' | 'desktop'; origin?: string }[]
  desktop?: { installed: boolean; certificate: string; certificate_exists: boolean; note: string }
  recording?: {
    label: string
    mode: 'browser' | 'desktop'
    started: number
    stopped?: number
    reason?: string
    entries: Record<string, unknown>[]
    markers: { at: number; label: string }[]
    truncated: boolean
  } | null
  text?: string
  request_preview?: string
}
export type RecordingReply = { ok: true; result: RecordingResult } | { ok: false; error: string }
