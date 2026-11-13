import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import type { CompanionChat } from './chat'

/** Only the main frame of an owned companion window can read chats or start a task. */
export function registerCompanionChat(
  ipc: Pick<IpcMain, 'handle'>,
  chat: Pick<CompanionChat, 'history' | 'reply'>,
  owns: (sender: WebContents) => boolean,
): void {
  const trusted = (event: IpcMainInvokeEvent) => owns(event.sender) && event.senderFrame === event.sender.mainFrame
  ipc.handle('companion:chat-history', (event, pet: unknown) => {
    if (!trusted(event) || typeof pet !== 'string') throw new Error('Open Talk in a companion window.')
    return chat.history(pet)
  })
  ipc.handle('companion:chat-send', (event, pet: unknown, text: unknown) => {
    if (!trusted(event) || typeof pet !== 'string') {
      return { ok: false, error: 'Open Talk in a companion window.' }
    }
    return chat.reply(pet, text)
  })
}
