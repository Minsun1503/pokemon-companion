import type {
  ChatMessage,
  DragOffset,
  PetDefinition,
  PetProfile,
  PetState,
  PetSummary,
  Settings,
} from '../types/index.js'

interface StreamPayload {
  requestId: string
  provider: string
  model: string
  messages: ChatMessage[]
}

interface PetAPI {
  clipboard: {
    writeText(text: string): void
  }
  window: {
    setIgnoreMouse(ignore: boolean): void
  }
  history: {
    load(): Promise<ChatMessage[]>
    save(history: ChatMessage[]): Promise<boolean>
    onUpdated(listener: (payload: { history: ChatMessage[] }) => void): () => void
  }
  pet: {
    loadActive(): Promise<PetDefinition>
    list(): Promise<PetSummary[]>
    switchActive(petId: string): Promise<boolean>
    loadProfile(): Promise<PetProfile>
    saveNickname(nickname: string): Promise<boolean>
    onRecall(listener: (position: { x: number; y: number }) => void): () => void
    onSetActive(listener: (state: PetState) => void): () => void
    notifyChatState(open: boolean, width?: number, height?: number): void
    startDrag(offset: DragOffset): void
    stopDrag(): void
    onDragPosition(listener: (position: { x: number; y: number; dragging: boolean }) => void): () => void
    onDragStop(listener: () => void): () => void
  }
  settings: {
    load(): Promise<Settings>
  }
  chat: {
    setPending(pending: boolean): void
    onPendingChanged(listener: (payload: { pending: boolean }) => void): () => void
    stream(payload: StreamPayload): void
    onChunk(listener: (payload: { requestId: string; chunk: string }) => void): () => void
    onDone(listener: (payload: { requestId: string }) => void): () => void
    onError(listener: (payload: { requestId: string; error: string }) => void): () => void
  }
}

declare global {
  interface Window {
    petAPI: PetAPI
  }
}
