import type { ChatMessage } from '../../types/index.js'

interface MessageListOptions {
  container: HTMLElement
  petId: string
  menu: HTMLElement
  copyButton: HTMLElement
  deleteButton: HTMLElement
  resendButton: HTMLElement
  menuBounds: HTMLElement
  onCopy: (text: string) => void
  onDelete: (entry: ChatMessage) => Promise<void>
  onResend: (entry: ChatMessage) => Promise<void>
  onLoadMore: () => void
}

export interface RenderedMessage {
  role: ChatMessage['role']
  text: string
  entry: ChatMessage | null
}

const LOAD_MORE_SCROLL_THRESHOLD_PX = 24

export class MessageList {
  private readonly entries = new WeakMap<HTMLElement, ChatMessage>()
  private selectedElement: HTMLElement | null = null
  private pendingScrollFrame: number | null = null

  constructor(private readonly opts: MessageListOptions) {
    opts.container.addEventListener('contextmenu', (event) => this.openMenu(event))
    opts.container.addEventListener('scroll', () => {
      if (opts.container.scrollTop <= LOAD_MORE_SCROLL_THRESHOLD_PX) {
        opts.onLoadMore()
      }
    })
    opts.deleteButton.addEventListener('click', () => {
      void this.deleteSelected()
    })
    opts.resendButton.addEventListener('click', () => {
      void this.resendSelected()
    })
    opts.copyButton.addEventListener('click', () => this.copySelected())
    document.addEventListener('mousedown', (event) => {
      if (!opts.menu.contains(event.target as Node)) {
        this.hideMenu()
      }
    })
  }

  add(
    role: ChatMessage['role'],
    text: string,
    entry: ChatMessage | null = null,
    { scroll = true }: { scroll?: boolean } = {},
  ): HTMLElement {
    const element = this.createElement(role, text, entry)
    this.opts.container.appendChild(element)
    if (scroll) {
      this.scrollToBottom()
    }
    return element
  }

  render(messages: RenderedMessage[]): void {
    this.hideMenu()
    const fragment = document.createDocumentFragment()
    for (const message of messages) {
      fragment.appendChild(this.createElement(message.role, message.text, message.entry))
    }
    this.opts.container.replaceChildren(fragment)
    this.scrollToBottom()
  }

  prepend(messages: RenderedMessage[]): void {
    if (messages.length === 0) {
      return
    }
    this.hideMenu()
    if (this.pendingScrollFrame !== null) {
      cancelAnimationFrame(this.pendingScrollFrame)
      this.pendingScrollFrame = null
    }
    const previousScrollHeight = this.opts.container.scrollHeight
    const fragment = document.createDocumentFragment()
    for (const message of messages) {
      fragment.appendChild(this.createElement(message.role, message.text, message.entry))
    }
    this.opts.container.prepend(fragment)
    this.opts.container.scrollTop += this.opts.container.scrollHeight - previousScrollHeight
  }

  private createElement(role: ChatMessage['role'], text: string, entry: ChatMessage | null = null): HTMLElement {
    const element = document.createElement('div')
    element.className = `msg ${role}`
    element.textContent = text
    if (role === 'assistant') {
      element.dataset.petId = this.opts.petId
    }
    if (entry) {
      this.bind(element, entry)
    }
    return element
  }

  bind(element: HTMLElement, entry: ChatMessage): void {
    this.entries.set(element, entry)
    element.dataset.deletable = 'true'
  }

  hideMenu(): void {
    this.opts.menu.style.display = 'none'
    this.selectedElement = null
  }

  clear(): void {
    this.hideMenu()
    this.opts.container.replaceChildren()
  }

  scrollToBottom(): void {
    this.scrollToBottomNow()
    if (this.pendingScrollFrame !== null) {
      cancelAnimationFrame(this.pendingScrollFrame)
    }
    this.keepBottomPinnedForFrames(2)
  }

  private scrollToBottomNow(): void {
    this.opts.container.scrollTop = this.opts.container.scrollHeight
  }

  private keepBottomPinnedForFrames(frameCount: number): void {
    let remainingFrames = frameCount
    const scrollAfterLayout = (): void => {
      this.scrollToBottomNow()
      remainingFrames -= 1
      this.pendingScrollFrame = remainingFrames > 0 ? requestAnimationFrame(scrollAfterLayout) : null
    }
    this.pendingScrollFrame = requestAnimationFrame(scrollAfterLayout)
  }

  private openMenu(event: MouseEvent): void {
    const message = (event.target as HTMLElement).closest<HTMLElement>('.msg')
    if (!message) {
      return
    }

    event.preventDefault()
    this.selectedElement = message
    const entry = this.entries.get(message)
    this.opts.copyButton.style.display = message.textContent ? 'block' : 'none'
    this.opts.deleteButton.style.display = entry ? 'block' : 'none'
    this.opts.resendButton.style.display = entry?.role === 'user' ? 'block' : 'none'
    this.opts.menu.style.display = 'block'

    const bounds = this.opts.menuBounds.getBoundingClientRect()
    const left = Math.min(event.clientX - bounds.left, bounds.width - this.opts.menu.offsetWidth - 6)
    const top = Math.min(event.clientY - bounds.top, bounds.height - this.opts.menu.offsetHeight - 6)
    this.opts.menu.style.left = `${Math.max(6, left)}px`
    this.opts.menu.style.top = `${Math.max(6, top)}px`
  }

  private async deleteSelected(): Promise<void> {
    const element = this.selectedElement
    const entry = element && this.entries.get(element)
    this.hideMenu()
    if (!element || !entry) {
      return
    }
    await this.opts.onDelete(entry)
    element.remove()
  }

  private async resendSelected(): Promise<void> {
    const element = this.selectedElement
    const entry = element && this.entries.get(element)
    this.hideMenu()
    if (entry?.role !== 'user') {
      return
    }
    await this.opts.onResend(entry)
  }

  private copySelected(): void {
    const element = this.selectedElement
    if (!element?.textContent) {
      this.hideMenu()
      return
    }
    this.opts.onCopy(element.textContent)
    const btn = this.opts.copyButton
    const original = btn.textContent
    btn.textContent = '✓ 복사됨'
    setTimeout(() => {
      btn.textContent = original
      this.hideMenu()
      this.selectedElement = null
    }, 900)
  }
}
