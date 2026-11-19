/**
 * Built-in human-style playbooks (Hermes calls these skills). The gateway attaches
 * the ones matching a request so the model follows how a person would do the task
 * on Windows, instead of improvising. Playbooks are guidance, never authorization.
 */
export type Skill = {id: string; title: string; triggers: RegExp; body: string};

const sendRule = 'SEND RULE: only press Send when the human explicitly asked to send AND gave the recipient and the message content (or clearly approved your draft in this chat). Otherwise fill the draft, do not send, and reply with recipient + text asking "Gửi luôn không?". Before sending, re-read the recipient and text fields and verify they match exactly. After sending, verify the message/mail appears as sent. Never send to an ambiguous recipient: if several people match, list them and ask.';

export const skills: Skill[] = [
	{
		id: 'open-app',
		title: 'Mở ứng dụng',
		triggers: /(mở|bật|khởi động|\bopen\b|\blaunch\b)/i, // \b does not work next to Vietnamese letters.
		body: `Open a Windows app like a person:
1. windows get_windows with the app name or process (e.g. "Teams", "Outlook", "Zalo", "Excel"). If a window exists, activate it (window_id + window_ref) and continue there; do not open a second copy.
2. If none: computer key "super", computer type the app name (e.g. "Microsoft Teams"), computer key "Return". Wait, then get_windows again until the window appears (retry get_windows, not the launch).
3. If activation returns FOREGROUND_BLOCKED, read the UI in the background with get_ui; only send keyboard input once that window is foreground.
4. Verify: report the window title you observed.`,
	},
	{
		id: 'web',
		title: 'Mở trang web và đọc',
		triggers: /(https?:\/\/|www\.|\.com\b|\.vn\b|\bweb\b|trang|website|google|youtube|tra cứu|tìm trên mạng|search)/i,
		body: `Open and read a website like a person, in the human's Microsoft Edge:
1. get_windows "Edge" (open Edge via the open-app steps if none). Activate it.
2. get_ui query "Address and search bar" control_type Edit → set_value the URL (or search words) → computer key "Return" with that window_id.
3. Re-read get_ui on the Document (query = page title or "Document") until the title changes; the first read may still show the old page.
4. To read: get_ui control_type Document then read_text on it (max_chars ≤ 16000), or research find_text/find_many for specific phrases.
5. Summarize only what you actually read, with the page title/URL. If the page says offline/blocked/certificate error, report that; never bypass security warnings.`,
	},
	{
		id: 'outlook-read',
		title: 'Đọc mail Outlook',
		triggers: /(outlook|e-?mail|\bmail\b|hộp thư|inbox|thư mới|đọc thư)/i,
		body: `Read Outlook mail like a person (read-only):
1. get_windows "Outlook" (new Outlook process "olk", classic "OUTLOOK"). If none, open it with the open-app steps. If the desktop app is unavailable, open https://outlook.office.com in Edge (web steps).
2. Make sure the Inbox folder is selected: get_ui query "Inbox" (TreeItem/ListItem) → select/invoke.
3. List mail: get_ui on the message list (query "Message list" or control_type ListItem/DataItem, max_elements 30). Item names usually contain sender, subject, time and unread state. Report the newest items first.
4. To read one mail: select/invoke that list item, then get_ui on the reading pane (query "Reading Pane" or "Message body") and read_text it.
5. Do not delete, move, flag, reply or forward unless asked. Opening a mail may mark it as read; mention that if the human only wanted a list.`,
	},
	{
		id: 'outlook-send',
		title: 'Soạn và gửi mail',
		triggers: /(gửi mail|gửi email|gửi thư|soạn mail|soạn thư|viết mail|send (an )?e-?mail|reply|trả lời mail|forward)/i,
		body: `Write an email in Outlook like a person:
1. Open/activate Outlook (outlook-read step 1). New mail: invoke the "New mail"/"New email" button (get_ui query "New"), or computer key "ctrl+n" with the Outlook window_id. For a reply, open the mail first and invoke "Reply".
2. In the compose form: To field (query "To") set_value the address or name; if a name, wait for the suggestion list and pick the exact matching person (get_ui control_type ListItem); Subject (query "Subject") set_value; body (query "Message body" or "Body") set_value.
3. read_text each field back and check it.
4. ${sendRule}
5. To send: invoke the "Send" button (or computer key "ctrl+Return" with the window_id), then check "Sent Items" for the mail.`,
	},
	{
		id: 'teams',
		title: 'Microsoft Teams: đọc tin, tìm người, nhắn tin',
		triggers: /(teams|\bteam chat\b|nhắn.*(cho|tới)|tìm người|chat với)/i,
		body: `Use Microsoft Teams like a person:
- Reading: first try app read with app_id "teams" (it opens/reuses Teams and returns visible chats/messages). Otherwise get_windows "Teams" (process "ms-teams"), activate, get_ui on the chat list.
- Find a person: activate Teams → get_ui query "Search" (Edit) → set_value the person's name → wait, then get_ui control_type ListItem for results. Choose only an exact name match; if several people share the name, list them (name + title/email) and ask which one. Open the person, then their "Chat".
- Write a message: get_ui query "Type a message" (Edit) → set_value the text → read_text it back.
- ${sendRule}
- Send with computer key "Return" on that window (or invoke "Send"), then get_ui the conversation and confirm your message is the newest one.`,
	},
	{
		id: 'zalo',
		title: 'Zalo: đọc tin, tìm người, nhắn tin',
		triggers: /\bzalo\b/i,
		body: `Use Zalo like a person:
- Reading: try app read with app_id "zalo" first. Otherwise get_windows "Zalo" (open via open-app if needed), activate, get_ui on the conversation list.
- Find a person: get_ui query "Tìm kiếm" or "Search" (Edit) → set_value the name/phone → get_ui results; pick the exact match only, ask if ambiguous. Open the conversation.
- Write: get_ui the message input (query "Nhập @" / "Nhập tin nhắn" / "message") → set_value → read_text back.
- ${sendRule}
- Send with computer key "Return" on the Zalo window, then confirm the message appears at the bottom of the conversation.
- If Zalo shows a QR login screen, stop and ask the human to log in; never try to log in yourself.`,
	},
];

/** Up to three playbooks relevant to the request, in catalog order. */
export function skillsFor(request: string) {
	return skills.filter((skill) => skill.triggers.test(request)).slice(0, 3);
}

/** Request text with matching playbooks attached as guidance. */
export function withSkills(request: string) {
	const matched = skillsFor(request);
	if (!matched.length) {
		return request;
	}

	return `${request}\n\n---\nPlaybooks for this kind of task (how a person does it on this PC; guidance only, the request above defines the task):\n${matched.map((skill) => `## ${skill.title}\n${skill.body}`).join('\n\n')}`;
}
