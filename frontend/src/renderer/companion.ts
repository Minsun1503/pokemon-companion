import type { ChatMessage } from '../types/chat.js'
import type { CompanionChatReply, CompanionSnapshot } from '../types/companion.js'
import type { PetDefinition, PetSummary } from '../types/pet.js'
import { BubbleController } from './controllers/bubble-controller.js'
import { PetMotionController } from './controllers/pet-motion-controller.js'

declare global {
  interface Window {
    pokemonAPI: {
      load(): Promise<CompanionSnapshot>
      list(): Promise<(PetSummary & { definition: PetDefinition })[]>
      select(pet: string): Promise<boolean>
      pause(): Promise<boolean>
      quit(): void
      panel(open: boolean): void
      chat: {
        history(pet: string): Promise<ChatMessage[]>
        send(pet: string, text: string): Promise<CompanionChatReply>
      }
      ignoreMouse(ignore: boolean): void
      regions(regions: { x: number; y: number; width: number; height: number; interactive: boolean }[]): void
      onState(listener: (snapshot: CompanionSnapshot) => void): () => void
    }
  }
}

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing companion element ${id}`)
  return found as T
}
const petContainer = element('pet-container')
const petImage = element<HTMLImageElement>('pet-image')
const panel = element('team-panel')
const bubble = new BubbleController({ bubble: element('bubble'), anchor: petContainer })
type PanelView = 'actions' | 'switch' | 'talk'
let panelView: PanelView = 'actions'
let chatPet = ''
let chatRevision = 0
const pendingChats = new Map<string, string>()
const chatDrafts = new Map<string, string>()
let current: CompanionSnapshot | undefined
let motion: PetMotionController | undefined
let previousMessage = ''
let previousTarget = ''
let visualActivity = ''
let hoveringPet = false
let visualTimer: ReturnType<typeof setTimeout> | undefined
const log: string[] = []

function positionPanel(): void {
  if (panel.hidden) return
  const rect = petContainer.getBoundingClientRect()
  const width = panel.offsetWidth
  const height = panel.offsetHeight
  const left = rect.left + rect.width / 2 - width / 2
  const above = rect.top - height - 12
  const top =
    above >= 12
      ? above
      : rect.bottom + height + 12 <= window.innerHeight
        ? rect.bottom + 12
        : window.innerHeight - height - 12
  panel.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, left))}px`
  panel.style.top = `${Math.max(12, top)}px`
}

function setView(view: PanelView): void {
  panelView = view
  panel.dataset.view = view
  for (const name of ['actions', 'switch', 'talk'] as const) {
    element(name === 'actions' ? 'action-view' : `${name}-view`).hidden = name !== view
  }
  element('back-panel').hidden = view === 'actions'
  element('panel-caption').textContent = { actions: 'YOUR PARTNER', switch: 'CHOOSE YOUR PARTNER', talk: 'LET’S TALK' }[
    view
  ]
  positionPanel()
}

function closePanel(): void {
  panel.hidden = true
  petContainer.setAttribute('aria-expanded', 'false')
  window.pokemonAPI.panel(false)
}

function addChatMessage(role: string, text: string): HTMLElement {
  const message = document.createElement('p')
  message.className = `chat-message ${role}`
  message.textContent = text
  element('chat-messages').append(message)
  element('chat-messages').scrollTop = element('chat-messages').scrollHeight
  return message
}

function syncChatControls(): void {
  const pending = pendingChats.has(chatPet)
  element<HTMLButtonElement>('chat-send').disabled = pending
  element<HTMLTextAreaElement>('chat-input').disabled = pending
}

async function loadChat(): Promise<void> {
  if (!current) return
  const pet = current.state.pet
  const revision = ++chatRevision
  chatPet = pet
  element<HTMLTextAreaElement>('chat-input').value = chatDrafts.get(pet) ?? ''
  element('chat-messages').replaceChildren()
  element('chat-error').hidden = true
  syncChatControls()
  try {
    const history = await window.pokemonAPI.chat.history(pet)
    if (revision !== chatRevision || chatPet !== pet) return
    if (history.length === 0)
      addChatMessage('assistant', `Hi! I’m ${pet[0].toUpperCase() + pet.slice(1)}. What’s on your mind?`)
    else for (const message of history) addChatMessage(message.role, message.content)
    const pending = pendingChats.get(pet)
    if (pending) {
      addChatMessage('user', pending)
      addChatMessage('thinking', 'Thinking…')
    }
  } catch {
    if (revision === chatRevision) {
      element('chat-error').textContent = 'The conversation could not be loaded. Please reopen Talk.'
      element('chat-error').hidden = false
    }
  }
}

async function sendChat(): Promise<void> {
  const pet = chatPet
  const input = element<HTMLTextAreaElement>('chat-input')
  const text = input.value.trim()
  if (!pet || !text || pendingChats.has(pet)) return
  pendingChats.set(pet, text)
  chatDrafts.delete(pet)
  syncChatControls()
  input.value = ''
  element('chat-error').hidden = true
  addChatMessage('user', text)
  const thinking = addChatMessage('thinking', 'Thinking…')
  try {
    const reply = await window.pokemonAPI.chat.send(pet, text)
    pendingChats.delete(pet)
    if (chatPet !== pet) return
    thinking.remove()
    element('chat-messages')
      .querySelectorAll('.thinking')
      .forEach((entry) => {
        entry.remove()
      })
    if (reply.ok) {
      await loadChat()
      if (current?.state.pet === pet && panel.hidden) bubble.show(reply.content, 6000)
    } else {
      element('chat-error').textContent = reply.error
      element('chat-error').hidden = false
      input.value = text
      chatDrafts.set(pet, text)
    }
  } catch {
    if (chatPet === pet) {
      thinking.remove()
      element('chat-messages')
        .querySelectorAll('.thinking')
        .forEach((entry) => {
          entry.remove()
        })
      element('chat-error').textContent = 'The connection was interrupted. Please try again.'
      element('chat-error').hidden = false
      input.value = text
      chatDrafts.set(pet, text)
    }
  } finally {
    pendingChats.delete(pet)
    if (chatPet === pet) syncChatControls()
  }
}

function apply(snapshot: CompanionSnapshot): void {
  const changedPet = current?.state.pet !== snapshot.state.pet
  current = snapshot
  const { state, definition } = snapshot
  document.body.classList.toggle('inactive', !snapshot.active || !state.visible)
  if (!snapshot.active || !state.visible) closePanel()
  const activity = state.paused ? 'paused' : state.activity
  // Keep very short tool actions visible long enough to read as animation.
  if (activity !== 'idle' || (visualActivity !== 'working' && visualActivity !== 'thinking')) {
    clearTimeout(visualTimer)
    visualActivity = activity
    document.body.dataset.activity = activity
    if (activity === 'success') {
      visualTimer = setTimeout(() => {
        visualActivity = 'idle'
        document.body.dataset.activity = 'idle'
      }, 2600)
    }
  } else {
    clearTimeout(visualTimer)
    visualTimer = setTimeout(() => {
      visualActivity = 'idle'
      document.body.dataset.activity = 'idle'
    }, 900)
  }
  document.documentElement.style.setProperty('--accent', definition.theme.accentColor)
  if (changedPet) {
    const position = motion?.position ?? { x: window.innerWidth / 2, y: window.innerHeight - 170 }
    motion?.dispose()
    const companionDefinition = { ...definition, appearance: { ...definition.appearance, width: 100, height: 118 } }
    motion = new PetMotionController({
      petDefinition: companionDefinition,
      petImage,
      petContainer,
      initialPosition: position,
      canWalk: () =>
        Boolean(current?.active && !current.state.paused && visualActivity === 'idle' && !hoveringPet && panel.hidden),
      getMinY: () => bubble.getRequiredAnchorTop(),
      onPositionApplied: () => {
        bubble.updatePosition()
        positionPanel()
      },
    })
    petImage.alt = state.pet
    element('active-name').textContent = state.pet
    if (panelView === 'talk') void loadChat()
  }
  const targetKey = JSON.stringify(snapshot.target)
  if (snapshot.active && snapshot.target && (targetKey !== previousTarget || changedPet)) {
    motion?.moveTo(snapshot.target.x, snapshot.target.y)
    previousTarget = targetKey
  }
  const labels = {
    idle: 'Ready',
    working: 'Working',
    thinking: 'Thinking',
    success: 'All done!',
    error: 'Needs help',
    paused: 'Paused',
  }
  element('state-badge').textContent = labels[activity]
  element('task-title').textContent = state.paused ? 'Taking a break' : state.task || labels[activity]
  const message = state.paused ? 'Computer control paused. Resume when you’re ready.' : state.message
  element('task-message').textContent = message
  element('action-count').textContent = `${state.completedActions} action${state.completedActions === 1 ? '' : 's'}`
  element('pause-button').textContent = state.paused ? 'Resume control' : 'Pause control'
  element('activity-icon').textContent = {
    idle: '✦',
    working: '⌨',
    thinking: '✦',
    success: '✓',
    error: '!',
    paused: 'Ⅱ',
  }[activity]
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('.roster-pet'))) {
    button.classList.toggle('selected', button.dataset.pet === state.pet)
    button.setAttribute('aria-pressed', String(button.dataset.pet === state.pet))
  }
  if (message && (message !== previousMessage || changedPet)) {
    previousMessage = message
    if (snapshot.active && panel.hidden) {
      bubble.show(message, state.task ? 15000 : 6000)
      motion?.clampToViewport()
    }
    log.unshift(message)
    log.splice(8)
    element('activity-log').replaceChildren(
      ...log.map((text) => {
        const li = document.createElement('li')
        li.textContent = text
        return li
      }),
    )
  }
}

window.pokemonAPI.onState(apply)
async function bootstrap(): Promise<void> {
  apply(await window.pokemonAPI.load())
  const pets = await window.pokemonAPI.list()
  element('roster').replaceChildren(
    ...pets.map((pet) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'roster-pet'
      button.dataset.pet = pet.id
      button.setAttribute('aria-label', `Choose ${pet.id}`)
      const img = document.createElement('img')
      img.src = pet.definition.sprites.down?.[0] ?? ''
      img.alt = ''
      const label = document.createElement('span')
      label.textContent = pet.id
      button.append(img, label)
      button.addEventListener('click', () => {
        void window.pokemonAPI.select(pet.id).then((selected) => {
          if (selected) setView('actions')
        })
      })
      return button
    }),
  )
  if (current) apply(current)
}
petContainer.addEventListener('click', () => {
  if (!panel.hidden) {
    closePanel()
    return
  }
  panel.hidden = false
  bubble.hide()
  petContainer.setAttribute('aria-expanded', 'true')
  setView('actions')
  window.pokemonAPI.panel(true)
})
petContainer.addEventListener('mouseenter', () => {
  hoveringPet = true
  motion?.stopWalk()
})
petContainer.addEventListener('mouseleave', () => {
  hoveringPet = false
})
element('close-panel').addEventListener('click', closePanel)
element('back-panel').addEventListener('click', () => setView('actions'))
element('action-switch').addEventListener('click', () => setView('switch'))
element('action-talk').addEventListener('click', () => {
  setView('talk')
  void loadChat()
  element<HTMLTextAreaElement>('chat-input').focus()
})
element('action-exit').addEventListener('click', () => window.pokemonAPI.quit())
element('chat-form').addEventListener('submit', (event) => {
  event.preventDefault()
  void sendChat()
})
element('chat-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    void sendChat()
  }
})
element('chat-input').addEventListener('input', () => {
  chatDrafts.set(chatPet, element<HTMLTextAreaElement>('chat-input').value)
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !panel.hidden) {
    if (panelView === 'actions') closePanel()
    else setView('actions')
  }
})
element('pause-button').addEventListener('click', () => {
  void window.pokemonAPI.pause()
})
document.addEventListener('mousemove', (event) => {
  const inside = [petContainer, ...(!panel.hidden ? [panel] : [])].some((entry) => {
    const bounds = entry.getBoundingClientRect()
    return (
      event.clientX >= bounds.left &&
      event.clientX <= bounds.right &&
      event.clientY >= bounds.top &&
      event.clientY <= bounds.bottom
    )
  })
  window.pokemonAPI.ignoreMouse(!inside)
})
document.addEventListener('mouseleave', () => window.pokemonAPI.ignoreMouse(true))
window.addEventListener('resize', () => {
  motion?.clampToViewport()
  positionPanel()
})
setInterval(() => {
  const regions = [petContainer, element('bubble'), panel]
    .filter((entry) => !entry.hidden && getComputedStyle(entry).display !== 'none')
    .map((entry) => {
      const bounds = entry.getBoundingClientRect()
      return {
        x: Math.max(0, Math.floor(bounds.left) - 8),
        y: Math.max(0, Math.floor(bounds.top) - 8),
        width: Math.ceil(bounds.width) + 16,
        height: Math.ceil(bounds.height) + 16,
        interactive: entry !== element('bubble'),
      }
    })
  window.pokemonAPI.regions(regions)
}, 100)
void bootstrap().catch((error) => {
  element('bubble').textContent = String(error)
  element('bubble').style.display = 'block'
  console.error(error)
})
