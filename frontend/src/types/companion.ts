import type { PetDefinition } from './pet'

export type CompanionActivity = 'idle' | 'thinking' | 'working' | 'success' | 'error' | 'paused'
export interface CompanionState {
  pet: string
  activity: CompanionActivity
  message: string
  task: string
  visible: boolean
  paused: boolean
  completedActions: number
  interactionLocked?: boolean
  learningTaskId?: string
  learningFeedbackPending?: boolean
  action?: { animation: 'typing' | 'clicking' | 'thinking'; id: number; active: boolean }
}

export type CompanionChatReply = { ok: true; content: string } | { ok: false; error: string }
export interface CompanionSnapshot {
  state: CompanionState
  definition: PetDefinition
  active: boolean
  idleAnimation?: boolean
  target?: { x: number; y: number }
}
