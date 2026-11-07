export interface PetProfile {
  nickname?: string
}

export interface PetAppearance {
  width: number
  height: number
  imageWidth: number
  imageHeight: number
}

export interface PetMovement {
  speed: number
  jumpHeight: number
  jumpDuration: number
  walkFrameInterval: number
  idleFrameInterval: number
  idleTalkMinMs: number
  idleTalkMaxMs: number
}

export interface PetTheme {
  accentColor: string
  accentHoverColor: string
  accentGlowColor: string
  assistantBackground: string
  assistantBorderColor: string
}

export interface PetDefinition {
  id: string
  name: string
  promptFile: string
  spritesFile: string
  spritesManifestFile?: string
  cryUrl: string
  appearance: PetAppearance
  movement: PetMovement
  theme: PetTheme
  idlePhrases: string[]
  recallText: string
  responseCryKeywords: string[]
  greeting: string
  thinkingText: string
  fallbackText: string
  errorText: string
  prompt: string
  sprites: Record<string, string[]>
}

export interface PetSummary {
  id: string
  name: string
}

export interface PetState {
  active: boolean
  x?: number
  y?: number
  dragging?: boolean
  recall?: boolean
  chatOpen?: boolean
  chatWidth?: number
  chatHeight?: number
}

export interface DragOffset {
  x: number
  y: number
  startX?: number
  startY?: number
  chatOpen?: boolean
  chatWidth?: number
  chatHeight?: number
}
