export type AppProfile = {urls: string[]; desktop_query: string; launch: string; ready: string; unavailable: string; conversation: string; composer: string};
export const appProfiles: Record<string, AppProfile> = {
	teams: {
		conversation: '[data-tid="chat-header-title"]', composer: '[data-tid="ckeditor"]',
		urls: ['https://teams.cloud.microsoft/', 'https://teams.microsoft.com/'], desktop_query: 'ms-teams', launch: 'ms-teams.exe',
		ready: '[data-tid="app-bar"],[data-tid="teams-app-bar"],[data-tid="chat-list"],[data-tid="app-layout-area"]',
		unavailable: 'input[type="email"],input[type="password"],input[autocomplete="one-time-code"],[data-testid="signin-button"]',
	},
	whatsapp: {
		conversation: '#main header [data-testid="conversation-info-header-chat-title"]', composer: '#main footer',
		urls: ['https://web.whatsapp.com/'], desktop_query: 'WhatsApp', launch: 'WhatsApp.exe',
		ready: '#pane-side,[aria-label="Chat list"],[data-testid="chat-list"]',
		unavailable: '[data-ref] canvas,[aria-label*="Scan"] canvas,input[name="phoneNumber"],input[autocomplete="one-time-code"]',
	},
	zalo: {
		conversation: '.chat-header .conversation-name', composer: '.chat-input',
		urls: ['https://chat.zalo.me/'], desktop_query: 'Zalo', launch: `${process.env.LOCALAPPDATA ?? ''}/Zalo/Zalo.exe`,
		ready: '#conversationList,.conv-list,.chat-list,.chatbox,[data-id="chat-list"]',
		unavailable: '.qr-container,.login-container,#login-form,input[type="password"],input[autocomplete="one-time-code"]',
	},
};
