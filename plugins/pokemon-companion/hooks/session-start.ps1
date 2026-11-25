$ErrorActionPreference = 'Stop'
# SessionStart hook: tells the agent that pokemon-companion is installed and how to use it.
$context = @'
pokemon-companion MCP is installed: it operates the Windows desktop like a person at the screen.
Load and follow the pokemon-companion skill for tasks that need real apps or websites (Outlook, Teams, Telegram, Zalo, logged-in pages, open Excel), web research, reading mail or chats, messaging, or finding missing information.
If its tools are deferred, load them with tool search ("pokemon-companion").
Reuse open windows first, open apps through the taskbar Search button, and use the dedicated browser only as a last resort.
Send, post, delete or submit only with the user's explicit approval.
Move large text (code files, messages) with the clipboard and paste, then verify by reading back or exporting; never read, copy or enter tokens or passwords.
When done or waiting for the user, bring their chat window back to the front and update the pet with pokemon done/think.
Before the final reply, review the task for lessons (corrections, approved ways of working, repeated attempts) and save clear ones as the skill describes.
'@
$payload = @{ hookSpecificOutput = @{ hookEventName = 'SessionStart'; additionalContext = $context } }
[Console]::Out.Write(($payload | ConvertTo-Json -Compress -Depth 4))
