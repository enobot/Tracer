# Tracer privacy review

Date: 25 October 2026. Code: `c768a2d` plus the audit fixes. This is an engineering review of what the code does. It is not a privacy policy or legal advice.

## 1. Summary

Tracer has no server, no accounts of its own, no analytics, no crash reporting, and no update checks. The packaged app had no network connections while idle. Screenshots stay in memory and leave Tracer only when you capture with "Send right after capture" on (the default), or when you choose Analyze screenshot or send a question. They go to OpenAI for ChatGPT, or onto the clipboard for Gemini and Claude.

Four areas need clearer disclosure or a small change:

- the clipboard after a handoff,
- prompts stored as plain text,
- what Disconnect and Uninstall leave behind,
- what `store: false` does and does not mean.

## 2. Data Tracer's developer collects

None. The app sends no telemetry or identifiers to the developer.

## 3. Data stored on the computer

Everything lives in `%APPDATA%\tracer` (the Electron profile for product name `tracer`).

| Item                                                                         | Contents                                                                                              | Protection                                                                      | Lifetime                                                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `chatgpt-connection.bin`                                                     | Status, issued client id, OpenAI subject id, email, name, scopes, access token, refresh token, expiry | `safeStorage`: AES-256-GCM with a key that DPAPI protects for this Windows user | Tokens until Disconnect or sign-in failure; identifiers until the file is deleted |
| `chatgpt-host-id`                                                            | Random `urn:uuid:`                                                                                    | None (not secret)                                                               | Forever; sent to OpenAI at sign-in as `ext_agent_host_id`                         |
| `shortcut.json`                                                              | The chosen shortcut                                                                                   | None                                                                            | Until changed                                                                     |
| `tray-notice.json`                                                           | `{"shown":true}` once the "still running" notice has appeared                                         | None (not personal)                                                             | Until the profile is deleted                                                      |
| Local Storage `tracer:library`                                               | Saved prompts (≤100), past prompts (≤50) with timestamps, favorite flags, "Remember prompts" setting  | **Plain text**                                                                  | Until deleted in the app                                                          |
| Local Storage `tracer:draft`                                                 | The current prompt box, saved on every keystroke                                                      | **Plain text**                                                                  | Until overwritten                                                                 |
| Local Storage `tracer:provider`                                              | ChatGPT, Gemini, or Claude                                                                            | Plain text                                                                      | Until changed                                                                     |
| Local Storage `tracer:language`, `tracer:library-hidden`, `tracer:auto-send` | Chosen language code, whether the prompts panel is hidden, whether captures send right away           | Plain text                                                                      | Until changed                                                                     |
| `Local State`                                                                | Chromium settings, including the DPAPI-wrapped key that `safeStorage` uses                            | DPAPI                                                                           | App lifetime                                                                      |
| Chromium files                                                               | Preferences, caches (code, GPU, shader), DIPS, network state                                          | Chromium defaults                                                               | App lifetime                                                                      |

Not stored: screenshots, answers, conversation history, logs, crash dumps. A search of a test profile after repeated synthetic captures found no JPEG data. The real profile on this PC has no `Crashpad` folder.

**Deletion on disk.** Chromium's LevelDB keeps old values in its log file until it compacts. In a test, a prompt was saved, then deleted, then the app quit normally. The deleted text was still readable in `Local Storage/leveldb/000003.log` afterwards. Delete removes a prompt from Tracer immediately, but not from the disk at once.

**Who can read it.** Prompts are readable by any program running as the same Windows user. Tokens can be decrypted by such a program too; that is DPAPI's design, the same one Chrome uses for cookies. Copied to another Windows account or computer, the token file can't be decrypted, and Tracer would ask the user to sign in again. That follows from DPAPI's design; I did not physically copy the files to test it.

## 4. Data sent off the computer

### ChatGPT (only after sign-in, and only when you capture or send)

With **Send right after capture** on (the default), finishing a selection sends the screenshot and the prompt right away. Pressing the hotkey and choosing an area is the deliberate act. Turn the setting off to see the screenshot first and send it with Analyze screenshot. A capture made while signed out is never sent.

| Destination                                      | Sent by        | Contents                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.openai.com` authorize page                 | System browser | Client id, loopback redirect, scopes, resource, `state`, `nonce`, PKCE challenge, host id, app name on first sign-in, **email as `login_hint`** on later sign-ins. This URL is saved in the browser's history                                                                                           |
| `auth.openai.com` discovery, JWKS, token, revoke | Main process   | Code + verifier, refresh token, client id. HTTPS only, no redirects followed                                                                                                                                                                                                                            |
| `api.openai.com/v1/models`                       | Main process   | Bearer token                                                                                                                                                                                                                                                                                            |
| `api.openai.com/v1/responses`                    | Main process   | Model, Tracer's instructions (which name the chosen answer language, for example "Write the answer in Vietnamese"), a request for low reasoning effort, the screenshot (JPEG, longest edge ≤1600 px), the prompt, and earlier turns in this conversation. **Each follow-up sends the screenshot again** |
| `chatgpt.com/settings/usage`                     | System browser | Only when the user clicks Manage usage                                                                                                                                                                                                                                                                  |

`store: false` tells the Responses API not to keep the response for later retrieval through the API. It doesn't mean OpenAI never processes or keeps the data; OpenAI's own policies for the user's ChatGPT account still apply. Tracer's text should not suggest zero retention.

### Gemini and Claude

Tracer sends nothing to Google or Anthropic. It puts the screenshot and prompt on the clipboard and opens `https://gemini.google.com/app` or `https://claude.ai/new`. Whatever the user pastes is then governed by that provider's terms. Tracer doesn't read browser cookies or sessions and doesn't sign in.

## 5. Screenshot lifecycle

| Stage                                    | Where                                            | Cleared when                                                   |
| ---------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| Full-resolution frozen frame per monitor | Main process memory                              | The selection ends (capture, cancel, failure, or window close) |
| 1600 px preview of the frame             | Each overlay renderer                            | Overlay destroyed at the end of the selection                  |
| Cropped screenshot                       | Workspace renderer (`latestScreenshot`, `<img>`) | Remove preview, File → Clear, the next capture, or quit        |
| In-flight request                        | Main process                                     | Request completes or is cancelled                              |
| After a handoff                          | **System clipboard**                             | Only when something else is copied                             |

Like any program's memory, these can reach the Windows page file or hibernation file. Tracer can't control that.

## 6. Clipboard behavior

After a Gemini or Claude handoff, the clipboard holds one item with the prompt (`text/plain`) and the screenshot (`image/png`).

- **It stays after Tracer quits.** Windows keeps clipboard data independently of the app.
- **Clipboard History.** If Windows Clipboard History (Win+V) is on, the screenshot can be kept in the history list. If "Sync across your devices" is on, it can be uploaded to Microsoft's cloud clipboard.
- **Pasting may not deliver both parts.** A test page received both in one paste event, but chat editors often attach the image and ignore the text. This hasn't been checked on gemini.google.com or claude.ai.
- Before this audit, the handoff copied nothing at all (SECURITY_AUDIT T-01). Users then pasted whatever was already on their clipboard.

Recommended, in order of effort:

1. Say it in the confirmation: "The screenshot is on your clipboard until you copy something else."
2. Copy the image first, then offer a **Copy prompt** button after the user has pasted it. That also solves the paste problem.
3. When Tracer quits, clear the clipboard if it still holds Tracer's handoff (compare the text with the last prompt).
4. Investigate writing Windows' `ExcludeClipboardContentFromMonitorProcessing`, `CanIncludeInClipboardHistory = 0`, and `CanUploadToCloudClipboard = 0` formats with the item. Electron 44 exposes raw formats through the `electron application/osclipboard;format="…"` MIME prefix. Untested.

## 7. Prompt retention

- **Past Prompts** records each successfully submitted prompt while "Remember prompts" is on: up to 50, newest first, with a timestamp.
- **Saved Prompts** keep up to 100 until deleted.
- **The draft is saved on every keystroke regardless of "Remember prompts".** Someone who turns history off may expect the draft not to persist either.
- Prompts are never sent anywhere except as part of a submitted request.

## 8. Credentials

- Tracer never sees the user's OpenAI, Google, or Anthropic password.
- Tokens stay in the main process. The window receives only connection status, email, name, and model name.
- No plaintext fallback: if encryption isn't available, sign-in is refused.
- Disconnect revokes the refresh token at OpenAI and clears the tokens, but keeps the client id, subject, email, and name (OpenAI asks apps to keep the account mapping).
- Every automatic clear also revokes first: an expired refresh token, a connection still rejected after one refresh, or a refreshed identity that doesn't match. A grant Tracer can no longer use is not left active (SECURITY_AUDIT T-05).
- "Use a different ChatGPT account" changes nothing on disk until the new account verifies. It then revokes the old account's refresh token and replaces the record, so only one account is stored (T-06).

## 9. User deletion controls

| Control                         | Removes                                                                | Leaves                                                                         |
| ------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Escape during selection         | The new frozen frames                                                  | The previous preview                                                           |
| Remove preview / File → Clear   | Screenshot and conversation from memory; cancels a running request     | The Past Prompts entry, the clipboard                                          |
| Disconnect                      | Remote refresh grant (when a token is present) and local tokens        | Account identifiers in the encrypted file, host id                             |
| Use a different ChatGPT account | The previous account's grant and record, once the new account verifies | Host id                                                                        |
| Clear history                   | Past Prompts                                                           | Saved prompts, draft, old LevelDB log data until compaction                    |
| Remember prompts off            | New Past Prompts entries                                               | Existing entries, the draft                                                    |
| Delete on a card                | That record                                                            | A copy with the same text in the other list; LevelDB log data until compaction |
| Uninstall (Squirrel)            | Program files and shortcuts                                            | **All of `%APPDATA%\tracer`, and the ChatGPT grant**                           |

To remove everything: Disconnect in Tracer, check ChatGPT Settings → Security and login → Login connections, uninstall, then delete `%APPDATA%\tracer`.

## 10. Disclosures that need clarification

| Where                      | Current text                                                                        | Issue                                                     | Suggested                                                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| README (before this audit) | "encrypted with the operating system's credential store"                            | Not Credential Manager                                    | Corrected to "Electron safeStorage (Windows DPAPI for your user account)"                                                                                                                  |
| README                     | "The screenshot is not written to disk."                                            | True for Tracer, but a handoff leaves it on the clipboard | Corrected in README (clipboard and Clipboard History sentence)                                                                                                                             |
| README                     | "The saved prompt is local."                                                        | Not encrypted; draft always kept                          | Corrected in README ("stored locally in plain text, including the current draft")                                                                                                          |
| README                     | "Disconnect revokes the ChatGPT refresh token and deletes the local credential"     | Keeps identifiers; could have nothing to revoke           | Corrected in README; the code path is fixed (T-05)                                                                                                                                         |
| UI note                    | "Analysis uses that account's Plus or Pro plan allowance, not a separate API bill." | Credits can apply; plan list differs between OpenAI pages | "Analysis uses your ChatGPT plan's usage limits. If you allow credits for Tracer in ChatGPT settings, extra use can spend credits." Link "Learn more" to help.openai.com/articles/20001542 |
| README                     | "`store: false`"                                                                    | Can read as "nothing kept"                                | Corrected in README ("OpenAI's own retention policies still apply")                                                                                                                        |
| Release notes, app         | Affiliation                                                                         | Uses ChatGPT, Gemini, and Claude names                    | Added to README: "not affiliated with or endorsed by OpenAI, Google, or Anthropic." Repeat it in the release notes                                                                         |
| README                     | Uninstall                                                                           | Data and grant remain                                     | Added to README. Consider removing the data on uninstall                                                                                                                                   |
| Nowhere                    | Privacy policy                                                                      | None for users                                            | Add a short `PRIVACY.md` built from §3–§9 and link it from the release page                                                                                                                |
