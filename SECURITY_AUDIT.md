# Tracer security audit

|                   |                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit date        | 25 October 2026                                                                                                                                            |
| Code audited      | `c768a2d` on `main` (matches `origin/main`, clean tree at start) plus the uncommitted fixes listed in §7                                                   |
| Reviewer          | Independent review with Claude Code (Opus 5.5)                                                                                                             |
| Machine           | Windows 10 Home 10.0.19045, Alienware Area-51 R2, i7-6800K, 16 GB, GTX 1080, one 3440×1440 monitor at 100%                                                 |
| Runtime           | Electron 44.9.3, Node 25.8.0 (tests), npm 11.11.0                                                                                                          |
| Companion reports | [TEST_REPORT.md](TEST_REPORT.md), [PRIVACY_REVIEW.md](PRIVACY_REVIEW.md), [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md), [ARCHITECTURE.md](ARCHITECTURE.md) |

Nothing was committed, pushed, published, or installed. No screenshot was sent to any provider, and no live ChatGPT request was made.

## 1. Executive summary

Tracer's security design is sound. The renderer is sandboxed with context isolation and a strict CSP, cannot reach the network, and never sees ChatGPT tokens. Every IPC handler checks its sender. Tokens are encrypted with `safeStorage`, and the OAuth flow follows OpenAI's Sign in with ChatGPT documentation closely (PKCE, state, nonce, ID-token verification, loopback on `127.0.0.1`, scope check before any plan use). The packaged app has hardened fuses, contains only the Vite build, opens no DevTools, and made no network connections at idle. I found no exposed secrets in the tree, the bundle, or git history.

The serious problems are functional, and some of them mislead users:

- **The Gemini/Claude handoff copied nothing while telling the user it had (High, fixed).** Electron 44 replaced the clipboard API. Tracer's old call returned a rejected promise that was never awaited.
- **Expired refresh tokens left users stuck behind a wrong "screenshot" error (Medium, fixed).** Several of OpenAI's documented error codes produced messages that contradicted OpenAI's own guidance (Medium, fixed).
- **A reply for an old screenshot could appear under a new one (Medium, fixed).**
- **Two account-handling gaps were fixed after your approval (T-05, T-06).** A 401 now gets one refresh and one retry, and credentials are revoked before they are cleared. "Use a different ChatGPT account" starts a fresh registration. One gap remains: the first listed model may not accept images (T-07).

**Live run (26 October 2026).** You ran it with your own account: sign-in, plan usage, and two real screenshot-to-answer requests succeeded with GPT-6.1-Sol. The model read the image. It quoted text that appeared only in the screenshot, and it translated a capture into Vietnamese. Still unverified live:

- the follow-up flow, Disconnect, and account switching;
- real error responses;
- pasting into gemini.google.com and claude.ai.

**Recommendation: READY AFTER SPECIFIC FIXES** (see §10).

## 2. Scope, method, and what was not done

- Read every file in `src/`, `test/`, `scripts/`, `backend/`, the configs, and the existing docs.
- Checked the OAuth and plan-usage implementation against OpenAI's current docs at developers.openai.com/siwc (registration and sign-in, accounts and sessions, models and inference, token reference, errors and recovery, preview limitations, UI/UX guidelines) and Help Center article 20001542.
- Ran `npm test`, `npm audit`, git-history secret scans, `npm run package` and `npm run make` (before and after fixes), and inspected the asar, fuses, PE metadata, and signatures.
- Ran local Electron 44.9.3 probes from a scratch directory with an isolated profile. Clipboard tests used a synthetic image and restored your clipboard afterwards.
- Drove the real built renderer and preload with a fake main process to test XSS, races, and storage.
- Launched the packaged `tracer.exe` twice (startup, idle, network, single instance) against your existing profile. It read the saved connection but made no network calls.

**Not done:** live ChatGPT sign-in or analysis, pasting into the real Gemini or Claude sites, multi-monitor or non-100% DPI tests (no hardware), installing the Squirrel setup, macOS or Linux builds, and anything against third-party services.

### Discrepancies with the brief and the previous report

| Claim                                                                                        | Reality                                                                                                                                           |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Previous audit: preload exposes `tracer.onHotkeyPressed` and `tracer.inspectScreenshot` only | The preload exposes 19 functions; `inspectScreenshot` no longer exists                                                                            |
| Previous audit: prompt stored under `tracer:prompt`                                          | Library is `tracer:library`, draft is `tracer:draft`; `tracer:prompt` is only read as a legacy fallback                                           |
| Previous audit: renderer stops media streams                                                 | The renderer no longer uses media streams. Capture is `desktopCapturer` in main                                                                   |
| Previous audit: 33 tests                                                                     | 57 at `c768a2d`, 70 after this audit                                                                                                              |
| README: tokens "encrypted with the operating system's credential store"                      | `safeStorage` on Windows is Chromium OSCrypt (AES-GCM, key protected by DPAPI in `Local State`), not Windows Credential Manager. README corrected |
| README: "A live region capture was run on this Windows PC" and handoff works                 | Handoff could not have worked on Electron 44 (T-01)                                                                                               |
| `out/tracer-win32-x64` described as the release build                                        | It predated the latest source; rebuilt during this audit                                                                                          |

## 3. Findings

| ID   | Severity | Finding                                                                                               | Status                                 |
| ---- | -------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------- |
| T-01 | **High** | Gemini/Claude handoff copied nothing and reported success                                             | Fixed                                  |
| T-02 | Medium   | Expired or rotated refresh tokens showed "could not accept this screenshot" and were never cleared    | Fixed                                  |
| T-03 | Medium   | Plan-usage error messages contradicted OpenAI's error table (eligibility, outages, unsupported input) | Fixed                                  |
| T-04 | Medium   | A reply for the previous screenshot could appear under a new capture and enter its follow-ups         | Fixed                                  |
| T-05 | Medium   | A single HTTP 401 from `/v1/responses` deleted the refresh token without revoking it                  | Fixed (approved)                       |
| T-06 | Medium   | After Disconnect, a different ChatGPT account could never sign in                                     | Fixed (approved)                       |
| T-07 | Medium   | The first listed model is used without checking image support, and there is no model choice           | **Open — needs live test**             |
| T-08 | Low      | Shift-only and AltGr-only global shortcuts were accepted and would block typing system-wide           | Fixed                                  |
| T-09 | Low      | Two instances could run at once, sharing one rotating refresh token                                   | Fixed                                  |
| T-10 | Low      | Display-media handler would give a full-screen stream to the main frame with no picker (latent)       | Fixed                                  |
| T-11 | Low      | A drag that overshoots the monitor edge was silently treated as a cancel                              | Fixed                                  |
| T-12 | Low      | Unfavoriting a card revealed a hidden duplicate in Favorites                                          | Fixed                                  |
| T-13 | Low      | A 90 s timeout showed "Canceled."; failed streams stayed open until the timeout                       | Fixed                                  |
| T-14 | Low      | Handoff provider lookup accepted prototype keys and wrote the clipboard before validating the URL     | Fixed                                  |
| T-15 | Low      | `tracer.exe` reported "Copyright (C) 2015 GitHub, Inc."                                               | Fixed                                  |
| T-16 | Low      | Disconnect during an in-flight refresh could save stale credentials                                   | Mitigated (button disabled while busy) |
| T-17 | Low      | Credential file is not written atomically; `mode: 0o600` has no effect on Windows                     | Open                                   |
| T-18 | Low      | On Linux, `safeStorage` may use the `basic_text` backend with a fixed key                             | Open (Linux untested)                  |
| T-19 | Info     | Dev-only critical advisories in `tinypool` via `oxfmt` 0.41                                           | Open (not shipped)                     |
| T-20 | Info     | Executables and installer are unsigned                                                                | Open (distribution decision)           |

### T-01 — Gemini/Claude handoff copied nothing and reported success (High, fixed)

**What.** [main.js](src/main.js) called `clipboard.write({ text: prompt, image })` inside `try/catch`. In Electron 44 the clipboard module is asynchronous: `write(data: ClipboardItem[]): Promise<void>`. The old call returns a promise that rejects with `TypeError: clipboard.write expects an array of ClipboardItem`. It wasn't awaited, so `catch` never ran. Tracer then opened the browser and showed "Opened the official site and copied the screenshot and prompt."

**Why it matters.** A core feature failed every time and told the user it worked. The user would paste whatever was already on their clipboard into a third-party AI site. That could be something private they had copied earlier.

**How it was found.** The `clipboard` object in Electron 44.9.3 exposes only `clear, has, read, readText, write, writeText`. A probe ran Tracer's exact call. The clipboard still held the earlier text `"BEFORE"`, and Node printed `UnhandledPromiseRejectionWarning`. The existing tests never executed `main.js`, so nothing caught it.

**Fix.** `await clipboard.write([new ClipboardItem({ 'text/plain': prompt, 'image/png': new Blob([image.toPNG()]) })])`. A probe confirmed that a web page's `paste` event then receives both `text/plain` and an `image/png` file.

**Prevention.** [scripts/verify-handoff-clipboard.mjs](scripts/verify-handoff-clipboard.mjs) checks this Electron contract (`npx electron scripts/verify-handoff-clipboard.mjs`). A source test in [architecture.test.mjs](test/architecture.test.mjs) rejects the legacy form. Read Electron's breaking-changes notes on every major upgrade, and treat code generated from older Electron examples with suspicion.

**Still to verify.** Whether gemini.google.com and claude.ai accept both formats from one paste. Many editors attach the image and drop the text. See PRIVACY_REVIEW §6.

### T-02 — Expired refresh token left the user stuck (Medium, fixed)

**What.** Refresh tokens last 30 days. OpenAI's errors page lists `invalid_refresh_token`, `token_expired`, `refresh_token_expired`, `refresh_token_invalidated`, and `refresh_token_reused` as final: "Clear the unusable tokens and repeat OAuth." The token endpoint returns these with HTTP 400. `explainPlanFailure` only recognized `invalid_grant`, so these fell through to the HTTP 400 branch, "ChatGPT could not accept this screenshot. Capture the screen again." `freshRecord` only clears tokens on the "Sign in again" message, so every later attempt repeated the failed refresh with the same wrong message.

**Impact.** Anyone who doesn't use Tracer for 30 days would be stuck behind a false screenshot error until they found Disconnect.

**Fix.** A `TERMINAL_GRANT_CODES` set in [chatgpt-plan.mjs:46](src/chatgpt-plan.mjs:46) maps all of them to "ChatGPT sign-in expired. Sign in again." Tracer then clears the tokens, keeps the issued client id as the docs require, and shows the sign-in button. Regression test: _clears tokens and asks for sign-in when the refresh token has expired_.

### T-03 — Error messages contradicted OpenAI's guidance (Medium, fixed)

| Code (status)                                       | OpenAI says                               | Tracer said                                                   | Tracer says now                                                              |
| --------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `subscription_sharing_usage_unavailable` (503)      | Temporary; keep credentials, retry later  | "not available for this account… requires a Plus or Pro plan" | "temporarily unavailable. Try again in a few minutes."                       |
| `subscription_sharing_user_not_eligible` (403)      | Explain the restriction; don't loop OAuth | "Allow plan usage for Tracer, then try again."                | "This ChatGPT account cannot use its plan in other apps…"                    |
| `subscription_sharing_unsupported_capability` (400) | Remove the unsupported input or model     | "Capture the screen again."                                   | "…did not accept this request. It may not support image input."              |
| Other 403                                           | Policy, permission, or region             | "Allow plan usage for Tracer"                                 | "Your account, workspace, or region may not allow plan usage in other apps." |

Telling an ineligible user to "allow plan usage" sends them through OAuth again, which OpenAI asks apps not to do.

### T-04 — Stale reply shown under a new screenshot (Medium, fixed)

**What.** While a ChatGPT request was running, the hotkey still worked. A new capture replaced `latestScreenshot` and cleared `history`. When the old reply arrived, `runAction` pushed it into the new conversation and rendered it below the new picture. The next follow-up then sent the new image with the old screenshot's question and answer.

**Fix.** A new `abandonAction` in [renderer.js:340](src/renderer.js:340) cancels the in-flight request and ignores its result whenever a capture arrives, Remove preview is clicked, or File → Clear runs. Verified on the built renderer: the stale "ANSWER FOR SCREENSHOT A" was never shown, the follow-up sent an empty history, and buttons re-enabled.

### T-05 — One 401 discarded the refresh token without revoking it (Medium, fixed)

**What.** The original `respond` set the record to `reauth_required` and cleared all tokens on any 401 from `/v1/responses`, without trying a refresh. OpenAI's `subscription_sharing_invalid_user` (401) guidance: "Ask the user to sign in again only after confirmed revocation or a terminal refresh error," and "Don't delete credentials because of a temporary network or infrastructure failure."

**Impact.** A transient 401 forced a new sign-in. The refresh token was dropped without being revoked, so the grant stayed active in ChatGPT settings. Disconnect then had nothing to revoke but still reported success.

**Fix** ([chatgpt-runtime.mjs](src/chatgpt-runtime.mjs)):

- A 401, or `invalid_grant`, from `/v1/models` or `/v1/responses` now makes `requestAnswer` return `{ unauthorized: true }` instead of throwing.
- `respond` then forces one refresh (`freshRecord(…, { force: true })`) and retries once. A 401 is not admitted, so the retry doesn't spend plan usage twice.
- If the refreshed token is also rejected, the newest refresh token is revoked, then cleared. The user sees "ChatGPT did not accept this connection. Sign in again." If revocation can't be confirmed, the message adds "If Tracer still appears under Login connections in ChatGPT settings, remove it there."
- A temporary refresh failure (for example a 503) keeps the credentials.
- If `earliest_refresh_at` hasn't passed, a forced refresh isn't attempted, and the credentials are kept.
- Every path that forgets a token now goes through `clearCredentials`, which revokes first: Disconnect, terminal refresh errors, a refreshed identity mismatch, and a rejected retry.

**Tests:**

- _refreshes once and retries when ChatGPT rejects the access token_
- _revokes, then clears, a connection ChatGPT still rejects after a refresh_: checks one retry only, that the newest token is revoked, and that the record still held it at revocation time
- _keeps the connection when a rejected token cannot be refreshed right now_
- _clears tokens and asks for sign-in when the refresh token has expired_: now also asserts revocation

All fail against the original runtime.

### T-06 — Could not switch ChatGPT accounts (Medium, fixed)

**What.** After Disconnect, the record keeps the issued `client_id` and `subject`, which is correct for signing back into the same account. `signIn` always reused that client id. If a different account came back, it failed with "Sign in to the original account, or disconnect first", but the user had already disconnected. The only way out was deleting `%APPDATA%\tracer\chatgpt-connection.bin` by hand.

**Fix.** A new "Use a different ChatGPT account" button appears in the ChatGPT panel whenever Tracer remembers an account. `toPublicSession` exposes only a `savedAccount` boolean, no identifiers. The button calls `signIn({ fresh: true })`, which follows OpenAI's accounts-and-sessions guidance:

- It registers with `dynamic_agent_client` and `agent_name_hint`, with no saved client id and no `login_hint`.
- It writes nothing to disk until the new ID token verifies, so a cancelled or failed attempt leaves the remembered account exactly as it was.
- After verification, it revokes the previous account's refresh token, then replaces the record. If that revocation can't be confirmed, sign-in still succeeds and the window shows a notice telling the user to remove Tracer from the old account's Login connections.
- The host id is reused, as OpenAI requires.
- The mismatch error for a normal sign-in now points to the new button.

Tracer still stores one account at a time. OpenAI's docs allow several saved registrations, so a multi-account picker would be a later feature.

**Tests:**

- _signs in a different account and revokes the old one only after the new identity checks out_
- _keeps the remembered account when signing in a different one fails_
- _points a normal sign-in that returns another account to the switch_

A built-renderer check confirmed that the button sends `fresh: true` over IPC and stays hidden when no account is remembered.

**Trade-off.** Because a fresh attempt writes nothing until it succeeds, a failed code exchange discards the newly issued client id. The next attempt registers again.

### T-07 — Model choice and image support (Medium, open)

`selectListedModel` takes the first `visibility: "list"` model. OpenAI's preview limitations say "Text, images, and files are supported when the selected model accepts them." The models page says to show `display_name` and pass the selected `slug`. Neither says the first entry is a default or accepts images. If it doesn't, every request fails with `subscription_sharing_unsupported_capability` and the user can't choose another model. The message now explains the likely cause (T-03), but the root fix needs a live account to see what `/v1/models` returns. Options: a model picker, or retrying with the next listed model on that specific error.

### Lower-severity fixes

- **T-08** — `isValidAccelerator` now requires a modifier other than Shift or AltGr unless the key is F1–F24 ([security-policy.mjs:100](src/security-policy.mjs:100)). A stored `Shift+A` falls back to Ctrl+Shift+Space.
- **T-09** — `app.requestSingleInstanceLock()`. A second launch focuses the first window and exits with code 0, verified on the packaged build. This also serializes refreshes, which OpenAI asks for.
- **T-10** — The old display-media handler granted `sources[0]` to the main frame with no picker. On Electron 44, `getDisplayMedia` first asks for the `media` permission, which Tracer denies, so the handler wasn't reachable. A probe confirmed that if `media` were ever allowed, a page would silently get a full-screen stream. The handler now always calls `callback(null)`, and `display-capture` is no longer an allowed permission.
- **T-11** — With pointer capture, `clientX` can pass the overlay's width when the cursor crosses monitors. `validateDipSelection` rejected the rectangle, and the user saw "Selection canceled." The gesture now clamps points to the overlay ([overlay-gestures.mjs:12](src/overlay-gestures.mjs:12)).
- **T-12** — Favorites shows one card per text, but the star was per record. `setFavorite` now applies to every copy of the same text.
- **T-13** — A timeout now says "ChatGPT took too long to answer." `respond` aborts its controller in `finally`, so an invalid SSE event releases the connection immediately.
- **T-14** — `handoffUrl` accepts only own keys of `HANDOFF_TARGETS` and runs `assertOpenable` before anything is copied.
- **T-15** — `appCopyright` and `win32metadata.FileDescription` set in Forge. ProductName is still `tracer` (lowercase) because changing `productName` renames the exe and Squirrel shortcuts.
- **T-16** — Disconnect is disabled while a request runs. The runtime still has no lock around record writes. A promise-chain mutex around `loadRecord`/`saveRecord` would close the remaining gap.

## 4. The 20 pre-launch checks

| #   | Check                      | Result                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | -------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Hide API keys              | **PASS**                    | No developer credential exists. Grep of the tree and the extracted asar for `sk-`, `sk-proj-`, JWTs, AWS, GitHub, Slack, and Google keys, PEM keys, and `client_secret` found nothing. Test fixtures use synthetic values (`oaiapp_testclient`, `access-test-token`).                                                                                                                                                               |
| 2   | Purge git secrets          | **PASS**                    | All 14 commits and every file ever added were scanned with the patterns above. The only hits are the three synthetic `oaiapp_` fixtures. No rotation needed. History not rewritten.                                                                                                                                                                                                                                                 |
| 3   | Public database keys       | N/A                         | No database.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4   | Row-level security         | N/A                         | No database.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 5   | Encrypt sensitive data     | **PASS**                    | Tokens: `safeStorage.encryptString` (`v10` = AES-256-GCM under a key that DPAPI protects for the Windows user). Sign-in is refused if encryption is unavailable; there is no plaintext fallback. Screenshots stay in memory. Prompts are plain localStorage (see PRIVACY_REVIEW). Notes T-17 and T-18.                                                                                                                              |
| 6   | Server-side authentication | **PASS**                    | Every `ipcMain.handle` calls `requireSender` (main window, main frame) or `overlayFrom` (live overlay, main frame). OpenAI enforces the bearer token.                                                                                                                                                                                                                                                                               |
| 7   | Lock record access         | N/A                         | No remote records. Local data lives in the Windows user's profile.                                                                                                                                                                                                                                                                                                                                                                  |
| 8   | Block field tampering      | **PASS**                    | No IPC can set tokens, scopes, client id, or model. `sign-in` takes only a boolean. `ask`, `handoff`, `set-hotkey`, and `choose-region` payloads are validated in main.                                                                                                                                                                                                                                                             |
| 9   | Secure session cookies     | **PASS (token equivalent)** | No auth cookies. Tokens stay in main, encrypted at rest, sent only over HTTPS with `redirect: 'error'`; 1 h access tokens, rotated refresh tokens, revoked before any clear (T-05).                                                                                                                                                                                                                                                 |
| 10  | Hash passwords             | N/A                         | Tracer never sees a password. Sign-in happens in the system browser at `auth.openai.com`. Gemini and Claude have no sign-in in Tracer.                                                                                                                                                                                                                                                                                              |
| 11  | Rate-limit login           | N/A                         | OpenAI owns the endpoint. Locally: one sign-in at a time, one accepted callback, 10 s header and 15 s request timeouts, 5 min overall.                                                                                                                                                                                                                                                                                              |
| 12  | Bot protection             | N/A                         | No public endpoint. The loopback listener exists only during sign-in. `backend/` is not shipped.                                                                                                                                                                                                                                                                                                                                    |
| 13  | Parameterize queries       | N/A                         | No SQL.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 14  | Validate all input         | **PASS after fixes**        | See §5. Fixed T-08, T-11, T-14.                                                                                                                                                                                                                                                                                                                                                                                                     |
| 15  | Escape user content        | **PASS**                    | No `innerHTML`, `eval`, or link rendering. Built renderer test: hostile HTML/Markdown in answers and saved prompts rendered as literal text, with no injected `img`, `script`, or `a`.                                                                                                                                                                                                                                              |
| 16  | Restrict file uploads      | **PASS**                    | Only `data:image/(png\|jpeg);base64` up to 20 M characters. IPC never accepts a file path, and main never reads files for the renderer. Captures are ≤1600 px JPEG.                                                                                                                                                                                                                                                                 |
| 17  | Trim API responses         | **PASS**                    | The renderer gets `{status, sharing, email, name, modelName}` and answer text. Errors are fixed strings; provider text is never forwarded (`readErrorCode` keeps `[a-z0-9_]` codes only). Minor: a failed credential write can show a Node error that includes the profile path.                                                                                                                                                    |
| 18  | Security headers           | **PASS**                    | Packaged CSP: `default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; frame-src 'none'; object-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'none'`. The callback page sends `no-store`, `nosniff`, `no-referrer`, and `default-src 'none'`. `frame-ancestors` is ignored in a meta tag (harmless console notice). |
| 19  | Enforce HTTPS              | **PASS**                    | All remote URLs are `https://`. Discovered endpoints must be HTTPS on `auth.openai.com`. Every `fetch` uses `redirect: 'error'`. No certificate overrides (`certificate-error`, `setCertificateVerifyProc`, `rejectUnauthorized`), and the `NODE_OPTIONS` fuse is off. The only plain-HTTP URL is the documented `http://127.0.0.1:<port>/auth/callback` loopback (RFC 8252, required by OpenAI).                                   |
| 20  | Scan dependencies          | **PASS (production)**       | `npm audit --omit=dev`: 0. Full audit: 2 critical in `tinypool` ≤2.1.1 via `oxfmt` 0.41 (dev formatter, not in asar; fix is `oxfmt` 0.74, flagged as breaking). `backend/`: 0. Electron 44.9.3 is the latest 44.x; 45.0.0 exists. Production deps: `jose` 6.2.13 (MIT), `electron-squirrel-startup` 1.0.1 (Apache-2.0) → `debug`, `ms` (MIT). Install scripts only in dev deps (`electron-winstaller`, `fsevents`).                 |

## 5. Input validation detail (check 14)

| Input                        | Where checked                                                                                                | Result                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt                       | `validateInspectPayload` in renderer and again in main                                                       | String, non-blank, ≤2000. Command-like and HTML-like text is accepted as plain text                                                                                           |
| Prompt titles and saved text | `cleanTitle`, `cleanText`                                                                                    | ≤80 and ≤2000 characters, control characters stripped, NUL rejected                                                                                                           |
| Library JSON in localStorage | `normalizeLibrary`                                                                                           | Invalid JSON gives an empty library (built-renderer test). Invalid items dropped; saved ≤100, past ≤50                                                                        |
| Hotkey                       | `isValidAccelerator` in main and when reading `shortcut.json`                                                | Modifier and key allowlists, ≤64 characters, no duplicates; Shift-only rejected (T-08)                                                                                        |
| IPC payloads                 | Each handler                                                                                                 | Non-objects rejected; numbers coerced with `Number()` and validated                                                                                                           |
| Selection geometry           | `validateDipSelection`, `selectionToCrop`, gesture clamp                                                     | Non-finite, negative, out-of-bounds, and smaller-than-8 px rejected; crop clamped to the thumbnail                                                                            |
| Image data                   | `isScreenshotDataUrl`, `nativeImage.createFromDataURL`, `isEmpty`                                            | PNG/JPEG base64 only, padded length, ≤20 M characters                                                                                                                         |
| Conversation history         | `buildConversation`                                                                                          | ≤16 turns, roles user/assistant, user ≤2000, assistant ≤100,000                                                                                                               |
| Provider responses           | `readTokenResponse`, `assessIdentityClaims`, `selectListedModel`, `parseSseMessage`, `consumeResponseEvents` | Token types and lengths, expiry ≤30 days, claims without control characters, model slug regex, JSON-object SSE events only, 2 MB stream cap, 100k answer cap                  |
| OAuth callback               | `parseCallback` and the listener                                                                             | GET only, exact `Host`, exact path, one constant-time `state`, one code ≤2048 without spaces or `&`, `client_id` regex, placeholder rejected, mismatch with saved id rejected |
| URLs                         | `assertOpenable`, `isAllowedNavigation`, `handoffUrl`                                                        | `https` only, exact pages for usage and handoff, authorize URL must be `auth.openai.com/api/accounts/authorize` with no token parameters and a `127.0.0.1` redirect           |

## 6. Electron, OAuth, screenshot, and AI-request checks

### Electron (phase 3)

| Requirement                                    | Result | How verified                                                                                                                                                |
| ---------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A compromised renderer cannot reach Node       | PASS   | `sandbox`, `contextIsolation`, `nodeIntegration` off in all windows; preload exposes functions only; fuses `RunAsNode`, `NODE_OPTIONS`, and inspect off     |
| IPC cannot run commands                        | PASS   | No `child_process`, `exec`, or `shell.openPath`. `shell.openExternal` only receives allowlisted URLs                                                        |
| Only authorized frames can request screenshots | PASS   | No renderer API starts a capture. `tracer:frozen-frame` and `choose-region` require a live overlay's main frame. `getDisplayMedia` is always refused (T-10) |
| External URLs cannot run code in Tracer        | PASS   | `will-navigate` and `will-redirect` restricted to the renderer folder, `window.open` denied, `<webview>` blocked, `frame-src 'none'`                        |
| Unexpected windows and navigation blocked      | PASS   | `setWindowOpenHandler` deny on every `web-contents-created`                                                                                                 |
| No dev server in production                    | PASS   | The packaged `main.cjs` compiles `devServerUrl` to the empty-string constant                                                                                |
| No DevTools in production                      | PASS   | No `openDevTools` or `toggleDevTools` in the packaged bundle; the menu adds them only with a dev server                                                     |

### ChatGPT OAuth (phase 4)

| #   | Item                      | Result                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Eligibility               | Likely eligible: OpenAI's self-serve docs cover open-source and locally hosted apps, and Tracer runs locally under MIT. **Confirm:** the repository has no LICENSE file, and I could not confirm the GitHub repo is public (`gh` not signed in).                                                                                                                                                                           |
| 2   | Protocol                  | Matches the registration and sign-in page: endpoint, `dynamic_agent_client` first and the issued id later, `agent_name_hint` only on first registration, `urn:uuid:` host id, `127.0.0.1` loopback started before the browser, same redirect URI and `resource` in the exchange, no secret. Optional `id_token_hint` not used. `prompt=consent` for re-consent is the documented fallback until `force_reconsent` rollout. |
| 3   | PKCE                      | 32 random bytes base64url verifier, S256 challenge without padding                                                                                                                                                                                                                                                                                                                                                         |
| 4   | State                     | 32 random bytes per attempt; nonce the same                                                                                                                                                                                                                                                                                                                                                                                |
| 5   | State verification        | Exactly one `state`, constant-time compare; a mismatch is rejected without ending the sign-in                                                                                                                                                                                                                                                                                                                              |
| 6   | CSRF                      | State plus PKCE plus `Host` and path checks                                                                                                                                                                                                                                                                                                                                                                                |
| 7   | Loopback binding          | `127.0.0.1` only                                                                                                                                                                                                                                                                                                                                                                                                           |
| 8   | Port                      | OS-assigned; OpenAI allows the port to vary                                                                                                                                                                                                                                                                                                                                                                                |
| 9   | Code replay               | Listener settles once; PKCE binds the code                                                                                                                                                                                                                                                                                                                                                                                 |
| 10  | Malicious callbacks       | Wrong method, host, or path → 404; bad state → 400; `error=` with a valid state stops the attempt                                                                                                                                                                                                                                                                                                                          |
| 11  | Listener cleanup          | `finally` closes the server and all connections; abort and 5 min timeout                                                                                                                                                                                                                                                                                                                                                   |
| 12  | Refresh                   | 60 s before expiry, and once more on a 401 (T-05); fields per docs (no `scope`); rotated refresh token stored; ID token re-verified and subject must match. Terminal errors fixed (T-02)                                                                                                                                                                                                                                   |
| 13  | Expiry                    | `expires_in` must be 0 < x ≤ 30 days                                                                                                                                                                                                                                                                                                                                                                                       |
| 14  | Disconnect and revocation | Per docs; every clear revokes first; unconfirmed revocation is reported. Caveat T-16                                                                                                                                                                                                                                                                                                                                       |
| 15  | Account switching         | **PASS after fix** (T-06): fresh registration, old grant revoked after the new identity verifies                                                                                                                                                                                                                                                                                                                           |
| 16  | Duplicate login           | Blocked in one process; second instance prevented (T-09)                                                                                                                                                                                                                                                                                                                                                                   |
| 17  | Cancellation              | Cancel aborts and closes the listener. The browser tab stays open; Tracer can't close it                                                                                                                                                                                                                                                                                                                                   |
| 18  | Scope enforcement         | `chatgpt.tokens.use.direct` is checked before any Responses call and again after refresh. Sign-in alone shows "Allow ChatGPT plan usage"                                                                                                                                                                                                                                                                                   |
| 19  | Error handling            | Fixed (T-02, T-03, T-05, T-13)                                                                                                                                                                                                                                                                                                                                                                                             |
| 20  | Credential leakage        | Tokens never reach the renderer, URLs, logs, or error text. No crash reporter (no `Crashpad` folder in the profile). The authorize URL in browser history contains `login_hint` (email) and the host id, both allowed by OpenAI                                                                                                                                                                                            |

**Token storage.** Tokens stay in main and never touch renderer storage, and the runtime has no logging (enforced by a source test). Electron prints IPC handler errors to stderr, but those messages are Tracer's fixed strings. On Windows, the encrypted file can be opened by any process running as the same Windows user; that is DPAPI's design, and it is how Chrome protects cookies too. Copied to another Windows account or machine, it can't be decrypted. Tracer would then show `reauth_required`. That follows from DPAPI's design; I didn't physically copy the files to test it.

**Subscription claims.** OpenAI's developer docs describe plan usage for Plus and Pro. The two cached versions of Help Center article 20001542 disagree on Go. Usage is capped per app (weekly, 10–100%), and Plus has a shared five-hour window. Credits are off by default, and an app can only spend them when it's set to 100% and the user allows it. Tracer's "Analysis uses that account's Plus or Pro plan allowance, not a separate API bill" never claims unlimited use, but it leaves out the credits case and hard-codes plan names. Suggested copy is in RELEASE_CHECKLIST.

### Screenshot capture (phase 5)

| Behavior                                                      | Result                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture only after the shortcut                               | PASS. No other code path calls `desktopCapturer`                                                                                                                                                                                                                                                                        |
| Nothing written to disk                                       | PASS. No `writeFile` of image data. A profile search after repeated synthetic captures found no JPEG data                                                                                                                                                                                                               |
| Not logged, not in crash dumps                                | PASS. No logging and no crash reporter                                                                                                                                                                                                                                                                                  |
| Memory released                                               | PASS. Frozen frames cleared on every exit path, overlays destroyed. 60 cycles showed no upward trend (TEST_REPORT §5)                                                                                                                                                                                                   |
| Escape keeps the previous preview                             | PASS by code review                                                                                                                                                                                                                                                                                                     |
| New capture clears the conversation                           | PASS after fix (T-04)                                                                                                                                                                                                                                                                                                   |
| Sent only by a deliberate action, to the selected destination | PASS. With "Send right after capture" on (the default, at your request), finishing the selection is the action that sends. With it off, nothing is sent until Analyze screenshot. Built-renderer tests cover both, and confirm that loading or saving prompts sends nothing and that a signed-out capture sends nothing |
| Overlay absent from the picture                               | PASS. The snapshot is taken before overlays exist                                                                                                                                                                                                                                                                       |
| Tracer's own window absent                                    | PASS on this PC (hide plus 150 ms). Slow machines need a manual check                                                                                                                                                                                                                                                   |
| Selection matches pixels                                      | PASS at 3440×1440, 100%: the overlay viewport equals the display, and the crop maps 1:1                                                                                                                                                                                                                                 |
| Zoom leaking into overlay                                     | Not an issue: tested on Electron 44.9.3, the overlay stays at zoom 1.0 after the main window zooms                                                                                                                                                                                                                      |
| Multiple monitors, other DPI, negative origins                | **NEEDS MANUAL TESTING.** Logic is unit-tested; no hardware. Known Electron risk: windows created on a monitor with a different scale can get the wrong size                                                                                                                                                            |

### AI request (phase 6)

`POST https://api.openai.com/v1/responses` with `store: false`, `stream: true`, `instructions`, and `input_image` on the first user turn is confirmed in code and in the mocked test. No forbidden fields are sent (`temperature`, `max_output_tokens`, `previous_response_id`, `user`, system-role items).

| Scenario                        | Handling                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wrong or unavailable model      | `selectListedModel` fails → "did not list a model"; unsupported → T-03 message (T-07 open)                                                       |
| Invalid auth / expired token    | Refresh before expiry; on a 401, one forced refresh and one retry, then revoke and sign in again (T-05); terminal refresh → sign in again (T-02) |
| Missing scope                   | Blocked before any request                                                                                                                       |
| Usage limit, rate limit         | `subscription_sharing_usage_limit_exceeded` → Manage usage message; 429 → wait message                                                           |
| Offline / outage                | "could not reach ChatGPT" / "unavailable right now"                                                                                              |
| Timeout                         | 90 s → "took too long" (T-13)                                                                                                                    |
| Malformed or interrupted stream | Invalid JSON event → error and connection released; no `response.completed` → "ended before completion"                                          |
| Oversized                       | Captures ≤1600 px; stream ≤2 MB; answer ≤100k characters                                                                                         |
| Rapid repeats                   | Renderer `busy` flag plus main single-flight                                                                                                     |
| Cancel / shutdown               | Cancel aborts the fetch; `will-quit` cancels sign-in and requests                                                                                |

**Prompt injection.** Screenshot text can steer the answer, and Tracer's instructions only ask the model to treat it as data. The model has no tools, and Tracer never acts on the answer: no links, no commands, no file access, no automatic follow-ups. The worst case is a misleading answer.

## 7. Changes made in this audit (committed as 13dcaca)

| File                                                                         | Change                                                                                                                                  |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [src/main.js](src/main.js)                                                   | Electron 44 clipboard handoff (T-01); `handoffUrl` (T-14); single-instance lock (T-09); `getDisplayMedia` always refused (T-10)         |
| [src/chatgpt-plan.mjs](src/chatgpt-plan.mjs)                                 | Error mapping per OpenAI (T-02, T-03); `handoffUrl`                                                                                     |
| [src/chatgpt-runtime.mjs](src/chatgpt-runtime.mjs)                           | Timeout message; abort in `finally` (T-13); refresh-and-retry on 401 and revoke-before-clear (T-05); `signIn({ fresh })` (T-06)         |
| [src/preload.js](src/preload.js)                                             | `signIn` passes `fresh` (T-06)                                                                                                          |
| [src/security-policy.mjs](src/security-policy.mjs)                           | Shift/AltGr-only shortcuts rejected (T-08); permission allowlist narrowed; unused display-capture helpers removed                       |
| [src/overlay-gestures.mjs](src/overlay-gestures.mjs)                         | Clamp to overlay bounds (T-11)                                                                                                          |
| [src/renderer.js](src/renderer.js)                                           | `abandonAction` (T-04); Disconnect disabled while busy (T-16); overlay bounds; "Use a different ChatGPT account" (T-06)                 |
| [src/prompt-library.mjs](src/prompt-library.mjs)                             | Favorites sync (T-12)                                                                                                                   |
| [index.html](index.html)                                                     | `aria-live="polite"` on the answer area; `chatgpt-switch` button in the ChatGPT panel (T-06)                                            |
| [forge.config.mjs](forge.config.mjs)                                         | `appCopyright`, `FileDescription` (T-15)                                                                                                |
| [scripts/verify-handoff-clipboard.mjs](scripts/verify-handoff-clipboard.mjs) | New Electron clipboard contract check                                                                                                   |
| `test/*.mjs`                                                                 | 16 regression tests added (10, then 6 for T-05/T-06), 3 tests of removed helpers deleted, 3 updated                                     |
| [README.md](README.md)                                                       | Corrected credential storage, Disconnect, `store: false`, model, handoff, and privacy claims; added uninstall and non-affiliation notes |
| ARCHITECTURE.md, TEST_REPORT.md, PRIVACY_REVIEW.md, RELEASE_CHECKLIST.md     | New. This file was rewritten; §11 keeps what was still valid from the previous version                                                  |

The only visual change is the approved "Use a different ChatGPT account" button, styled like the panel's other buttons. The screenshot workflow and prompt library are unchanged apart from the fixes above. The OAuth mechanism (PKCE, loopback, scopes) is unchanged; only the 401 recovery and account switching were changed, with your approval.

## 8. Extra checks (phase 15)

| #   | Area                     | Result                                                                                                                              |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | XSS / unsafe Markdown    | PASS (built-renderer test)                                                                                                          |
| 2   | Command injection        | PASS (no shell or process APIs)                                                                                                     |
| 3   | IPC privilege escalation | PASS (sender checks; overlay and main channels separated)                                                                           |
| 4   | Token theft or leakage   | PASS within the same-user DPAPI model                                                                                               |
| 5   | Callback hijacking       | PASS (127.0.0.1, random port, state, PKCE, Host check)                                                                              |
| 6   | Untrusted navigation     | PASS                                                                                                                                |
| 7   | Screenshot memory leaks  | PASS for 60 synthetic cycles                                                                                                        |
| 8   | Clipboard privacy        | Needs UX work (PRIVACY_REVIEW §6)                                                                                                   |
| 9   | Prompt injection         | Contained; answer only                                                                                                              |
| 10  | Insecure logging         | PASS (no logs; the bundled `debug` library logs only when a `DEBUG` environment variable is set)                                    |
| 11  | Race conditions          | Fixed T-04 and T-09; mitigated T-16                                                                                                 |
| 12  | Resource exhaustion      | Bounded (sizes, timeouts, single-flight). A compromised renderer could open handoff tabs repeatedly; nuisance only                  |
| 13  | Supply chain             | Small production tree (4 packages); lockfile present; dev-only advisory                                                             |
| 14  | Electron permissions     | PASS after T-10                                                                                                                     |
| 15  | Renderer compromise      | Can spend the user's plan through `ask` and write the clipboard. It can't read tokens, files, or the network, or capture the screen |
| 16  | Protocol handlers        | None registered                                                                                                                     |
| 17  | Updates                  | No auto-update, so no update attack surface. Users won't learn about fixes (RELEASE_CHECKLIST)                                      |
| 18  | Local data exposure      | Profile is per user; tokens encrypted; prompts plain (PRIVACY_REVIEW)                                                               |
| 19  | Auth failure recovery    | Fixed (T-02, T-05, T-06)                                                                                                            |
| 20  | Unintended network       | PASS: 0 TCP/UDP endpoints at idle on the packaged app                                                                               |

## 9. Remaining risks

1. Live ChatGPT flow never exercised end to end: model list shape, image support, real error bodies, refresh timing (T-07).
2. Paste behavior on gemini.google.com and claude.ai unverified.
3. T-05 and T-06 are fixed against OpenAI's documented behavior, but only with mocked responses. The live test should include a Disconnect and a "Use a different ChatGPT account" round trip.
4. Multi-monitor, mixed DPI, HDR, and slow-machine behavior unverified.
5. Unsigned binaries; SmartScreen will warn.
6. The clipboard keeps the screenshot after a handoff. Windows Clipboard History may also keep it, and cloud clipboard may sync it.
7. Uninstalling leaves the encrypted tokens and prompt library on disk, and the ChatGPT grant stays active.

## 10. Launch decision

**READY AFTER SPECIFIC FIXES.** The security posture is good, and the confirmed defects found here, including the approved T-05 and T-06 changes, are fixed and tested. The primary feature has now worked against the real service (26 October), but parts of the live flow and the release work remain. In order:

1. ~~**Review and commit this audit's changes.**~~ Done: committed and pushed on 26 October; CI passes on Windows.
2. **Live end-to-end test** with your own eligible account (you run it; it uses your plan). Sign in, allow plan usage, capture, analyze, ask a follow-up, then Disconnect. Confirm the app disappears from ChatGPT Settings → Security and login → Login connections. Then try "Use a different ChatGPT account". Record what `/v1/models` lists first and whether it accepts the image.
3. **Paste test** in Gemini and Claude in your browser. If only the image arrives, change the handoff to copy the image first and offer a "Copy prompt" button.
4. **Decide T-07** (model picker or fallback) from what step 2 shows.
5. **Add a LICENSE file and a short user-facing privacy note.** Fix the plan and credit wording.
6. **Multi-monitor and 125%/150% DPI test** on real hardware (TEST_REPORT §4 has the script).
7. **Choose a signing path,** or publish SHA-256 checksums with an unsigned release.

## 11. Previous audit, still valid

Dependency fixes recorded earlier remain in place: Electron moved from 44.5.1 to 44.9.3, Vite 8.3.5, `undici` advisories fixed without `--force`, `openDevTools` limited to development, package restricted to the Vite build, and the `GrantFileProtocolExtraPrivileges` fuse off. `npm audit` still reports only the `oxfmt`/`tinypool` pair.

## 12. Changes after the audit: languages, streaming, prompts toggle (26 October, committed as c066ff1)

These are new features, reviewed against the same checks. No finding.

| Area         | What changed                                                                                                     | Check                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IPC          | New `answer-delta` event from main to the main window, and the new preload function `onAnswerText` (20 in total) | Sent only to the main window through `emitTracer`. The preload passes on only an integer `requestId` and a string of at most 100,000 characters. The window ignores pieces for any request but the current one, so a stale stream cannot write into a new conversation (the T-04 pattern)                                                                                                                                    |
| Request body | `language` in `tracer:ask`; `reasoning: { effort: 'low' }`                                                       | The main process accepts only codes from its fixed list (`isLanguageCode`), and the instructions get a fixed sentence with that language's English name. A compromised renderer already controls the prompt, so this keeps the instructions fixed rather than closing a new hole. OpenAI's plan-usage docs don't confirm that every model accepts `reasoning.effort`; on a 400 that names it, Tracer retries once without it |
| Rendering    | Translated labels and streamed text                                                                              | Translations are static modules bundled with the app. They are applied with `textContent` and `setAttribute`; streamed text goes through the same Markdown-to-`textContent` path as finished answers. No `innerHTML` in `renderer.js`. Lookups use `Object.hasOwn`, so a message such as `__proto__` cannot reach the prototype                                                                                              |
| Storage      | `tracer:language`, `tracer:library-hidden` in localStorage                                                       | The stored language is checked against the list before use; an invalid value means the first-launch picker opens again                                                                                                                                                                                                                                                                                                       |
| Network      | None added                                                                                                       | The language list and names come from Chromium's `Intl.DisplayNames`; nothing is downloaded                                                                                                                                                                                                                                                                                                                                  |
| Logging      | Development-only timing line                                                                                     | Prints only the milliseconds to the first text and to the end, never the prompt or answer. Not printed in the packaged app                                                                                                                                                                                                                                                                                                   |

`npm test`: 94 passing. Lint and format clean.

## 13. Tray mode and icon (26 October, uncommitted)

No finding.

| Area                  | What changed                                                                                            | Check                                                                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IPC                   | `tracer:set-language` and the preload function `setLanguage` (21 in total)                              | Main-window main frame only (`requireSender`); only listed codes are accepted. It changes only which built-in translation the tray menu and notice use                                                                                                                                  |
| Lifetime              | Closing hides the window; Tracer runs until Quit Tracer, File → Quit, or the end of the Windows session | `quitting` is set on `before-quit`, `query-session-end`, and `session-end`, so shutdown and sign-out are not blocked (checked in Electron: a simulated session end quit the app). Without a tray icon, closing quits as before, so Tracer can't be left running with no way to reach it |
| Shortcut while hidden | The global shortcut stays registered while the window is hidden                                         | Same capture path and checks as before. A cancelled capture started from the tray leaves the window hidden                                                                                                                                                                              |
| Disk                  | `tray-notice.json` in the profile                                                                       | Holds `{"shown":true}` only                                                                                                                                                                                                                                                             |
| Icon                  | PNGs embedded in `main.cjs`; `.ico` stamped into the executables at package time                        | Generated locally from SVG by `scripts/build-icons.mjs`; nothing is downloaded                                                                                                                                                                                                          |

`npm test`: 97 passing. Lint and format clean.

## 14. Release preparation (26 October, uncommitted)

| Area             | Result                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependencies     | `npm audit --omit=dev`: 0 vulnerabilities in what ships (`jose`, `electron-squirrel-startup` and its `debug` and `ms`). Full audit: 2 critical advisories in `tinypool`, used only by the `oxfmt` formatter at development time. Fixed by `oxfmt` 0.74, a major-version jump left for approval                                                                 |
| Secrets          | No API keys, tokens, or private keys in the git history, tracked files, or `app.asar`. The ChatGPT client id is issued per install at sign-in, so nothing secret ships                                                                                                                                                                                         |
| Package          | `app.asar` holds only the Vite build and `package.json`; `resources/` adds `LICENSE` and `THIRD_PARTY_NOTICES.md`. Fuses unchanged                                                                                                                                                                                                                             |
| Error messages   | The window now shows only messages from Tracer's message list; any other exception text, such as a file path from a Node error, is replaced with "Tracer could not complete that request." and logged to the developer console only. This also stops internal details reaching the screen. A test fails if a new main-process message is missing from the list |
| App identity     | `app.setAppUserModelId('com.squirrel.tracer.Tracer')` only when packaged on Windows                                                                                                                                                                                                                                                                            |
| Release workflow | Runs only on `v*.*.*` tags, with `contents: write` limited to that job. It checks the tag against `package.json`, runs tests and lint, and creates a **draft** release, so nothing is published without review. Actions are pinned to major versions (`@v5`); pinning to commit SHAs would harden it further                                                   |
| Code signing     | Not signed. Options and costs in docs/RELEASING.md; nothing purchased                                                                                                                                                                                                                                                                                          |
| Auto-update      | Not added. It would add regular requests to update.electronjs.org; recommended only after signing and a privacy-notice update                                                                                                                                                                                                                                  |

`npm test`: 98 passing. `npm run lint`: passing.

## 15. Blank packaged window (27 October, P0, fixed; uncommitted)

The `GrantFileProtocolExtraPrivileges` fuse was turned off in an earlier audit. With it off, the packaged window, loaded from `file://`, could not load its own script and stylesheet and stayed blank. No packaged check looked at the window's contents, so this shipped in the first v1.0.0 draft and was found when you installed it.

Fix: packaged windows load from `tracer://app`, a privileged standard and secure scheme registered before startup. `protocol.handle` serves only files inside the renderer folder (`resolveAppFile` refuses other hosts and schemes, encoded traversal, and null bytes), and navigation is allowed only within that origin. The fuse stays off, which also follows Electron's recommendation to avoid `file://` (checklist item 18). The CSP is unchanged (`'self'` now means `tracer://app`). Tests: `app-protocol.test.mjs`, the updated navigation test, and source checks that `main.js` never uses `loadFile`. The release workflow now fails if the packaged window is blank.

## Sources

- OpenAI, Sign in with ChatGPT for open-source apps: [overview](https://developers.openai.com/siwc/token-sharing-open-source), [registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference), [errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [UI/UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines), [quickstart](https://developers.openai.com/siwc/quickstart)
- OpenAI Help Center, [Using your ChatGPT plan in other apps and sites](https://help.openai.com/en/articles/20001542)
- WorkOS, [Sign in with ChatGPT: the scope that spends your users' plan](https://workos.com/blog/sign-in-with-chatgpt-plan-usage-scope) (secondary)
- Microsoft Learn, [Code signing options for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) (updated 29 August 2026)
- Electron 44.9.3 type definitions (`node_modules/electron/electron.d.ts`) for the clipboard, safeStorage, and display-media APIs
