import type { PetDefinition } from '../../types/index.js'

interface PetMotionControllerOptions {
  petDefinition: PetDefinition
  petImage: HTMLImageElement
  petContainer: HTMLElement
  initialPosition: { x: number; y: number }
  canWalk: () => boolean
  getAnimation?: () => string
  getMinY?: () => number
  onPositionApplied: () => void
  onAnimationApplied?: () => void
}

const SPAWN_MARGIN = 10

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function getInitialPetPosition(
  petDefinition: PetDefinition,
  launchParams: URLSearchParams,
): { x: number; y: number } {
  const petWidth = petDefinition.appearance.width
  const petHeight = petDefinition.appearance.height
  const requestedSpawnX = Number(launchParams.get('spawnX'))
  const requestedSpawnY = Number(launchParams.get('spawnY'))

  if (Number.isFinite(requestedSpawnX) && Number.isFinite(requestedSpawnY)) {
    return {
      x: Math.max(SPAWN_MARGIN, Math.min(window.innerWidth - petWidth - SPAWN_MARGIN, requestedSpawnX - petWidth / 2)),
      y: Math.max(SPAWN_MARGIN, Math.min(window.innerHeight - petHeight - SPAWN_MARGIN, requestedSpawnY)),
    }
  }

  return {
    x: randomBetween(SPAWN_MARGIN, Math.max(SPAWN_MARGIN, window.innerWidth - petWidth - SPAWN_MARGIN)),
    y: randomBetween(SPAWN_MARGIN, Math.max(SPAWN_MARGIN, window.innerHeight - petHeight - SPAWN_MARGIN)),
  }
}

export class PetMotionController {
  readonly width: number
  readonly height: number
  readonly spawnMargin = SPAWN_MARGIN

  private x: number
  private y: number
  private walkSpeed: number
  private moveX = 0
  private moveY = 0
  private direction = 'down'
  private action = 'walk'
  private turnCooldown = 0
  private frameIndex = 0
  private frameTick = 0
  private jumpTick = 0
  private jumpCooldown = 0
  private target: { x: number; y: number } | null = null
  private requestedAnimation: string | undefined
  private animationTime = 0
  private readonly reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  private readonly timer: ReturnType<typeof setInterval>

  constructor(private readonly opts: PetMotionControllerOptions) {
    this.width = opts.petDefinition.appearance.width
    this.height = opts.petDefinition.appearance.height
    this.x = opts.initialPosition.x
    this.y = opts.initialPosition.y
    this.walkSpeed = opts.petDefinition.movement.speed
    this.resetRandomMoveVector()
    this.jumpCooldown = randomBetween(80, 220)
    this.applyPosition()
    this.setFrame(opts.petDefinition.sprites.idle ? 'idle' : 'walk', this.direction, 0)
    this.timer = setInterval(() => this.tick(), 30)
  }

  get position(): { x: number; y: number } {
    return { x: this.x, y: this.y }
  }

  get isPerformingAction(): boolean {
    return this.animationTime > 0
  }

  playAnimation(animation: string | undefined, duration: number): void {
    this.requestedAnimation = animation
    this.animationTime = animation ? duration : 0
  }

  setPosition(x: number, y: number): void {
    const minY = this.getMinY()
    const maxY = this.getMaxY()
    this.x = Math.max(0, Math.min(window.innerWidth - this.width, x))
    this.y = Math.max(minY, Math.min(maxY, y))
    this.applyPosition()
  }

  moveTo(x: number, y: number): void {
    this.target = {
      x: Math.max(0, Math.min(window.innerWidth - this.width, x)),
      y: Math.max(this.getMinY(), Math.min(this.getMaxY(), y)),
    }
  }

  dispose(): void {
    clearInterval(this.timer)
  }

  setDirectionDown(): void {
    this.direction = 'down'
  }

  startWalk(): void {
    this.action = 'walk'
    this.walkSpeed = this.opts.petDefinition.movement.speed
    this.frameIndex = 0
    this.frameTick = 0
    this.resetRandomMoveVector()
  }

  stopWalk(): void {
    this.action = 'idle'
    this.frameIndex = 0
    this.frameTick = 0
  }

  triggerJump(): void {
    if (this.jumpTick <= 0) {
      this.jumpTick = this.opts.petDefinition.movement.jumpDuration
    }
  }

  clampToViewport(): void {
    this.setPosition(this.x, this.y)
  }

  private tick(): void {
    const activity = this.opts.getAnimation?.() ?? 'idle'
    const animation =
      activity !== 'paused' && this.requestedAnimation && this.animationTime > 0 ? this.requestedAnimation : activity
    if (animation === 'paused') {
      this.target = null
      this.jumpTick = 0
      this.playAnimation(undefined, 0)
    }
    const reducedMotion = Boolean(this.reducedMotion?.matches)
    if (reducedMotion && this.target) {
      this.setPosition(this.target.x, this.target.y)
      this.target = null
    }
    const canWalk = animation !== 'paused' && !reducedMotion && (this.opts.canWalk() || this.target !== null)
    const previousX = this.x
    const previousY = this.y

    if (canWalk) {
      if (this.target) {
        const dx = this.target.x - this.x
        const dy = this.target.y - this.y
        const distance = Math.hypot(dx, dy)
        if (distance < 3) {
          this.setPosition(this.target.x, this.target.y)
          this.target = null
        } else {
          const step = Math.min(distance, Math.max(4, distance * 0.16))
          this.direction = this.getDirectionFromVector(dx, dy)
          this.setPosition(this.x + (dx / distance) * step, this.y + (dy / distance) * step)
        }
      } else this.walk()
    }

    const moving = this.x !== previousX || this.y !== previousY
    if (!moving) this.animationTime = Math.max(0, this.animationTime - 30)
    const action = moving ? (this.opts.petDefinition.sprites.run ? 'run' : 'walk') : animation
    if (action !== this.action) {
      this.action = action
      this.frameIndex = 0
      this.frameTick = 0
    }
    const direction = !moving && this.opts.getAnimation ? 'down' : this.direction

    if (this.jumpTick > 0) {
      this.jumpTick--
    }

    this.frameTick++
    const movement = this.opts.petDefinition.movement
    const frameInterval = moving ? movement.walkFrameInterval : movement.idleFrameInterval
    if (this.frameTick >= frameInterval) {
      this.frameTick = 0
      this.frameIndex++
    }
    this.setFrame(this.action, direction, this.frameIndex)
  }

  private walk(): void {
    const nextX = this.x + this.moveX
    const nextY = this.y + this.moveY
    if (this.canOccupyPosition(nextX, nextY)) {
      this.x = nextX
      this.y = nextY
    } else if (this.canOccupyPosition(nextX, this.y)) {
      this.x = nextX
      this.moveY *= -1
      this.frameIndex = 0
    } else if (this.canOccupyPosition(this.x, nextY)) {
      this.y = nextY
      this.moveX *= -1
      this.frameIndex = 0
    } else {
      this.moveX *= -1
      this.moveY *= -1
      this.frameIndex = 0
    }

    this.direction = this.getDirectionFromVector(this.moveX, this.moveY)
    this.turnCooldown--
    if (this.turnCooldown <= 0 && Math.random() < 0.006) {
      this.resetRandomMoveVector()
      this.turnCooldown = randomBetween(90, 220)
    }

    this.jumpCooldown--
    if (this.jumpCooldown <= 0 && !this.opts.petDefinition.sprites.run) {
      this.triggerJump()
      this.jumpCooldown = randomBetween(120, 320)
    }

    this.applyPosition()
  }

  private canOccupyPosition(x: number, y: number): boolean {
    const centerX = x + this.width / 2
    const centerY = y + this.height / 2
    return centerX >= 0 && centerX <= window.innerWidth && y >= this.getMinY() && centerY <= window.innerHeight
  }

  private getMinY(): number {
    return Math.max(0, Math.min(window.innerHeight - this.height, this.opts.getMinY?.() ?? 0))
  }

  private getMaxY(): number {
    return Math.max(this.getMinY(), window.innerHeight - this.height)
  }

  private applyPosition(): void {
    this.opts.petContainer.style.left = `${this.x}px`
    this.opts.petContainer.style.top = `${this.y}px`
    this.opts.petContainer.style.bottom = 'auto'
    this.opts.onPositionApplied()
  }

  private resetRandomMoveVector(): void {
    const angle = Math.random() * Math.PI * 2
    this.moveX = Math.cos(angle) * this.walkSpeed
    this.moveY = Math.sin(angle) * this.walkSpeed * 0.75
    this.direction = this.getDirectionFromVector(this.moveX, this.moveY)
    this.frameIndex = 0
  }

  private getDirectionFromVector(dx: number, dy: number): string {
    const absX = Math.abs(dx)
    const absY = Math.abs(dy)
    if (absY > absX * 1.2) {
      return dy < 0 ? 'up' : 'down'
    }
    if (absX > absY * 1.2) {
      return dx < 0 ? 'left' : 'right'
    }
    if (dy < 0 && dx < 0) {
      return 'up_left'
    }
    if (dy < 0 && dx >= 0) {
      return 'up_right'
    }
    if (dy >= 0 && dx < 0) {
      return 'down_left'
    }
    return 'down_right'
  }

  private getSpriteKey(dir: string): string {
    if (dir === 'up') {
      return 'back_up'
    }
    if (dir === 'up_left' || dir === 'up_right') {
      return 'back_side'
    }
    if (dir === 'down') {
      return 'down'
    }
    if (dir === 'down_left' || dir === 'down_right') {
      return 'side'
    }
    if (dir === 'left' || dir === 'right') {
      return 'side'
    }
    return 'down'
  }

  private setFrame(action: string, dir: string, idx: number): void {
    const sprites = this.opts.petDefinition.sprites
    const directionalRun = `run_${this.getSpriteKey(dir)}`
    const key =
      action === 'run' && sprites[directionalRun]
        ? directionalRun
        : action === 'run' && dir.startsWith('up') && sprites.run_back
          ? 'run_back'
          : action
    const reducedMotion = Boolean(this.reducedMotion?.matches)
    const frames = (!reducedMotion ? sprites[key] : undefined) ?? sprites[this.getSpriteKey(dir)] ?? sprites.down
    if (!frames?.length) {
      return
    }
    const source = frames[action === 'paused' || reducedMotion ? 0 : idx % frames.length]
    // Reassigning the same GIF restarts it, preventing the action from completing a cycle.
    if (this.opts.petImage.src !== source) this.opts.petImage.src = source
    this.opts.petContainer.dataset.animation = action
    this.opts.petContainer.dataset.direction = dir
    this.updateSpriteTransform(action, dir, idx)
    this.opts.onAnimationApplied?.()
  }

  private updateSpriteTransform(action: string, dir: string, idx: number): void {
    const movement = this.opts.petDefinition.movement
    const isLeft = dir === 'left' || dir === 'up_left' || dir === 'down_left'
    const flip = isLeft ? 'scaleX(-1)' : 'scaleX(1)'
    const walkBob = action === 'walk' && idx % 2 === 1 ? -2 : 0
    const jumpBob =
      this.jumpTick > 0
        ? -Math.sin(((movement.jumpDuration - this.jumpTick) / movement.jumpDuration) * Math.PI) * movement.jumpHeight
        : 0
    this.opts.petImage.style.transform = `${flip} translateY(${Math.round(walkBob + jumpBob)}px)`
  }
}
