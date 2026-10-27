# Tracer test report

Date: 25 October 2026. Code: `c768a2d` plus the uncommitted audit fixes (see [SECURITY_AUDIT.md](SECURITY_AUDIT.md) §7).

## 1. Environment

| | |
| --- | --- |
| OS | Windows 10 Home 10.0.19045 |
| Hardware | Alienware Area-51 R2, Intel i7-6800K (12 logical CPUs), 15.9 GB RAM, NVIDIA GTX 1080 |
| Display | One monitor, 3440×1440, scale factor 1 (100%), origin 0,0 |
| Electron | 44.9.3 (packaged and probe runtime) |
| Node / npm | 25.8.0 / 11.11.0 (test runner) |
| Git | `main` at `c768a2d`, equal to `origin/main` |

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

| | Before audit | After audit |
| --- | --- | --- |
| Tests | 57 | 79 |
| Passed | 57 | 79 |
| Failed | 0 | 0 |
| Skipped / todo | 0 | 0 |
| Duration | 6.2 s first run, under 1 s warm | under 1 s warm |

### What the suite tests

| File | Tests | What it checks | Quality notes |
| --- | --- | --- | --- |
| `security-policy.test.mjs` | 21 | Payload validation, sender checks, permissions, navigation, CSP, accelerators, capture gate, package ignore rules | Pure functions with meaningful edge cases. Mock `webContents` objects are minimal but adequate for identity checks |
| `chatgpt.test.mjs` | 20 | PKCE URL, callback parsing, scope gating, Responses body, error mapping, URL allowlist, Markdown blocks, full sign-in → analyze → disconnect with real signed JWTs and a real loopback HTTP server, expired refresh, broken stream, timeout, 401 refresh-and-retry, revoke-before-clear, switching accounts | The strongest file. Mocks `fetch` with hand-written OpenAI responses, so it proves Tracer follows the documented contract, not that OpenAI behaves as documented |
| `architecture.test.mjs` | 6 | Regex checks over source: secure flags, no `innerHTML`, no `child_process`, CSP plugin, clipboard API form, single instance | Cheap tripwires, not behavior tests. They can't see runtime bugs; the old handoff bug passed every one of them |
| `region-select.test.mjs` | 6 | DIP validation, scaled crop, negative origin, full monitor, pairing by id and size | Good math coverage. Uses assumed thumbnail sizes, not real `desktopCapturer` output |
| `overlay-gestures.test.mjs` | 7 | Drag, missed moves, tiny drag, right-click, Escape, clamp | Good |
| `markdown-blocks.test.mjs` | 9 | Answer formatting: numbered steps on separate lines, restarted numbering, line breaks, quotes, dividers, headings, italics, tables, snake_case and arithmetic left alone, links shown as text, code fences verbatim, only known block types | Added after a live answer rendered its steps as one paragraph |
| `prompt-library.test.mjs` | 3 | Save, rename, duplicate, favorite, history toggle, favorites sync | Thin: no tests for corrupted JSON, limits (100/50), or delete from Favorites |
| `backend.test.mjs` | 7 | Unused loopback stub | Tests code that doesn't ship. Delete with `backend/` |

### What the mocks hide

- **`main.js` is never executed.** Every IPC handler, the capture pipeline, `toJpegDataUrl`, the clipboard, `shell`, and `safeStorage` run only in the real app. This is how T-01 (handoff) shipped.
- **`renderer.js` is never executed by `npm test`.** The XSS, race, and storage behavior in §6.2 was verified with a separate Electron harness.
- **Real OpenAI shapes are assumed.** The model list, SSE events, and error bodies are written from the docs. A live run is the only proof.
- **`desktopCapturer` thumbnail sizes are assumed** in the region tests.

### Tests added in this audit

Each one fails on the original code. This was checked by stashing the source changes and rerunning: 6 named failures, plus the ChatGPT file failing on the missing export. Then `chatgpt-runtime.mjs` alone was stashed: 2 failures.

For the T-05 and T-06 tests, `src/chatgpt-runtime.mjs` was replaced with its `HEAD` version and restored afterwards (hash identical). All 6 new tests failed, plus the updated expired-refresh test, which now also requires revocation.

| Test | Guards |
| --- | --- |
| `awaits the Electron 44 clipboard API for Gemini and Claude handoffs` | T-01 |
| `explains the error codes in OpenAI errors-and-recovery accurately` | T-02, T-03 |
| `clears tokens and asks for sign-in when the refresh token has expired` | T-02 (runtime) |
| `closes the response stream when ChatGPT sends an invalid event` | T-13 |
| `reports a slow answer as a timeout, not as a cancellation` | T-13 |
| `looks up handoff sites by own key only` | T-14 |
| `rejects Shift-only and AltGr-only shortcuts that would block typing` | T-08 |
| `keeps one app instance and never grants a page a screen stream` | T-09, T-10 |
| `lets Tracer write text to the clipboard and refuses every capture or device permission` | T-10 (replaces 3 tests of removed helpers) |
| `clamps a drag that leaves the monitor to the overlay edge` | T-11 |
| `unfavorites every copy of a prompt so Favorites does not show a hidden twin` | T-12 |
| `refreshes once and retries when ChatGPT rejects the access token` | T-05 |
| `revokes, then clears, a connection ChatGPT still rejects after a refresh` | T-05 (one retry only; newest token revoked before the record is cleared) |
| `keeps the connection when a rejected token cannot be refreshed right now` | T-05 (temporary failures keep credentials) |
| `signs in a different account and revokes the old one only after the new identity checks out` | T-06 |
| `keeps the remembered account when signing in a different one fails` | T-06 |
| `points a normal sign-in that returns another account to the switch` | T-06 |

### Still untested (recommended next tests)

1. An Electron-level test that boots the built app with a stub runtime and drives `tracer:ask`, `tracer:handoff`, and `choose-region` through real IPC.
2. Renderer tests in CI: the §6.2 harness could be moved into `scripts/` and run with `npx electron`.
3. Prompt library limits, corrupted entries, and delete from Favorites.
4. `selectionToCrop` against real `desktopCapturer` thumbnails on two monitors with different scales (`scripts/verify-region-capture.mjs` on that hardware).

## 4. Manual tests

| Test | Status | How to run |
| --- | --- | --- |
| Real ChatGPT sign-in, allow plan usage, analyze | **Passed, 26 Oct 2026 (run by you, `npm start`)** | Two captures analyzed with GPT-6.1-Sol. The first answer quoted text that appears only in the screenshot (proof the image was read). The second translated the capture into Vietnamese |
| Follow-up box, auto-send, Apply & Save in the live app | **Not run** (new UI) | Capture with auto-send on, ask a follow-up from the bottom box, change the hotkey and confirm the new one captures |
| Disconnect revokes remotely | **Not run** | After Disconnect, check ChatGPT Settings → Security and login → Login connections |
| Expired session recovery | **Not run** | Covered by mocked tests only (expired refresh, 401 retry) |
| Use a different ChatGPT account | **Not run** (needs two accounts) | Sign in as A, choose Use a different ChatGPT account, sign in as B. Check that A's Login connections no longer list Tracer and that B's do |
| Paste into gemini.google.com and claude.ai | **Not run** | Choose Gemini or Claude, submit, press Ctrl+V once in the page. Record whether the image, the text, or both appear |
| Ctrl+Shift+Space with another app focused, Tracer minimized, repeated presses | Run earlier by the developer on this PC (per the previous audit); not repeated | Press the hotkey 10 times quickly; expect one overlay |
| Two monitors, mixed DPI (100% + 150%), monitor left of or above the primary | **Not run** (no hardware) | `npx electron scripts/verify-region-capture.mjs`, then drag a region on each monitor and compare with the preview |
| Overshoot drag across monitors | **Not run** (no hardware) | Start a drag near the right edge of monitor A and release on monitor B; expect a crop to A's edge |
| High contrast and Narrator | **Not run** | Windows Narrator: Ctrl+Win+Enter; submit and listen for the answer |
| Installer, uninstall, upgrade | **Not run** (would modify the system) | See [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) §6 |

## 5. Performance

All figures are from this PC. They are single runs unless noted, not averages across machines.

| Measurement | Result | Method |
| --- | --- | --- |
| Packaged cold start to window | 2,924 ms (first launch after build) | `Start-Process` until `MainWindowHandle` is set and the title is "Tracer" |
| Packaged warm start to window | 665 ms | Same, second launch |
| Idle processes | 4 | `Get-Process tracer` |
| Idle memory | 80 MB working set, 179 MB private (all processes) | After 18 s idle |
| Idle CPU | 203 ms of CPU over 10 s (about 2% of one core) | `TotalProcessorTime` delta |
| Idle network | 0 TCP, 0 UDP | `Get-NetTCPConnection` / `Get-NetUDPEndpoint` by PID |
| `desktopCapturer.getSources` at 3440×1440 | 1,050 ms first call; 573 ms mean over 40; 572 ms over 20 | Probe harness |
| Hotkey to overlay | about 150 ms hide delay + 0.6–1.0 s capture + overlay load | Derived; not timed end to end |
| Frozen-frame preview encode (1600 px, q60) | 31 ms mean | Probe |
| Crop + encode (1600 px, q85) | 25 ms mean | Probe |
| Package size | `tracer.exe` 235 MB, `app.asar` 96 KB, `Setup.exe` 147 MB | File sizes |

### Repeated capture memory

The probe mirrors `main.js` per cycle. It runs a full-resolution `getSources` and creates one sandboxed overlay window that receives the 1600 px q60 frame. Then it either crops and encodes into a long-lived "main window", or cancels. The overlay is destroyed every cycle, and GC is forced every 5 cycles. Screen pixels stayed in memory only.

| Phase | Browser-process private MB | All-process private MB | Main JS heap MB |
| --- | --- | --- | --- |
| Start | 101 | 205 | 4 |
| After 5 / 10 / 15 / 20 captures | 147 / 128 / 145 / 183 | 283 / 276 / 299 / 340 | 6 / 4 / 5 / 8 |
| After 25 / 30 / 35 / 40 captures | 127 / 156 / 131 / 157 | 282 / 314 / 296 / 326 | 4 / 6 / 4 / 6 |
| Main window destroyed | 157 | 271 | 6 |
| 20 cancel cycles (start → end) | 157 → 151 | 292 → 242 | 6 → 5 |

There was a one-time rise of about 50 MB in the browser process, then a plateau with no upward trend over 60 cycles. Native image buffers are released lazily, which explains the swings. This doesn't prove there's no slow leak over thousands of cycles, and it doesn't include the real hotkey, focus changes, or a visible overlay.

**Streaming.** Tracer reads the SSE stream in main and sends the finished answer at the end. The UI shows "Sending the screenshot to ChatGPT." until then, up to 90 s. That isn't a leak, but it does feel unresponsive (see §8).

## 6. Electron probes (reproducible, not in `npm test`)

### 6.1 Platform behavior

| Probe | Result |
| --- | --- |
| Tracer's original `clipboard.write({ text, image })` | Rejected: "clipboard.write expects an array of ClipboardItem". Clipboard unchanged. App kept running with `UnhandledPromiseRejectionWarning` |
| `clipboard.write([new ClipboardItem({ 'text/plain', 'image/png' })])` | Clipboard holds `text/plain` + `image/png`. A web page's `paste` event saw both; a plain `contenteditable` inserted the text and one image |
| JPEG data URL → `nativeImage.createFromDataURL` | Decodes (non-empty) |
| Main window zoomed to level 0.5, then overlay opened from the same `file://` folder | Overlay zoom level 0, factor 1, viewport equal to window size. No coordinate skew |
| Overlay window at display bounds | Viewport 3440×1440, `devicePixelRatio` 1, matches the display |
| `getDisplayMedia` with the original handler | Refused by the `media` permission check; with `media` allowed, the original handler granted a full-screen stream with no picker. The new handler refuses |
| `<form method="dialog">` under `form-action 'none'` | Dialog closes, `returnValue` "cancel", no CSP violation |
| `safeStorage` | Available; round-trips; `v10` prefix |
| All other Electron APIs Tracer calls | Present in 44.9.3 |
| Profile after repeated synthetic captures | No JPEG data in any profile file |
| localStorage value overwritten, then normal quit | Old value still in `Local Storage/leveldb/000003.log` until compaction |

### 6.2 Built renderer and real preload with a fake main process

| Scenario | Result |
| --- | --- |
| `tracer:library` set to `{not json` | Loads with an empty library: "Prompts you submit appear here." |
| Saved prompt title and text `<img onerror>` + `<script>` | Rendered as literal text; 0 injected elements; flag not set |
| Clicking a saved prompt and Save Prompt | 0 requests sent |
| Hostile answer (HTML, `javascript:` link, bold, code fence) via Ctrl+Enter | 0 `img`/`script`/`a`; 1 `strong`; 1 `pre`; literal `<script>` shown; Ctrl+Enter sent exactly one request |
| New capture while a 600 ms reply is pending | Analyze and Disconnect disabled during the request; stale reply not shown; follow-up history 0; buttons re-enabled |
| Answer area | `aria-live="polite"` present |
| No remembered account | "Use a different ChatGPT account" hidden |
| Remembered account | Button shown; click sends `{ reconsent: false, fresh: true }`; the main process's notice is shown. Continue with ChatGPT still sends `fresh: false` |

### 6.3 Reworked window (built renderer, fake main process)

| Scenario | Result |
| --- | --- |
| Empty state | Prompt box is 2 rows (62 px). Capture instructions shown. Follow-up box hidden |
| Capture with "Send right after capture" on | Sent at once with the prompt box text and empty history |
| Formatted answer | 3 numbered items, 1 quote, 1 divider, 1 table, 1 heading, italics and bold rendered; no `1.`, `>` or `---` left as text; 0 injected elements |
| Follow-up box (Enter) | Sent with history `[user, assistant]`; 2 questions and 2 answers shown; box cleared; both prompts in Past Prompts |
| New capture while a 600 ms reply is pending | Stale reply never shown; the new capture's answer shown; follow-up history 0 |
| "Send right after capture" off | Capture sends nothing; status "Captured. Nothing has been sent yet."; Analyze screenshot sends one request |
| Signed out | Capture sends nothing; status asks to sign in; account menu opens; Escape closes it |
| Set Hotkey | Apply & Save disabled until a shortcut is pressed; Shift+A refused with a message; Ctrl+Alt+K enabled it; one `setHotkey` call only after Apply & Save; Cancel made no call |
| Saved prompt clicked with a screenshot open | Text placed in the follow-up box and focused |
| Window 700 px wide | Library stacks below; question box stays at the bottom |
| Console | No errors (besides the known `frame-ancestors` notice) |

Screenshots of each state were reviewed. They caught two layout bugs, both fixed: screen-reader labels made the whole window scroll after a follow-up, and the library tab labels wrapped.

## 7. Functional review

Status key: **Auto** = automated test, **Probe** = Electron probe, **Code** = code review only, **Manual** = needs a person or hardware.

| Area | Item | Status |
| --- | --- | --- |
| Hotkey | Default works; registered at startup | Code; earlier live check by the developer |
| Hotkey | Custom shortcut persists in `shortcut.json` | Code |
| Hotkey | Invalid shortcuts rejected | Auto |
| Hotkey | Conflicts reported ("already in use"), previous restored | Code |
| Hotkey | Unregistered on quit | Code (`unregisterAll` in `will-quit`; OS releases on exit) |
| Hotkey | Works while minimized | Code (`globalShortcut`); Manual to confirm |
| Capture | Correct region, correct monitor | Auto (math), Probe (single monitor); Manual for multi-monitor |
| Capture | Cancel keeps the previous preview | Code |
| Capture | New capture replaces the preview and conversation | Probe |
| Capture | No upload until submit | Probe |
| Analysis | Explicit submit; Ctrl+Enter; File → Analyze | Probe (Ctrl+Enter); Code (menu) |
| Analysis | Prompt and image transmitted correctly | Auto (mocked) |
| Analysis | Answer renders; follow-ups carry history and the image | Auto (body), Probe (render) |
| Analysis | Understandable errors | Improved (T-02, T-03, T-13) |
| Library | Three tabs, persistence, favorites sync, delete | Auto (logic), Probe (render, storage) |
| Window | Minimize/restore after capture | Code (`restoreMain`) |
| Window | Close quits on Windows | Probe (packaged app closed cleanly) |
| Window | Second launch focuses the first | Probe |
| Window | Resize: minimum 720×560, stacks below 860 px | Code |
| Window | High DPI, monitor switching | Manual |

## 8. UX and accessibility review

Recommendations only. No visual changes were made.

- **Submitting (done).** Capture now sends right away by default. With that off, "Analyze screenshot" is a solid button next to the screenshot, and follow-ups have their own box with a Send button.
- **Progress while waiting.** The thread shows "Waiting for ChatGPT…" with Cancel, but the text still arrives all at once. Streaming it in as it arrives is the next improvement.
- **Connection and provider live inside the chip popover.** That works, but OpenAI's guidelines suggest a visible "Using ChatGPT plan" near the composer with a "Manage usage" link. Make "Manage usage" the primary action in the usage-limit message.
- **Overlay preview is low resolution.** The 1600 px q60 frame is stretched across 3440 px, which makes precise selection on small text harder. Encoding costs about 31 ms, so higher quality is cheap.
- **Keyboard.** The Set Hotkey dialog now lets Tab and Enter reach Cancel and Apply & Save. The library tabs still use `role="tab"` without `aria-controls`, `tabpanel`, or arrow-key movement.
- **Screen readers.** The answer area now announces updates (`aria-live`). The preview has alt text. Focus isn't moved after a capture.
- **Contrast** (WCAG, against white): body 16.5:1, hints 7.5:1, meta text 5.0:1, link buttons 6.5:1, error 7.5:1. All pass AA.
- **Error messages** are short and actionable after the fixes. Raw Node errors can still appear if writing the credential file fails.
- **Light theme only;** there is no dark mode.
