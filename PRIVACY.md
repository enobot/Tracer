# Tracer privacy notice

Tracer is a desktop app. It has no server of its own, no accounts of its own, no analytics, no crash reporting, and no update checks. The developer receives nothing from your copy of Tracer.

## What leaves your computer

- **Your screenshot and question go to OpenAI** when you use ChatGPT: right after you finish a selection if "Send right after capture" is on (the default), or when you choose Analyze screenshot or send a follow-up question. Each follow-up sends the screenshot again, with the earlier questions and answers in that conversation. The request also names the answer language you chose. OpenAI handles this under the terms and privacy policy of your ChatGPT account. Tracer asks OpenAI not to store the response for later retrieval (`store: false`), but OpenAI's own retention policies still apply.
- **Signing in** happens in your web browser on OpenAI's site. Tracer never sees your password. OpenAI returns access tokens to Tracer through a temporary address on your own computer (`127.0.0.1`).
- **Gemini and Claude**: Tracer sends nothing to Google or Anthropic. It copies the screenshot and question to your clipboard and opens the website. What you paste there is covered by that service's terms.

Nothing is sent while Tracer sits idle in the tray.

## What stays on your computer

Stored in `%APPDATA%\Tracer`:

- your ChatGPT sign-in tokens, encrypted with Windows (DPAPI) for your Windows account;
- your saved prompts, past prompts, and favorites (not encrypted);
- your settings: language, shortcut, whether to send right after capture, whether the prompts panel is hidden, and whether the tray notice has been shown.

Screenshots and answers are kept in memory only and are gone when you remove the screenshot or quit. After a Gemini or Claude handoff, the screenshot stays on the clipboard until you copy something else; Windows clipboard history may keep it too.

## Removing your data

1. In Tracer, open the account menu and choose **Disconnect**. This removes Tracer's access to your ChatGPT account.
2. Check ChatGPT Settings → Security and login → Login connections, and remove Tracer if it is still listed.
3. Uninstall Tracer from Settings → Apps.
4. Delete the folder `%APPDATA%\Tracer`. Uninstalling does not remove it.

Tracer is not affiliated with or endorsed by OpenAI, Google, or Anthropic.
