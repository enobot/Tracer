# Tracer test report

Date: 25 October 2026. Code: `c768a2d` plus the uncommitted audit fixes (see [SECURITY_AUDIT.md](SECURITY_AUDIT.md) §7).

## 1. Environment

|            |                                                                                      |
| ---------- | ------------------------------------------------------------------------------------ |
| OS         | Windows 10 Home 10.0.19045                                                           |
| Hardware   | Alienware Area-51 R2, Intel i7-6800K (12 logical CPUs), 15.9 GB RAM, NVIDIA GTX 1080 |
| Display    | One monitor, 3440×1440, scale factor 1 (100%), origin 0,0                            |
| Electron   | 44.9.3 (packaged and probe runtime)                                                  |
| Node / npm | 25.8.0 / 11.11.0 (test runner)                                                       |
| Git        | `main` at `c768a2d`, equal to `origin/main`                                          |

## 2. Commands

```bash
npm test
```

```bash
npx electron scripts/verify-handoff-clipboard.mjs
```

```bash
npx electron scripts/verify-region-capture.mjs
```

```bash
npm audit --omit=dev
```

```bash
npm run package
```

```bash
npm run make
```

The probe harnesses used for this report live outside the repository (in the reviewer's scratch directory). Their logic is described in §6 so it can be reproduced.

## 3. Automated suite (`npm test`)

|                | Before audit                    | After audit    | After languages and streaming (26 Oct) | After tray and icon (26 Oct) | Release prep (26 Oct) |
| -------------- | ------------------------------- | -------------- | -------------------------------------- | ---------------------------- | --------------------- |
| Tests          | 57                              | 79             | 94                                     | 97                           | 98                    |
| Passed         | 57                              | 79             | 94                                     | 97                           | 98                    |
| Failed         | 0                               | 0              | 0                                      | 0                            | 0                     |
| Skipped / todo | 0                               | 0              | 0                                      | 0                            | 0                     |
| Duration       | 6.2 s first run, under 1 s warm | under 1 s warm | 1.1 s                                  | 0.8 s                        | 1.0 s                 |

### What the suite tests

| File                        | Tests | What it checks                                                                                                                                                                                                                                                                                                                                                                               | Quality notes                                                                                                                                                    |
| --------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `security-policy.test.mjs`  | 21    | Payload validation, sender checks, permissions, navigation, CSP, accelerators, capture gate, package ignore rules                                                                                                                                                                                                                                                                            | Pure functions with meaningful edge cases. Mock `webContents` objects are minimal but adequate for identity checks                                               |
| `chatgpt.test.mjs`          | 23    | PKCE URL, callback parsing, scope gating, Responses body, answer language and lighter reasoning, error mapping, URL allowlist, Markdown blocks, full sign-in → analyze → disconnect with real signed JWTs and a real loopback HTTP server, streamed text pieces, reasoning fallback, expired refresh, broken stream, timeout, 401 refresh-and-retry, revoke-before-clear, switching accounts | The strongest file. Mocks `fetch` with hand-written OpenAI responses, so it proves Tracer follows the documented contract, not that OpenAI behaves as documented |
| `architecture.test.mjs`     | 7     | Regex checks over source: secure flags, no `innerHTML`, no `child_process`, CSP plugin, clipboard API form, single instance, tray hide-and-quit rules                                                                                                                                                                                                                                        | Cheap tripwires, not behavior tests. They can't see runtime bugs; the old handoff bug passed every one of them                                                   |
| `region-select.test.mjs`    | 6     | DIP validation, scaled crop, negative origin, full monitor, pairing by id and size                                                                                                                                                                                                                                                                                                           | Good math coverage. Uses assumed thumbnail sizes, not real `desktopCapturer` output                                                                              |
| `overlay-gestures.test.mjs` | 7     | Drag, missed moves, tiny drag, right-click, Escape, clamp                                                                                                                                                                                                                                                                                                                                    | Good                                                                                                                                                             |
| `markdown-blocks.test.mjs`  | 9     | Answer formatting: numbered steps on separate lines, restarted numbering, line breaks, quotes, dividers, headings, italics, tables, snake_case and arithmetic left alone, links shown as text, code fences verbatim, only known block types                                                                                                                                                  | Added after a live answer rendered its steps as one paragraph                                                                                                    |
| `app-icon.test.mjs`         | 2     | The tray and window PNGs are 16–64 px with matching scale factors; `assets/icon.ico` holds PNGs at 16–256 px; `assets/icon.png` is 256 px                                                                                                                                                                                                                                                    | Checks the files, not how the icon looks                                                                                                                         |
| `i18n.test.mjs`             | 7     | Every translation file has exactly the English message list with placeholders kept; every visible string in `renderer.js` (parsed with Vite's parser) and every `data-i18n` value in `index.html` is in the list; no unused messages; English fallback; the default prompt is recognized in every language                                                                                   | Catches a new English string that was never translated. It can't judge whether a translation is good                                                             |
| `languages.test.mjs`        | 5     | At least 200 codes, each with an English and native name; only listed codes accepted; Windows locale mapping (zh-TW → Traditional Chinese, `no` → Norwegian Bokmål); right-to-left detection                                                                                                                                                                                                 | Names come from Chromium's `Intl.DisplayNames`, so these also run under Node's ICU                                                                               |
| `prompt-library.test.mjs`   | 3     | Save, rename, duplicate, favorite, history toggle, favorites sync                                                                                                                                                                                                                                                                                                                            | Thin: no tests for corrupted JSON, limits (100/50), or delete from Favorites                                                                                     |
| `backend.test.mjs`          | 7     | Unused loopback stub                                                                                                                                                                                                                                                                                                                                                                         | Tests code that doesn't ship. Delete with `backend/`                                                                                                             |

### What the mocks hide

- **`main.js` is never executed.** Every IPC handler, the capture pipeline, `toJpegDataUrl`, the clipboard, `shell`, and `safeStorage` run only in the real app. This is how T-01 (handoff) shipped.
- **`renderer.js` is never executed by `npm test`.** The XSS, race, and storage behavior in §6.2 was verified with a separate Electron harness.
- **Real OpenAI shapes are assumed.** The model list, SSE events, and error bodies are written from the docs. A live run is the only proof.
- **`desktopCapturer` thumbnail sizes are assumed** in the region tests.

### Tests added in this audit

Each one fails on the original code. This was checked by stashing the source changes and rerunning: 6 named failures, plus the ChatGPT file failing on the missing export. Then `chatgpt-runtime.mjs` alone was stashed: 2 failures.

For the T-05 and T-06 tests, `src/chatgpt-runtime.mjs` was replaced with its `HEAD` version and restored afterwards (hash identical). All 6 new tests failed, plus the updated expired-refresh test, which now also requires revocation.

| Test                                                                                          | Guards                                                                   |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `awaits the Electron 44 clipboard API for Gemini and Claude handoffs`                         | T-01                                                                     |
| `explains the error codes in OpenAI errors-and-recovery accurately`                           | T-02, T-03                                                               |
| `clears tokens and asks for sign-in when the refresh token has expired`                       | T-02 (runtime)                                                           |
| `closes the response stream when ChatGPT sends an invalid event`                              | T-13                                                                     |
| `reports a slow answer as a timeout, not as a cancellation`                                   | T-13                                                                     |
| `looks up handoff sites by own key only`                                                      | T-14                                                                     |
| `rejects Shift-only and AltGr-only shortcuts that would block typing`                         | T-08                                                                     |
| `keeps one app instance and never grants a page a screen stream`                              | T-09, T-10                                                               |
| `lets Tracer write text to the clipboard and refuses every capture or device permission`      | T-10 (replaces 3 tests of removed helpers)                               |
| `clamps a drag that leaves the monitor to the overlay edge`                                   | T-11                                                                     |
| `unfavorites every copy of a prompt so Favorites does not show a hidden twin`                 | T-12                                                                     |
| `refreshes once and retries when ChatGPT rejects the access token`                            | T-05                                                                     |
| `revokes, then clears, a connection ChatGPT still rejects after a refresh`                    | T-05 (one retry only; newest token revoked before the record is cleared) |
| `keeps the connection when a rejected token cannot be refreshed right now`                    | T-05 (temporary failures keep credentials)                               |
| `signs in a different account and revokes the old one only after the new identity checks out` | T-06                                                                     |
| `keeps the remembered account when signing in a different one fails`                          | T-06                                                                     |
| `points a normal sign-in that returns another account to the switch`                          | T-06                                                                     |

### Tests added for languages and streaming (26 Oct, after the audit)

These cover new features, not fixes, so there was no earlier code for them to fail on.

| Test                                                                            | Guards                                                                                                                                                                                    |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `asks for the chosen answer language and lighter reasoning`                     | The request instructions name the language; an unknown code or injected text adds nothing; `reasoning: { effort: 'low' }` is sent; only a 400 that mentions reasoning counts as a refusal |
| `passes answer text on as it streams in, and asks in the chosen language`       | Each `response.output_text.delta` reaches the callback in order, and the joined pieces equal the final answer                                                                             |
| `asks again without lighter reasoning when the model rejects it, and remembers` | One retry without the setting; the next request to that model skips it                                                                                                                    |
| The 7 tests in `i18n.test.mjs` and 5 in `languages.test.mjs`                    | See the table above                                                                                                                                                                       |

### Tests added for the tray and icon (26 Oct)

| Test                                                                        | Guards                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keeps running in the tray until the user quits, without blocking sign-out` | Close hides only while not quitting and only with a tray icon; `before-quit`, `query-session-end`, and `session-end` set `quitting`; Quit Tracer calls `app.quit()`; the tray icon is removed on quit; a cancelled capture from the tray stays hidden; `tracer:set-language` checks the sender and the code; the packaged icon is configured |
| The 2 tests in `app-icon.test.mjs`                                          | See the table above                                                                                                                                                                                                                                                                                                                          |

### Still untested (recommended next tests)

1. An Electron-level test that boots the built app with a stub runtime and drives `tracer:ask`, `tracer:handoff`, and `choose-region` through real IPC.
2. Renderer tests in CI: the §6.2 harness could be moved into `scripts/` and run with `npx electron`.
3. Prompt library limits, corrupted entries, and delete from Favorites.
4. `selectionToCrop` against real `desktopCapturer` thumbnails on two monitors with different scales (`scripts/verify-region-capture.mjs` on that hardware).

## 4. Manual tests

| Test                                                                          | Status                                                                                                                                                                         | How to run                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real ChatGPT sign-in, allow plan usage, analyze                               | **Passed, 26 Oct 2026 (run by you, `npm start`)**                                                                                                                              | Two captures analyzed with GPT-6.1-Sol. The first answer quoted text that appears only in the screenshot (proof the image was read). The second translated the capture into Vietnamese                           |
| Follow-up box, auto-send, Apply & Save in the live app                        | **Passed, 26 Oct 2026 (run by you)**                                                                                                                                           | A capture sent right away and was answered in Vietnamese; a follow-up from the bottom box asking for French was answered in French; Apply & Save showed in Set Hotkey                                            |
| Streamed answers, lower reasoning, language picker in the live app            | **Tried by you, 26 Oct 2026** ("looks good"); timing not recorded                                                                                                              | Run `npm start` with no saved language: the picker should open first. Pick a language, capture, and watch the answer appear in pieces. The terminal prints "ChatGPT: first text after X ms, finished after Y ms" |
| Tray icon and notice in the running app                                       | **Partly passed, 26 Oct 2026 (run by you):** Tracer kept running in the background after the window was closed. The notice, quitting, and how the icon looks were not reported | Close the window: the Windows notification appears once, the icon is by the clock (or under ^), the shortcut still captures, and right-click → Quit Tracer exits. Check the icon at your display scaling         |
| Translation quality                                                           | **Not run**                                                                                                                                                                    | A native speaker of each of the 20 languages reads every screen. The translations are AI-generated                                                                                                               |
| Disconnect revokes remotely                                                   | **Not run**                                                                                                                                                                    | After Disconnect, check ChatGPT Settings → Security and login → Login connections                                                                                                                                |
| Expired session recovery                                                      | **Not run**                                                                                                                                                                    | Covered by mocked tests only (expired refresh, 401 retry)                                                                                                                                                        |
| Use a different ChatGPT account                                               | **Not run** (needs two accounts)                                                                                                                                               | Sign in as A, choose Use a different ChatGPT account, sign in as B. Check that A's Login connections no longer list Tracer and that B's do                                                                       |
| Paste into gemini.google.com and claude.ai                                    | **Not run**                                                                                                                                                                    | Choose Gemini or Claude, submit, press Ctrl+V once in the page. Record whether the image, the text, or both appear                                                                                               |
| Ctrl+Shift+Space with another app focused, Tracer minimized, repeated presses | Run earlier by the developer on this PC (per the previous audit); not repeated                                                                                                 | Press the hotkey 10 times quickly; expect one overlay                                                                                                                                                            |
| Two monitors, mixed DPI (100% + 150%), monitor left of or above the primary   | **Not run** (no hardware)                                                                                                                                                      | `npx electron scripts/verify-region-capture.mjs`, then drag a region on each monitor and compare with the preview                                                                                                |
| Overshoot drag across monitors                                                | **Not run** (no hardware)                                                                                                                                                      | Start a drag near the right edge of monitor A and release on monitor B; expect a crop to A's edge                                                                                                                |
| High contrast and Narrator                                                    | **Not run**                                                                                                                                                                    | Windows Narrator: Ctrl+Win+Enter; submit and listen for the answer                                                                                                                                               |
| Installer, uninstall, upgrade                                                 | **Not run** (would modify the system)                                                                                                                                          | See [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) §6                                                                                                                                                              |

## 5. Performance

All figures are from this PC. They are single runs unless noted, not averages across machines.

| Measurement                                | Result                                                     | Method                                                                    |
| ------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| Packaged cold start to window              | 2,924 ms (first launch after build)                        | `Start-Process` until `MainWindowHandle` is set and the title is "Tracer" |
| Packaged warm start to window              | 665 ms                                                     | Same, second launch                                                       |
| Idle processes                             | 4                                                          | `Get-Process tracer`                                                      |
| Idle memory                                | 80 MB working set, 179 MB private (all processes)          | After 18 s idle                                                           |
| Idle CPU                                   | 203 ms of CPU over 10 s (about 2% of one core)             | `TotalProcessorTime` delta                                                |
| Idle network                               | 0 TCP, 0 UDP                                               | `Get-NetTCPConnection` / `Get-NetUDPEndpoint` by PID                      |
| `desktopCapturer.getSources` at 3440×1440  | 1,050 ms first call; 573 ms mean over 40; 572 ms over 20   | Probe harness                                                             |
| Hotkey to overlay                          | about 150 ms hide delay + 0.6–1.0 s capture + overlay load | Derived; not timed end to end                                             |
| Frozen-frame preview encode (1600 px, q60) | 31 ms mean                                                 | Probe                                                                     |
| Crop + encode (1600 px, q85)               | 25 ms mean                                                 | Probe                                                                     |
| Package size                               | `tracer.exe` 235 MB, `app.asar` 96 KB, `Setup.exe` 147 MB  | File sizes                                                                |

### Release-candidate measurements (26 Oct, final audit)

Same PC (Windows 10 Home 22H2, one 3440×1440 monitor at 100%). The packaged app ran with a fresh profile on G: (`--user-data-dir`). Capture timings come from `harness/perf.mjs`, which loads the shipped `main.cjs` in Electron 44.9.3 with a signed-out profile, wraps `desktopCapturer.getSources`, and right-clicks the overlay to capture the monitor. Each run measured 25 captures from the open window and 25 from the tray (the baseline run measured 10 of each). Nothing was sent anywhere.

| Metric                                                       | Baseline                 | After                                                                                                    | Change                                             | Method                                                  |
| ------------------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| Shortcut → screen capture starts, from the tray              | 159 ms median (p95 160)  | 0 ms (p95 0)                                                                                             | −159 ms                                            | The 150 ms wait now applies only to a window on screen  |
| Shortcut → overlay ready (frozen frame drawn), from the tray | 711 ms median (p95 772)  | 599 ms (p95 646)                                                                                         | −16%                                               | Polling the overlay's image until it has decoded        |
| Shortcut → overlay ready, from the open window               | 730 ms (p95 827)         | 719 ms (p95 756)                                                                                         | none (expected)                                    | Same                                                    |
| Windows screen capture (`getSources`, 3440×1440)             | 398–421 ms median        | 409–444 ms median                                                                                        | none; outside Tracer's control                     | Wrapped call                                            |
| Selection → preview in the window                            | 109 ms (p95 181)         | 76 ms (p95 90)                                                                                           | Not attributable to a change; run-to-run variation | Polling the preview image                               |
| Packaged launch → window, first launch after build           | 2,924 ms (audit, 25 Oct) | 1,192 ms                                                                                                 | Not comparable (different build and cache state)   | `Start-Process` until the window has the title "Tracer" |
| Packaged launch → window, warm                               | 665 ms (audit)           | 305 ms median of 5 (max 327)                                                                             | Not comparable (different conditions)              | Same                                                    |
| Idle memory, packaged, after 15 s                            | 179 MB private (audit)   | 189 MB private, 280 MB working set, 4 processes                                                          | about the same                                     | `Get-Process` sums                                      |
| Idle CPU, packaged, 10 s                                     | 203 ms CPU (audit)       | under 16 ms (below Windows' timer resolution)                                                            | —                                                  | `TotalProcessorTime` delta                              |
| Idle network, packaged                                       | 0 connections            | 0 connections                                                                                            | —                                                  | `Get-NetTCPConnection`                                  |
| Memory over 50 captures (harness, all processes)             | —                        | 230 MB at start → 382–421 MB from capture 10 onward, no upward trend; 344 MB when idle; main heap 6–7 MB | No leak seen                                       | `app.getAppMetrics()` every 5 rounds                    |

Also in the harness: settings files filled with garbage (`shortcut.json`, `tray-notice.json`) were ignored, and the default shortcut registered. Ten rapid presses opened one overlay. Quitting while the overlay was open exited cleanly.

Not measured: true cold start after a reboot, AI time to first text and total answer time (these need a live ChatGPT account; the development build logs both), and sleep/resume and lock/unlock behavior.

### Repeated capture memory

The probe mirrors `main.js` per cycle. It runs a full-resolution `getSources` and creates one sandboxed overlay window that receives the 1600 px q60 frame. Then it either crops and encodes into a long-lived "main window", or cancels. The overlay is destroyed every cycle, and GC is forced every 5 cycles. Screen pixels stayed in memory only.

| Phase                            | Browser-process private MB | All-process private MB | Main JS heap MB |
| -------------------------------- | -------------------------- | ---------------------- | --------------- |
| Start                            | 101                        | 205                    | 4               |
| After 5 / 10 / 15 / 20 captures  | 147 / 128 / 145 / 183      | 283 / 276 / 299 / 340  | 6 / 4 / 5 / 8   |
| After 25 / 30 / 35 / 40 captures | 127 / 156 / 131 / 157      | 282 / 314 / 296 / 326  | 4 / 6 / 4 / 6   |
| Main window destroyed            | 157                        | 271                    | 6               |
| 20 cancel cycles (start → end)   | 157 → 151                  | 292 → 242              | 6 → 5           |

There was a one-time rise of about 50 MB in the browser process, then a plateau with no upward trend over 60 cycles. Native image buffers are released lazily, which explains the swings. This doesn't prove there's no slow leak over thousands of cycles, and it doesn't include the real hotkey, focus changes, or a visible overlay.

**Streaming.** At audit time, Tracer read the SSE stream in main and sent the finished answer at the end, so the window showed a waiting message for up to 90 s. Since 26 Oct the main process forwards text to the window in batches every 60 ms while it arrives, and the window redraws at most once per frame. Requests also ask for low reasoning effort. Not yet timed against the real service; in development mode the terminal prints the time to the first text and to the finished answer.

## 6. Electron probes (reproducible, not in `npm test`)

### 6.1 Platform behavior

| Probe                                                                               | Result                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tracer's original `clipboard.write({ text, image })`                                | Rejected: "clipboard.write expects an array of ClipboardItem". Clipboard unchanged. App kept running with `UnhandledPromiseRejectionWarning`             |
| `clipboard.write([new ClipboardItem({ 'text/plain', 'image/png' })])`               | Clipboard holds `text/plain` + `image/png`. A web page's `paste` event saw both; a plain `contenteditable` inserted the text and one image               |
| JPEG data URL → `nativeImage.createFromDataURL`                                     | Decodes (non-empty)                                                                                                                                      |
| Main window zoomed to level 0.5, then overlay opened from the same `file://` folder | Overlay zoom level 0, factor 1, viewport equal to window size. No coordinate skew                                                                        |
| Overlay window at display bounds                                                    | Viewport 3440×1440, `devicePixelRatio` 1, matches the display                                                                                            |
| `getDisplayMedia` with the original handler                                         | Refused by the `media` permission check; with `media` allowed, the original handler granted a full-screen stream with no picker. The new handler refuses |
| `<form method="dialog">` under `form-action 'none'`                                 | Dialog closes, `returnValue` "cancel", no CSP violation                                                                                                  |
| `safeStorage`                                                                       | Available; round-trips; `v10` prefix                                                                                                                     |
| All other Electron APIs Tracer calls                                                | Present in 44.9.3                                                                                                                                        |
| Profile after repeated synthetic captures                                           | No JPEG data in any profile file                                                                                                                         |
| localStorage value overwritten, then normal quit                                    | Old value still in `Local Storage/leveldb/000003.log` until compaction                                                                                   |

### 6.2 Built renderer and real preload with a fake main process

| Scenario                                                                   | Result                                                                                                                                              |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tracer:library` set to `{not json`                                        | Loads with an empty library: "Prompts you submit appear here."                                                                                      |
| Saved prompt title and text `<img onerror>` + `<script>`                   | Rendered as literal text; 0 injected elements; flag not set                                                                                         |
| Clicking a saved prompt and Save Prompt                                    | 0 requests sent                                                                                                                                     |
| Hostile answer (HTML, `javascript:` link, bold, code fence) via Ctrl+Enter | 0 `img`/`script`/`a`; 1 `strong`; 1 `pre`; literal `<script>` shown; Ctrl+Enter sent exactly one request                                            |
| New capture while a 600 ms reply is pending                                | Analyze and Disconnect disabled during the request; stale reply not shown; follow-up history 0; buttons re-enabled                                  |
| Answer area                                                                | `aria-live="polite"` present                                                                                                                        |
| No remembered account                                                      | "Use a different ChatGPT account" hidden                                                                                                            |
| Remembered account                                                         | Button shown; click sends `{ reconsent: false, fresh: true }`; the main process's notice is shown. Continue with ChatGPT still sends `fresh: false` |

### 6.3 Reworked window (built renderer, fake main process)

| Scenario                                    | Result                                                                                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty state                                 | Prompt box is 2 rows (62 px). Capture instructions shown. Follow-up box hidden                                                                                              |
| Capture with "Send right after capture" on  | Sent at once with the prompt box text and empty history                                                                                                                     |
| Formatted answer                            | 3 numbered items, 1 quote, 1 divider, 1 table, 1 heading, italics and bold rendered; no `1.`, `>` or `---` left as text; 0 injected elements                                |
| Follow-up box (Enter)                       | Sent with history `[user, assistant]`; 2 questions and 2 answers shown; box cleared; both prompts in Past Prompts                                                           |
| New capture while a 600 ms reply is pending | Stale reply never shown; the new capture's answer shown; follow-up history 0                                                                                                |
| "Send right after capture" off              | Capture sends nothing; status "Captured. Nothing has been sent yet."; Analyze screenshot sends one request                                                                  |
| Signed out                                  | Capture sends nothing; status asks to sign in; account menu opens; Escape closes it                                                                                         |
| Set Hotkey                                  | Apply & Save disabled until a shortcut is pressed; Shift+A refused with a message; Ctrl+Alt+K enabled it; one `setHotkey` call only after Apply & Save; Cancel made no call |
| Saved prompt clicked with a screenshot open | Text placed in the follow-up box and focused                                                                                                                                |
| Window 700 px wide                          | Library stacks below; question box stays at the bottom                                                                                                                      |
| Console                                     | No errors (besides the known `frame-ancestors` notice)                                                                                                                      |

Screenshots of each state were reviewed. They caught two layout bugs, both fixed: screen-reader labels made the whole window scroll after a follow-up, and the library tab labels wrapped.

### 6.4 Languages, streaming, and the prompts toggle (built renderer, fake main process, 26 Oct)

The fake `tracer:ask` handler sent three `answer-delta` events 250 ms apart before returning the answer.

| Scenario                          | Result                                                                                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First launch, nothing stored      | Language picker open, Cancel hidden, Escape did not close it. 217 languages in two groups: "Full app translation" and "Answers only"                                                                                    |
| Search "tieng"                    | One match, Tiếng Việt (accents ignored)                                                                                                                                                                                 |
| Click Tiếng Việt                  | Picker title, Continue, and the window behind it switched to Vietnamese before confirming                                                                                                                               |
| Continue                          | `tracer:language` = `vi`, `<html lang="vi">`, button "Tiếng Việt", default prompt, capture hint, tabs, and account chip in Vietnamese                                                                                   |
| Capture                           | Request carried `language: 'vi'`, the Vietnamese default prompt, and the request id. After 400 ms the first piece was on screen with `aria-busy`; the final answer replaced it and the busy flag cleared                |
| Hide prompts                      | Library hidden, button "Hiện lời nhắc" (Show prompts), `aria-expanded="false"`; still hidden after a reload; shown again with one click                                                                                 |
| Arabic                            | `dir="rtl"`, Arabic labels and default prompt, library on the left, answer and buttons mirrored                                                                                                                         |
| Swahili (no built-in translation) | Left to right, English buttons, language button "Kiswahili", note "Answers use this language. Buttons stay in English." Picking another language and pressing Cancel kept Swahili. The request carried `language: 'sw'` |
| Console                           | No errors                                                                                                                                                                                                               |

### 6.5 Tray mode (built main process in Electron, fresh profile on G:, 26 Oct)

The harness loaded `.vite/build/main.cjs` as it ships. It recorded the tray menu and notice instead of showing them, and kept the shortcut's callback so it could start a capture. The capture overlay opened on the real screen and was cancelled with Escape; nothing was saved.

| Scenario                                                 | Result                                                                                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start                                                    | Window visible; `Ctrl+Shift+Space` registered; tray menu "Open Tracer, Quit Tracer"                                                                         |
| Close the window                                         | Hidden, not destroyed; shortcut still registered; notice "Tracer is still running" with the shortcut and how to quit; `tray-notice.json` = `{"shown":true}` |
| Shortcut while hidden, then Escape                       | One overlay opened; window still hidden afterwards                                                                                                          |
| Second launch (`second-instance`)                        | Window shown                                                                                                                                                |
| Shortcut while visible, then Escape                      | Window visible afterwards, as before                                                                                                                        |
| Window language set to Vietnamese                        | Tray menu rebuilt as "Mở Tracer, Thoát Tracer"                                                                                                              |
| Close again                                              | Hidden; no second notice                                                                                                                                    |
| Quit (`app.quit()`)                                      | `will-quit` ran; process exited with code 0                                                                                                                 |
| Windows session ending (`query-session-end`, then close) | Window closed instead of hiding; the app quit on its own (exit code 0)                                                                                      |

### 6.6 Release build (26 Oct)

| Check                                                 | Result                                                                                                                                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run make`                                        | `Tracer-Setup-win32-x64.exe` (147 MB), `tracer-1.0.0-full.nupkg`, `RELEASES`. Installer details: product Tracer, company Tracy Tran, version 1.0.0, not signed. Local SHA-256 `09f4957f…51c7a` (the release workflow builds its own copy, so its hash will differ) |
| `Tracer.exe` details                                  | Product and description Tracer, company Tracy Tran, version 1.0.0, copyright 2026 Tracy Tran, Tracer icon                                                                                                                                                          |
| Packaged app, fresh profile on G: (`--user-data-dir`) | Window opened; 4 processes; `Ctrl+Shift+Space` held by Tracer (a helper could not register it while Tracer ran, and could before and after); 0 network connections while idle; the real profile was untouched                                                      |
| `resources/` in the package                           | `app.asar`, `LICENSE`, `THIRD_PARTY_NOTICES.md`                                                                                                                                                                                                                    |
| `npx electron scripts/verify-handoff-clipboard.mjs`   | `ok: true` (image and text copied; the old call form still rejects)                                                                                                                                                                                                |
| `npm run lint`                                        | Passing (6 files reformatted; it had been failing). `.gitattributes` added because CRLF checkouts fail the format check                                                                                                                                            |
| `npm audit --omit=dev`                                | 0 vulnerabilities. Full audit: 2 critical in the dev-only `oxfmt` → `tinypool` chain; fix is `oxfmt` 0.74, pending approval                                                                                                                                        |

Built window with a fake main process (Vietnamese selected): a raw `EACCES: permission denied, open 'C:\Users\…'` error was shown as "Tracer không thể hoàn tất yêu cầu này." with no path, and "ChatGPT returned an empty answer." was shown translated. In the prompt library, Right moved to and selected Favorites (only the selected tab had `tabIndex` 0, and the panel was labelled by it), End went to Saved Prompts, and Right from there wrapped to Past Prompts.

Not covered: installing with Setup.exe (it writes to `%LocalAppData%` on C:, so it is left for a clean-PC test), and the draft release built by the workflow.

### 6.7 Blank packaged window (27 Oct)

Installing the first v1.0.0 draft showed a blank white window. Reproduced with the local packaged `Tracer.exe`: `scripts/verify-packaged-window.ps1` measured 0% of the page area drawn. The same build with only `GrantFileProtocolExtraPrivileges` turned back on rendered normally. Earlier "packaged app runs" checks, including the startup timings in section 5, only waited for a window titled Tracer, so they missed this.

After the fix (window served from `tracer://app`, fuse still off):

| Check                                                           | Result                                                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `verify-packaged-window.ps1` on the packaged app                | 55.8% of the page drawn; language picker visible                                                               |
| Fuses                                                           | GrantFileProtocolExtraPrivileges disabled, asar integrity and only-load-from-asar enabled                      |
| Captures through the new protocol (harness, shipped `main.cjs`) | 3 from the window and 3 from the tray completed; 10 rapid presses → 1 overlay; quit exits                      |
| Settings across a restart                                       | `tracer:language` written in one run was read in the next; the window came up in Vietnamese without the picker |
| `npm test`                                                      | 102 passed                                                                                                     |

## 7. Functional review

Status key: **Auto** = automated test, **Probe** = Electron probe, **Code** = code review only, **Manual** = needs a person or hardware.

| Area     | Item                                                                                          | Status                                                          |
| -------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Hotkey   | Default works; registered at startup                                                          | Code; earlier live check by the developer                       |
| Hotkey   | Custom shortcut persists in `shortcut.json`                                                   | Code                                                            |
| Hotkey   | Invalid shortcuts rejected                                                                    | Auto                                                            |
| Hotkey   | Conflicts reported ("already in use"), previous restored                                      | Code                                                            |
| Hotkey   | Unregistered on quit                                                                          | Code (`unregisterAll` in `will-quit`; OS releases on exit)      |
| Hotkey   | Works while minimized                                                                         | Code (`globalShortcut`); Manual to confirm                      |
| Capture  | Correct region, correct monitor                                                               | Auto (math), Probe (single monitor); Manual for multi-monitor   |
| Capture  | Cancel keeps the previous preview                                                             | Code                                                            |
| Capture  | New capture replaces the preview and conversation                                             | Probe                                                           |
| Capture  | No upload until submit                                                                        | Probe                                                           |
| Analysis | Explicit submit; Ctrl+Enter; File → Analyze                                                   | Probe (Ctrl+Enter); Code (menu)                                 |
| Analysis | Prompt and image transmitted correctly                                                        | Auto (mocked)                                                   |
| Analysis | Answer renders; follow-ups carry history and the image                                        | Auto (body), Probe (render)                                     |
| Analysis | Understandable errors                                                                         | Improved (T-02, T-03, T-13)                                     |
| Library  | Three tabs, persistence, favorites sync, delete                                               | Auto (logic), Probe (render, storage)                           |
| Library  | Hide and show, remembered                                                                     | Probe                                                           |
| Language | First-launch picker, change later, answers in the chosen language                             | Auto (request), Probe (window); Manual against the real service |
| Language | Window text in 20 languages, right to left for Arabic and Persian                             | Auto (completeness), Probe (render); Manual for wording         |
| Analysis | Text appears while the answer is written                                                      | Auto (stream pieces), Probe (render); Manual for real timing    |
| Window   | Minimize/restore after capture                                                                | Code (`restoreMain`)                                            |
| Window   | Quit Tracer exits cleanly (closing the window quit Tracer until the tray was added on 26 Oct) | Probe                                                           |
| Window   | Second launch focuses the first                                                               | Probe                                                           |
| Window   | Resize: minimum 720×560, stacks below 860 px                                                  | Code                                                            |
| Window   | Close hides to the tray; shortcut keeps working; Quit Tracer exits                            | Auto (source rules), Probe (Electron); Manual for the real tray |
| Window   | High DPI, monitor switching                                                                   | Manual                                                          |

## 8. UX and accessibility review

Recommendations only. No visual changes were made.

- **Submitting (done).** Capture now sends right away by default. With that off, "Analyze screenshot" is a solid button next to the screenshot, and follow-ups have their own box with a Send button.
- **Progress while waiting (done).** The thread shows "Waiting for ChatGPT…" with Cancel until the first words arrive, then the answer fills in as it is written.
- **Language (done).** A first-launch picker and a globe button at the top, so someone who doesn't read English can set it once. Each language is listed in its own script.
- **Connection and provider live inside the chip popover.** That works, but OpenAI's guidelines suggest a visible "Using ChatGPT plan" near the composer with a "Manage usage" link. Make "Manage usage" the primary action in the usage-limit message.
- **Overlay preview is low resolution.** The 1600 px q60 frame is stretched across 3440 px, which makes precise selection on small text harder. Encoding costs about 31 ms, so higher quality is cheap.
- **Keyboard.** The Set Hotkey dialog now lets Tab and Enter reach Cancel and Apply & Save. The library tabs still use `role="tab"` without `aria-controls`, `tabpanel`, or arrow-key movement.
- **Screen readers.** The answer area now announces updates (`aria-live`). The preview has alt text. Focus isn't moved after a capture.
- **Contrast** (WCAG, against white): body 16.5:1, hints 7.5:1, meta text 5.0:1, link buttons 6.5:1, error 7.5:1. All pass AA.
- **Error messages** are short and actionable after the fixes. Raw Node errors can still appear if writing the credential file fails.
- **Light theme only;** there is no dark mode.
