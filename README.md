# Tracer

Tracer is a free Windows desktop app that captures a screen and asks ChatGPT about it. The request uses the person's own ChatGPT Plus or Pro plan. Tracer does not charge for the model and does not ask for an API key.

Gemini and Claude stay manual. Tracer can open the official site and copy the screenshot and prompt. It does not sign in to those accounts.

## What happens

1. Press `Ctrl+Shift+Space`, or the shortcut you set. Tracer hides its window and freezes each monitor.
2. Drag with the left button to capture that area, or right-click to capture the monitor under the pointer. Escape cancels and keeps the previous preview.
3. The window then shows a preview. Nothing is uploaded yet.
4. Edit the prompt, or pick one from Past Prompts, Favorites, or Saved Prompts. Ctrl+Enter submits it. The File menu has the same command.
5. For ChatGPT, open the account chip and choose **Continue with ChatGPT** if you are not already connected.
6. The answer appears in Tracer. A follow-up sends the screenshot again with the conversation, so it uses more of the plan allowance.
7. **Remove preview** drops the screenshot and the conversation. **Disconnect** revokes the ChatGPT refresh token and deletes the local credential.

## ChatGPT

Sign-in follows OpenAI's Sign in with ChatGPT flow for a local open-source app:

- The system browser opens `https://auth.openai.com`. Tracer never sees the password.
- The callback is `http://127.0.0.1:<port>/auth/callback` with PKCE. The page does not echo the code.
- Plan use requires the `chatgpt.tokens.use.direct` permission. Sign-in alone is not enough. A free ChatGPT account is not described as eligible.
- Analysis calls `POST https://api.openai.com/v1/responses` with `store: false` and `stream: true`. The model is the first one the account lists, not a key baked into Tracer.
- The screenshot is sent as an `input_image` data URL. OpenAI's plan-usage preview says text, images, and files are supported when the selected model accepts them. The DevKit's text helper does not accept images, so Tracer uses that documented Responses image input directly.
- Tokens stay in the main process and are encrypted with the operating system's credential store. The window only receives status, the email label, and the answer.
- **Manage usage** opens `https://chatgpt.com/settings/usage`.

Plus plan limits are shared with other apps. If ChatGPT reports that the allowance is used up, wait for it to reset or manage usage there. A refresh can also fail and ask for sign-in again.

## Gemini and Claude

These are labeled **Open in browser**. There is no Connect button. Tracer copies the screenshot and the prompt, then opens `https://gemini.google.com/app` or `https://claude.ai/new`. Paste them yourself. That is not an automatic connection. No official third-party subscription API for those consumer plans was confirmed for this app.

## Privacy and limits

- The screenshot is not written to disk.
- The saved prompt is local. The conversation is kept only until Clear or a new capture.
- There is no analytics.
- Capture is the dragged area, or one whole monitor on right-click. The selection overlay is drawn after the snapshot, so it is not part of the picture.
- The production window cannot reach the network. Only the main process talks to ChatGPT.
- The packaged app is unsigned, so Windows SmartScreen can warn on first launch.
- macOS and Linux builds exist in the Forge config and have not been run here.

## Develop

Requirements: Windows, Node.js, and npm.

```bash
npm install
npm start
npm test
npm run package
```

`npm start` opens the app and registers `Ctrl+Shift+Space`. `npm test` uses mocked ChatGPT responses and does not contact OpenAI. A live region capture was run on this Windows PC. An authenticated ChatGPT reply, a second monitor, and pasting into Gemini or Claude still need a person.

The local `backend/` folder is an unused loopback stub. The desktop app does not start it.
