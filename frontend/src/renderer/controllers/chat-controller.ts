import type { ChatMessage, PetDefinition, Settings } from '../../types/index.js'
import { MessageList, type RenderedMessage } from '../components/message-list.js'

interface ChatControllerOptions {
  chatWindow: HTMLElement
  messages: HTMLElement
  userInput: HTMLTextAreaElement
  messageMenu: HTMLElement
  copyButton: HTMLElement
  deleteButton: HTMLElement
  resendButton: HTMLElement
  sendButton: HTMLElement
  petDefinition: PetDefinition
  settings: Settings
  getPetNickname: () => string | null
  isOpen: () => boolean
  playCry: () => void
}

type StreamResult = { ok: true; content: string } | { ok: false; error: string }

const MODEL_CONTEXT_MESSAGE_LIMIT = 10
const RENDER_BATCH_SIZE = 50

export class ChatController {
  private readonly history: ChatMessage[] = []
  private readonly messageList: MessageList
  private readonly thinkingTimers = new WeakMap<HTMLElement, ReturnType<typeof setInterval>>()
  private isSending = false
  private isPending = false
  private pendingMessage: HTMLElement | null = null
  private renderedStartIndex = 0

  constructor(private readonly opts: ChatControllerOptions) {
    this.messageList = new MessageList({
      container: opts.messages,
      petId: opts.petDefinition.id,
      menu: opts.messageMenu,
      copyButton: opts.copyButton,
      deleteButton: opts.deleteButton,
      resendButton: opts.resendButton,
      menuBounds: opts.chatWindow,
      onDelete: async (entry) => this.deleteMessage(entry),
      onCopy: (text) => window.petAPI.clipboard.writeText(text),
      onResend: async (entry) => this.sendMessage(entry.content),
      onLoadMore: () => this.loadMoreRenderedHistory(),
    })

    window.petAPI.history.onUpdated((payload) => {
      this.replaceHistory(this.sanitizeHistory(payload?.history))
    })
    window.petAPI.chat.onPendingChanged((payload) => {
      this.setPending(Boolean(payload?.pending))
    })
    opts.sendButton.addEventListener('click', () => {
      void this.sendCurrentMessage()
    })
    opts.userInput.addEventListener('keydown', (event) => {
      if (event.isComposing) {
        return
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey) {
        event.preventDefault()
        void this.sendCurrentMessage()
      }
    })
    opts.userInput.addEventListener('input', () => {
      this.resizeInput()
    })
    this.resizeInput()
  }

  isMenuOpen(): boolean {
    return this.opts.messageMenu.style.display !== 'none'
  }

  hideMenu(): void {
    this.messageList.hideMenu()
  }

  async onChatOpened(): Promise<void> {
    if (this.opts.messages.childElementCount === 0 && this.history.length > 0) {
      this.renderHistory()
    }
    if (this.history.length > 0) {
      return
    }
    await this.loadHistory()
    if (this.history.length > 0) {
      return
    }
    setTimeout(() => {
      if (!this.opts.isOpen() || this.history.length > 0) {
        return
      }
      const greeting: ChatMessage = {
        role: 'assistant',
        content: this.opts.petDefinition.greeting,
      }
      this.history.push(greeting)
      this.addMessage('assistant', greeting.content, greeting)
    }, 300)
  }

  async syncVisibleHistory(): Promise<void> {
    if (this.history.length === 0) {
      await this.loadHistory()
    }
    if (this.history.length > 0 || this.isPending) {
      this.renderHistory()
    }
  }

  private addMessage(role: ChatMessage['role'], text: string, entry: ChatMessage | null = null): HTMLElement {
    return this.messageList.add(role, text, entry)
  }

  private async deleteMessage(entry: ChatMessage): Promise<void> {
    const index = this.history.indexOf(entry)
    if (index !== -1) {
      this.history.splice(index, 1)
    }
    await window.petAPI.history.save(this.history)
  }

  private isReasoningLeak(text: string): boolean {
    const normalized = text.trim().toLowerCase()
    if (normalized.startsWith('<think>')) {
      return true
    }
    const prefixes = ['okay', 'let me', 'the user', 'we need', 'i need', 'i should', 'we should']
    return prefixes.some((prefix) => prefix.startsWith(normalized) || normalized.startsWith(prefix))
  }

  private cleanAssistantText(text: string): string {
    const clean = text
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/<think>[\s\S]*$/g, '')
      .trim()
    return this.isReasoningLeak(clean) ? '' : clean
  }

  private sanitizeHistory(history: ChatMessage[] | undefined): ChatMessage[] {
    const cleanHistory: ChatMessage[] = []
    for (const message of history ?? []) {
      if (!message || typeof message.content !== 'string') {
        continue
      }
      if (message.role !== 'user' && message.role !== 'assistant') {
        continue
      }
      if (message.role === 'assistant' && this.isReasoningLeak(message.content)) {
        if (cleanHistory.at(-1)?.role === 'user') {
          cleanHistory.pop()
        }
        continue
      }
      cleanHistory.push(message)
    }
    return cleanHistory
  }

  private renderHistory(): void {
    this.clearPendingMessage()
    this.renderedStartIndex = Math.max(0, this.history.length - RENDER_BATCH_SIZE)
    const visibleMessages = this.renderedMessages(this.renderedStartIndex)
    this.messageList.render(visibleMessages)
    this.renderPendingMessage()
  }

  private loadMoreRenderedHistory(): void {
    if (this.renderedStartIndex <= 0) {
      return
    }
    const endIndex = this.renderedStartIndex
    this.renderedStartIndex = Math.max(0, endIndex - RENDER_BATCH_SIZE)
    const olderMessages = this.renderedMessages(this.renderedStartIndex, endIndex)
    this.messageList.prepend(olderMessages)
  }

  private renderedMessages(startIndex: number, endIndex?: number): RenderedMessage[] {
    return this.history.slice(startIndex, endIndex).map((message) => ({
      role: message.role,
      text: message.content,
      entry: message,
    }))
  }

  private systemPrompt(): string {
    const nickname = this.opts.getPetNickname()
    if (!nickname) {
      return this.opts.petDefinition.prompt
    }
    return `${this.opts.petDefinition.prompt}\n\nThe user has named you "${nickname}". Treat this as your current name.`
  }

  private replaceHistory(history: ChatMessage[], { rerender = true } = {}): void {
    this.history.splice(0, this.history.length, ...history)
    if (rerender && this.opts.isOpen()) {
      this.renderHistory()
    }
  }

  private async loadHistory(): Promise<void> {
    const saved = await window.petAPI.history.load()
    const cleanHistory = this.sanitizeHistory(saved)
    this.replaceHistory(cleanHistory)
    if (saved?.length !== cleanHistory.length) {
      await window.petAPI.history.save(cleanHistory)
    }
  }

  private startThinkingAnimation(element: HTMLElement): void {
    let dots = 0
    element.classList.add('thinking')
    element.textContent = this.opts.petDefinition.thinkingText
    const timer = setInterval(() => {
      dots = (dots + 1) % 4
      element.textContent = this.opts.petDefinition.thinkingText + '.'.repeat(dots)
    }, 350)
    this.thinkingTimers.set(element, timer)
  }

  private stopThinkingAnimation(element: HTMLElement): void {
    const timer = this.thinkingTimers.get(element)
    if (timer) {
      clearInterval(timer)
      this.thinkingTimers.delete(element)
    }
    element.classList.remove('thinking')
  }

  private clearPendingMessage(): void {
    if (!this.pendingMessage) {
      return
    }
    this.stopThinkingAnimation(this.pendingMessage)
    this.pendingMessage.remove()
    this.pendingMessage = null
  }

  private renderPendingMessage(): void {
    if (!this.isPending || !this.opts.isOpen() || this.pendingMessage?.isConnected) {
      return
    }
    this.pendingMessage = this.addMessage('assistant', '')
    this.startThinkingAnimation(this.pendingMessage)
  }

  private setPending(pending: boolean): void {
    this.isPending = pending
    if (pending) {
      this.renderPendingMessage()
    } else {
      this.clearPendingMessage()
    }
  }

  private async sendCurrentMessage(): Promise<void> {
    await this.sendMessage(this.opts.userInput.value)
  }

  private resizeInput(): void {
    const input = this.opts.userInput
    input.style.height = 'auto'
    const maxHeight = Number.parseFloat(getComputedStyle(input).maxHeight)
    const nextHeight = Number.isFinite(maxHeight) ? Math.min(input.scrollHeight, maxHeight) : input.scrollHeight
    input.style.height = `${nextHeight}px`
    input.style.overflowY = input.scrollHeight > nextHeight ? 'auto' : 'hidden'
  }

  private async sendMessage(text: string): Promise<void> {
    if (!text.trim() || this.isSending) {
      return
    }
    this.isSending = true
    this.hideMenu()
    const userEntry: ChatMessage = { role: 'user', content: text }
    this.history.push(userEntry)
    this.addMessage('user', text, userEntry)
    this.opts.userInput.value = ''
    this.resizeInput()
    this.messageList.scrollToBottom()
    try {
      await window.petAPI.history.save(this.history)
      this.setPending(true)
      window.petAPI.chat.setPending(true)
      const systemPrompt = this.systemPrompt()
      const recentHistory = this.history.slice(-MODEL_CONTEXT_MESSAGE_LIMIT)
      const requestMessages: ChatMessage[] = [{ role: 'system', content: systemPrompt }]
      requestMessages.push(...recentHistory)
      const result = await this.streamAssistantAttempt(requestMessages)
      const responseElement = this.pendingMessage
      if (responseElement) {
        this.stopThinkingAnimation(responseElement)
      }
      if (!result.ok) {
        this.showError(responseElement)
        return
      }

      const content = this.cleanAssistantText(result.content) || this.opts.petDefinition.fallbackText
      const assistantEntry: ChatMessage = { role: 'assistant', content }
      this.history.push(assistantEntry)
      const shouldPlayCry = this.opts.petDefinition.responseCryKeywords.some(
        (keyword) => keyword && content.includes(keyword),
      )
      if (shouldPlayCry) {
        this.opts.playCry()
      }
      await window.petAPI.history.save(this.history)
      this.setPending(false)
      this.renderHistory()
    } catch (error) {
      console.error('Failed to send chat message', error)
      this.showError(this.pendingMessage)
    } finally {
      this.setPending(false)
      window.petAPI.chat.setPending(false)
      this.isSending = false
    }
  }

  private showError(element: HTMLElement | null): void {
    if (!element) {
      return
    }
    this.stopThinkingAnimation(element)
    element.textContent = this.opts.petDefinition.errorText
    this.pendingMessage = null
  }

  private streamAssistantAttempt(requestMessages: ChatMessage[]): Promise<StreamResult> {
    return new Promise((resolve) => {
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      let rawContent = ''
      const cleanup = (): void => {
        unsubscribeChunk()
        unsubscribeDone()
        unsubscribeError()
      }
      const unsubscribeChunk = window.petAPI.chat.onChunk((payload) => {
        if (!payload || payload.requestId !== requestId) {
          return
        }
        rawContent += payload.chunk || ''
        const clean = this.cleanAssistantText(rawContent)
        if (!clean) {
          return
        }
        const responseElement = this.pendingMessage
        if (!responseElement) {
          return
        }
        if (responseElement.classList.contains('thinking')) {
          this.stopThinkingAnimation(responseElement)
        }
        responseElement.textContent = clean
        this.messageList.scrollToBottom()
      })
      const unsubscribeDone = window.petAPI.chat.onDone((payload) => {
        if (!payload || payload.requestId !== requestId) {
          return
        }
        cleanup()
        resolve({ ok: true, content: rawContent })
      })
      const unsubscribeError = window.petAPI.chat.onError((payload) => {
        if (!payload || payload.requestId !== requestId) {
          return
        }
        cleanup()
        resolve({ ok: false, error: payload.error })
      })
      const providerKey = this.opts.settings.ai.provider
      const model = this.opts.settings.ai[providerKey].model
      window.petAPI.chat.stream({
        requestId,
        provider: this.opts.settings.ai.provider,
        model,
        messages: requestMessages,
      })
    })
  }
}
