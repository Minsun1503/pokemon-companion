import type { AiSettings } from './ai.js'

export interface Settings {
  pet: { active: string; movementAllowed?: boolean }
  ai: AiSettings
}
