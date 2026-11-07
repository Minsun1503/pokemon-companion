interface PetMotionLike {
  readonly height: number
  readonly spawnMargin: number
  readonly position: { x: number; y: number }
  setPosition(x: number, y: number): void
}

interface ChatWindowControllerOptions {
  chatWindow: HTMLElement
  chatHeader: HTMLElement
  petContainer: HTMLElement
  resizeHandles: Iterable<HTMLElement>
  petMotion: PetMotionLike
  chatPetGap: number
  onStartDrag: (payload: {
    x: number
    y: number
    startX: number
    startY: number
    chatWidth: number
    chatHeight: number
  }) => void
  onStopPetDrag: (wasChatDragging: boolean) => void
  onPointerMoveIdle: (x: number, y: number) => void
  onPointerUp: (x: number, y: number) => void
  setMouseIgnore: (ignore: boolean) => void
  isPetDragging: () => boolean
  hasPetDragStarted: () => boolean
}

export class ChatWindowController {
  private chatDragging = false
  private chatDragStartX = 0
  private chatDragStartY = 0
  private chatStartLeft = 0
  private chatStartTop = 0
  private petStartLeft = 0
  private petStartTop = 0
  private groupMinDX = 0
  private groupMaxDX = 0
  private groupMinDY = 0
  private groupMaxDY = 0

  private resizeActive = false
  private resizeDirection = ''
  private resizeStartX = 0
  private resizeStartY = 0
  private resizeStartWidth = 0
  private resizeStartHeight = 0
  private resizeStartLeft = 0
  private resizeStartTop = 0

  constructor(private readonly opts: ChatWindowControllerOptions) {
    opts.chatHeader.addEventListener('mousedown', (event) => this.startChatDrag(event))
    for (const handle of opts.resizeHandles) {
      handle.addEventListener('mousedown', (event) => this.startResize(event, handle))
    }
    document.addEventListener('mousemove', (event) => this.handleMouseMove(event))
    document.addEventListener('mouseup', (event) => this.handleMouseUp(event))
  }

  isInteracting(): boolean {
    return this.chatDragging || this.resizeActive
  }

  private startChatDrag(event: MouseEvent): void {
    const target = event.target as HTMLElement
    if (target.id === 'close-chat' || target.closest('button,input,select,textarea,#pet-picker')) {
      return
    }
    const chatRect = this.opts.chatWindow.getBoundingClientRect()
    const petRect = this.opts.petContainer.getBoundingClientRect()
    this.chatDragging = true
    this.chatDragStartX = event.clientX
    this.chatDragStartY = event.clientY
    this.chatStartLeft = chatRect.left
    this.chatStartTop = chatRect.top
    this.petStartLeft = petRect.left
    this.petStartTop = petRect.top

    const groupLeft = Math.min(chatRect.left, petRect.left)
    const groupRight = Math.max(chatRect.right, petRect.right)
    const groupTop = Math.min(chatRect.top, petRect.top)
    const groupBottom = Math.max(chatRect.bottom, petRect.bottom)
    this.groupMinDX = -groupLeft
    this.groupMaxDX = window.innerWidth - groupRight
    this.groupMinDY = -groupTop
    this.groupMaxDY = window.innerHeight - groupBottom

    this.opts.onStartDrag({
      x: event.clientX - petRect.left,
      y: event.clientY - petRect.top,
      startX: this.opts.petMotion.position.x,
      startY: this.opts.petMotion.position.y,
      chatWidth: chatRect.width,
      chatHeight: chatRect.height,
    })
    this.opts.setMouseIgnore(false)
    event.preventDefault()
  }

  private startResize(event: MouseEvent, handle: HTMLElement): void {
    this.resizeActive = true
    this.resizeDirection = handle.id.replace('rz-', '')
    const rect = this.opts.chatWindow.getBoundingClientRect()
    this.resizeStartX = event.clientX
    this.resizeStartY = event.clientY
    this.resizeStartWidth = rect.width
    this.resizeStartHeight = rect.height
    this.resizeStartLeft = rect.left
    this.resizeStartTop = rect.top
    this.opts.setMouseIgnore(false)
    event.preventDefault()
    event.stopPropagation()
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.opts.isPetDragging() && !this.chatDragging && !this.resizeActive) {
      this.opts.onPointerMoveIdle(event.clientX, event.clientY)
    }

    if (this.chatDragging) {
      this.moveChatGroup(event)
      return
    }

    if (this.resizeActive) {
      this.resizeChatWindow(event)
    }
  }

  private handleMouseUp(event: MouseEvent): void {
    const wasChatDragging = this.chatDragging
    this.chatDragging = false

    if (this.resizeActive) {
      this.resizeActive = false
    } else if (this.opts.hasPetDragStarted()) {
      this.opts.onStopPetDrag(wasChatDragging)
    }
    this.opts.onPointerUp(event.clientX, event.clientY)
  }

  private moveChatGroup(event: MouseEvent): void {
    const dx = Math.max(this.groupMinDX, Math.min(this.groupMaxDX, event.clientX - this.chatDragStartX))
    const dy = Math.max(this.groupMinDY, Math.min(this.groupMaxDY, event.clientY - this.chatDragStartY))
    this.opts.chatWindow.style.left = `${this.chatStartLeft + dx}px`
    this.opts.chatWindow.style.top = `${this.chatStartTop + dy}px`
    this.opts.chatWindow.style.right = 'auto'
    this.opts.chatWindow.style.bottom = 'auto'
    this.opts.petMotion.setPosition(this.petStartLeft + dx, this.petStartTop + dy)
  }

  private resizeChatWindow(event: MouseEvent): void {
    const dx = event.clientX - this.resizeStartX
    const dy = event.clientY - this.resizeStartY
    let newWidth = this.resizeStartWidth
    let newHeight = this.resizeStartHeight
    let newLeft = this.resizeStartLeft
    let newTop = this.resizeStartTop

    if (this.resizeDirection.includes('e')) {
      newWidth = Math.max(200, this.resizeStartWidth + dx)
    }
    if (this.resizeDirection.includes('s')) {
      newHeight = Math.max(180, this.resizeStartHeight + dy)
      const maxHeightWithPetBelow = Math.max(
        180,
        window.innerHeight -
          newTop -
          this.opts.petMotion.height -
          this.opts.petMotion.spawnMargin -
          this.opts.chatPetGap,
      )
      newHeight = Math.min(newHeight, maxHeightWithPetBelow)
    }
    if (this.resizeDirection.includes('w')) {
      newWidth = Math.max(200, this.resizeStartWidth - dx)
      newLeft = this.resizeStartLeft + this.resizeStartWidth - newWidth
    }
    if (this.resizeDirection.includes('n')) {
      newHeight = Math.max(180, this.resizeStartHeight - dy)
      newTop = this.resizeStartTop + this.resizeStartHeight - newHeight
    }

    this.opts.chatWindow.style.width = `${newWidth}px`
    this.opts.chatWindow.style.height = `${newHeight}px`
    this.opts.chatWindow.style.left = `${newLeft}px`
    this.opts.chatWindow.style.top = `${newTop}px`
    this.opts.chatWindow.style.right = 'auto'
    this.opts.chatWindow.style.bottom = 'auto'

    if (this.resizeDirection.includes('s')) {
      const desiredPetY = newTop + newHeight + this.opts.chatPetGap
      const maxPetY = window.innerHeight - this.opts.petMotion.height - this.opts.petMotion.spawnMargin
      this.opts.petMotion.setPosition(
        this.opts.petMotion.position.x,
        Math.min(maxPetY, Math.max(this.opts.petMotion.spawnMargin, desiredPetY)),
      )
    }
  }
}
