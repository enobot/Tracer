# Tracer security audit

Audit date: 25 October 2026  
Machine: Windows 10 (10.0.19045), x64  
Repository: [github.com/enobot/Tracer](https://github.com/enobot/Tracer.git)  
Scope: the working tree, including uncommitted prompt UI and the untracked `backend/` folder. GitHub `main` (`5cdcb47`) does not yet contain these changes.

## 1. Security overview

Tracer is a local Electron app. The configured shortcut hides Tracer, takes a main-process snapshot of each monitor, and then shows a selection overlay. A left drag keeps that area. A right-click keeps the monitor under the pointer. Escape drops the snapshot and keeps the previous preview. The picture stays in memory until the user submits it. ChatGPT receives it only after Sign in with ChatGPT and only from the main process. Gemini and Claude stay browser handoffs: Tracer copies the screenshot and prompt, then opens the official site. The desktop app does not write the screenshot to disk and does not start the local Express server.

The window was already on Electron’s current safe defaults (`contextIsolation` on, `nodeIntegration` off, sandbox on). Those flags are now set explicitly. Production builds also get a strict content security policy, a packaged Electron **44.9.3** runtime, and an asar that contains only the Vite build plus `package.json`.

This is not a statement that every operating-system path has been exercised. On this PC, a real snapshot was cropped to a known color window, and the running app captured both a dragged region and the whole 3440×1440 monitor. That display’s scale factor was 1. A second monitor and a non-1 scale were not attached. The automated suite does not call OpenAI.

## 2. Vulnerabilities found

| Severity | Issue                                                                                                                                                                                          | Where                               | Result                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| High     | Electron 44.5.1 is in the range for [GHSA-jr5w-w6x2-84p9](https://github.com/electron/electron/security/advisories/GHSA-jr5w-w6x2-84p9) (CVE-2026-115570), a compromised-certificate trust bug | `package.json`                      | Fixed. Runtime is 44.9.3. ChatGPT sign-in and analysis use HTTPS from the main process.                          |
| High     | Vite 8.3.1 is in the vulnerable range for the Vite / `launch-editor` advisories fixed after 8.3.2                                                                                              | dev dependency                      | Fixed in the lockfile at Vite 8.3.5. This is the dev server and build tool, not code inside the packaged app.    |
| High     | `undici` advisories in the install tree                                                                                                                                                        | transitive dev dependency           | Fixed with `npm audit fix` (not `--force`).                                                                      |
| Medium   | `openDevTools()` ran for every launch, including a packaged build                                                                                                                              | `src/main.js`                       | Fixed. The production bundle contains no `openDevTools` call.                                                    |
| Medium   | The display-media handler granted the first screen to any frame in the session, ignored failures, and would have accepted an audio request                                                     | `src/main.js`                       | Fixed. Only Tracer’s main frame can capture, audio is refused, and a stalled source lookup ends after 5 seconds. |
| Medium   | No content security policy                                                                                                                                                                     | `index.html`, session headers       | Fixed. Production policy allows only same-origin scripts and styles.                                             |
| Low      | The global shortcut stayed registered after quit and could touch a destroyed window                                                                                                            | `src/main.js`                       | Fixed. The shortcut is removed on `will-quit`, and a missing window is ignored.                                  |
| Low      | Pressing the shortcut again before the first capture finished could leave a media stream running                                                                                               | `src/renderer.js`                   | Fixed. A second press is ignored until the first capture stops its tracks.                                       |
| Low      | A package could have included `backend/`, `.env` files, and source maps                                                                                                                        | `forge.config.mjs`                  | Fixed. The built asar lists only `.vite/**` and `package.json`.                                                  |
| Low      | The unused local API accepted large screenshot posts from any loopback client and shipped an unused `openai` dependency                                                                        | `backend/server.js`                 | Hardened and the unused packages were removed. The desktop app does not start or call this server.               |
| Low      | A debug `tracer:ping` channel and “Check DevTools” errors                                                                                                                                      | `src/preload.js`, `src/renderer.js` | Removed. Failures now use a short message and do not include the screenshot.                                     |

No hardcoded API keys, tokens, or private keys were found in the tree or in git history. The history search covered every commit for common key prefixes and for added `.env`, `.pem`, and credential files. Nothing matched, so history was not rewritten.

`npm audit` after the fixes reports two remaining critical findings, both in **oxfmt / tinypool**. The non-breaking fix is not available. The fix npm offers is `oxfmt@0.74.0`, which npm marks as a breaking change, so it was not applied. oxfmt is a formatter. It is not in the packaged asar.

## 3. Fixes implemented

The shortcut still does not focus Tracer before the snapshot, so the window is not part of the picture. Capture is no longer the first screen: the main process snapshots every monitor, then the overlay lets the user drag or right-click. Submit is Ctrl+Enter or File → Analyze screenshot. Save Prompt and Set Hotkey are the two prominent buttons.

- `src/security-policy.mjs` holds the checks for prompts, screenshots, shortcuts, IPC senders, navigation, CSP, and which files may be packaged.
- `src/main.js` sets the window flags, CSP header, permission denials, display-capture rules, shortcut cleanup, and dev-only DevTools.
- `src/preload.js` exposes `tracer.onHotkeyPressed` and `tracer.inspectScreenshot` only. The hotkey callback receives no channel arguments.
- `src/renderer.js` keeps a single capture at a time, stops the stream when the frame is taken or the capture fails, and writes prompt text with `textContent`.
- `index.html` limits the prompt to 2000 characters.
- `backend/server.js` listens on `127.0.0.1` only, rejects non-loopback clients, rate-limits `POST /analyze`, and returns errors without stack traces or the request body. `openai` and `dotenv` were removed because nothing imported them.
- `forge.config.mjs` packages the Vite output only, and sets `GrantFileProtocolExtraPrivileges` to false. Existing fuses still disable `RunAsNode`, Node options, and inspect arguments, and they require asar integrity.
- `package.json` pins Electron `44.9.3`. Vite in the lockfile is `8.3.5`.
- `.gitignore` ignores `.env` files and certificate files (`*.pem`, `*.p12`, `*.pfx`).

Production CSP, from the built `index.html`:

```text
default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';
frame-src 'none'; object-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:;
script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'none'
```

Development still allows Vite’s eval and the local dev-server origin. That policy is not in the packaged HTML.

`npm run package` produced `out/tracer-win32-x64/`. The `version` file reads `44.9.3`. The asar contains:

```text
.vite/build/main.cjs
.vite/build/preload.cjs
.vite/renderer/main_window/index.html
.vite/renderer/main_window/assets/index-B43i0lJt.css
.vite/renderer/main_window/assets/index-fDRRg0Rf.js
package.json
```

There is no `backend/`, `.env`, source map, or `oxfmt` in that archive. The production main bundle sets `sandbox`, `contextIsolation`, and `webSecurity`, sets `nodeIntegration` off, and calls `unregisterAll`. It does not call `openDevTools`.

## 4. Tests performed

`node --test` — **33 passed, 0 failed.**

| Area                         | What ran                                                                                                        | Result                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Screenshot and prompt checks | Valid PNG data URLs, command-like and HTML-like prompts, oversized and non-PNG input                            | Passed                                      |
| IPC sender                   | Main frame accepted, other frames and destroyed windows rejected                                                | Passed                                      |
| Display capture              | Video-only grant for a trusted frame; camera, microphone, and `openExternal` denied                             | Passed                                      |
| CSP and navigation           | Production script source is `'self'`; dev server is allowed; other origins and `javascript:` URLs are rejected  | Passed                                      |
| Shortcuts and lifetime       | `Ctrl+Shift+Space` accepted; bare keys and extra commands rejected; quit behavior for Windows, Linux, and macOS | Passed                                      |
| Cleanup                      | Overlapping captures ignored; media tracks stopped; one hotkey listener; stalled work times out                 | Passed                                      |
| Local API                    | Loopback health and analyze calls, bad JSON, rate limit, no image echoed back                                   | Passed against a real server on `127.0.0.1` |
| Package rules                | Source, backend, env files, and maps excluded; `.vite` build files kept                                         | Passed                                      |
| Dev launch                   | `npm start` on this PC built main and preload and logged `true` from shortcut registration                      | Passed                                      |
| Production package           | `npm run package` exit code 0                                                                                   | Passed                                      |

These tests mock Electron objects or check pure rules. They do not prove that Windows captured a monitor.

`npm run lint` still fails `oxfmt --check` on `README.md`. That file was already outside the formatter’s style. It was left unchanged.

## 5. Remaining risks

1. **Region capture was exercised on one Windows display.** The attached display was 3440×1440 at scale 1. Drag, right-click, and Escape were performed on the running app. A second monitor, a different DPI, macOS, and Linux were not.
2. **The package is unsigned.** `out/tracer-win32-x64/tracer.exe` has no Authenticode signature. SmartScreen will warn anyone who downloads it. Signing needs a certificate; it was not purchased or applied.
3. **oxfmt 0.41 pulls vulnerable tinypool.** Upgrade to oxfmt 0.74 in its own change and re-run the formatter. Do not use `npm audit fix --force` for it.
4. **macOS and Linux were not built or run.** Forge has zip, deb, and rpm makers. Screen-recording permission, shortcut modifiers, and window close behavior differ. Treat those targets as untested.
5. **Multi-monitor layout is implemented and unit-tested, not observed on this PC.** Sources are paired by display id, then by physical pixel size. Only one monitor was connected during the live check.
6. **There is no automatic update.** Nothing in the app downloads a new build. Add updates only with an HTTPS feed and a signature check. That was not added here.
7. **The local API is an open loopback receiver** if someone starts `backend/server.js` by hand. It stores nothing and the desktop app never connects to it. Put authentication in front of it before it forwards a screenshot anywhere.
8. **Text inside a screenshot can still steer the model’s answer.** Tracer’s instructions tell the model to treat that text as data. The model has no tool access, file access, or shortcut control. That does not stop a misleading answer.

## 6. Privacy assessment

| Data                    | What happens                                                                                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screenshot              | Taken only after the shortcut. The main process holds the frozen frames until the user finishes or cancels. The preview is the crop or one monitor. Sent to ChatGPT only after an explicit submit, or copied for a Gemini or Claude handoff. Not written to disk and not printed. Escape discards the new frames. |
| Prompt                  | Kept in `localStorage` under `tracer:prompt`, capped at 2000 characters. Rendered as text.                                                                                                                                          |
| ChatGPT credentials     | OS-encrypted with `safeStorage` in the Electron user-data directory. The renderer receives connection status only. Disconnect revokes the refresh token and deletes the local credential.                                           |
| Account, telemetry, ads | No analytics SDK. The only account is the user’s own ChatGPT sign-in.                                                                                                                                                               |
| AI provider             | ChatGPT plan usage through the official Responses API (`store: false`, `stream: true`). Gemini and Claude are browser handoffs, not connected accounts.                                                                             |

Anyone at the keyboard can still read the in-memory image with a debugger. The app no longer opens DevTools for them in a packaged build.

If a developer key is added later, do not put it in the Electron app. People can extract secrets from a desktop binary. Use a key the user provides and store it with `safeStorage`, or a server you operate that holds the key and checks callers. The current `backend/` stub is not that server.

## 7. Production readiness

The Windows package builds and the production bundle matches the security settings above. The window title is Tracer. `productName` is still `tracer`.

There is no Tracer account database. ChatGPT sign-in is the user’s own OpenAI login, stored only as an OS-encrypted credential.

`npm audit` in `backend/` reports 0 vulnerabilities. The root audit’s only remaining findings are the oxfmt/tinypool pair described above.

## 8. Final recommendation

**READY AFTER SPECIFIC FIXES**

The issues that could be corrected in this tree are in place, and the package on this machine matches them. It is not ready for a public download until:

1. A person confirms that `Ctrl+Shift+Space` still captures the screen with another application focused, with Tracer minimized, under repeated presses, and during quit.
2. The Windows executable is Authenticode-signed.

ChatGPT analysis sends the screenshot only after the user chooses Analyze. Gemini and Claude do not receive it until the user pastes it into the official site. A live ChatGPT login and an operating-system screen capture still need a person to confirm them.
