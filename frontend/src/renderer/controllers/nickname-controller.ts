import type { PetDefinition, PetProfile } from '../../types/index.js'

interface NicknameControllerOptions {
  petDefinition: PetDefinition
  petProfile: PetProfile
  nameElement: HTMLElement
  inputElement: HTMLInputElement
}

export class NicknameController {
  private currentNickname: string
  private saveOnBlur = true

  constructor(private readonly opts: NicknameControllerOptions) {
    this.currentNickname = opts.petProfile.nickname ?? opts.petDefinition.name
    opts.nameElement.textContent = this.displayName
    opts.inputElement.setAttribute('aria-label', `${opts.petDefinition.name} 닉네임`)

    opts.nameElement.addEventListener('mousedown', (event) => event.stopPropagation())
    opts.nameElement.addEventListener('click', (event) => this.startEdit(event))
    opts.inputElement.addEventListener('mousedown', (event) => event.stopPropagation())
    opts.inputElement.addEventListener('blur', () => {
      void this.finishEdit(this.saveOnBlur)
    })
    opts.inputElement.addEventListener('keydown', (event) => this.handleKeydown(event))
  }

  private get displayName(): string {
    return `🐾 ${this.currentNickname}`
  }

  get customNickname(): string | null {
    const nickname = this.currentNickname.trim()
    return nickname && nickname !== this.opts.petDefinition.name ? nickname : null
  }

  private startEdit(event: Event): void {
    event.stopPropagation()
    this.saveOnBlur = true
    this.opts.nameElement.style.display = 'none'
    this.opts.inputElement.style.display = 'block'
    this.opts.inputElement.value = this.currentNickname
    this.opts.inputElement.focus()
    this.opts.inputElement.select()
  }

  private async finishEdit(save: boolean): Promise<void> {
    const nextNickname = save ? this.opts.inputElement.value.trim() : this.currentNickname
    this.currentNickname = nextNickname || this.opts.petDefinition.name
    this.opts.nameElement.textContent = this.displayName
    this.opts.nameElement.style.display = 'block'
    this.opts.inputElement.style.display = 'none'
    if (save) {
      await window.petAPI.pet.saveNickname(nextNickname)
    }
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      this.saveOnBlur = true
      this.opts.inputElement.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      this.saveOnBlur = false
      this.opts.inputElement.value = this.currentNickname
      this.opts.inputElement.blur()
    }
  }
}
