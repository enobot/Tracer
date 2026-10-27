# Tracer 1.0.0 — final pre-release review

Date: 26 October 2026. Reviewed: `main` at `746857e`, plus the uncommitted audit changes listed in section F. Test machine: Windows 10 Home 22H2 (x64), one 3440×1440 monitor at 100% scaling, Node 25.8.0, Electron 44.9.3.

## A. Executive summary

**Update, 27 October: the first draft installer showed a blank window when installed (R-07, P0).** Your install test caught it; the fix is below and re-verified. The v1.0.0 draft built from `62891bb` must not be published.

**Outcome: released.** That draft was deleted. v1.0.0 was then tagged on the fixed commit `38d16c0`, built by the Release workflow including the new blank-window check, installed and tested on the development PC, and published on 27 October 2026. The public download links and SHA-256 checksums were verified. The clean-PC install from condition 1 below is still open.

**Verdict: CONDITIONAL GO.** No known security, privacy, or authentication blockers remain in the code, and the release candidate builds, runs standalone, and passes every automated check. It should not be published until a clean-PC install of the release-workflow installer and one live end-to-end run on the installed build are done (section H). Those two checks need a Windows machine without the development setup and your ChatGPT account, which this environment can't provide.

What this review established with evidence:

- Electron is configured to its security checklist: context isolation, sandbox, no Node in pages, a strict CSP, sender checks on all 17 IPC channels, and blocked navigation and pop-ups. The Electron version has no published advisories.
- ChatGPT access uses OpenAI's documented "Sign in with ChatGPT" plan usage for open-source apps (PKCE, loopback redirect, documented scopes and endpoints). The repository is public and MIT-licensed, as that program expects.
- Screenshots are taken only after the shortcut, kept in memory, never written to disk or logged, and sent only to the provider the user picked, only when the user sends.
- Capture latency from the tray improved 16% (median 711 → 599 ms). Memory stayed flat over 50 captures, and the packaged app is idle on CPU and network.
- 100 automated tests and lint pass, locally and in CI.

## B. Security findings

| ID   | Severity                   | Finding                                                                                                                                                                                                                                                                                                                                                                                                       | Evidence                                                                                                                                      | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | P1 (fixed earlier today)   | Lint failed and wasn't run in CI, so formatting drift went unnoticed. CRLF checkouts on Windows runners also fail the format check                                                                                                                                                                                                                                                                            | `npm run lint` exit 1; CRLF copies of 3 files failed `oxfmt --check`                                                                          | Fixed: files formatted, lint added to CI, `.gitattributes` forces LF. CI run 40448387353 passed                                                                                                                                                                                                                                                                                                                                                     |
| R-02 | P2 (fixed earlier today)   | Unexpected exceptions (for example a Node file error with a path) were shown raw, and 43 main-process messages were English-only                                                                                                                                                                                                                                                                              | Code review of `errorText`; extraction script found 43 untranslated sentences                                                                 | Fixed: only listed messages are shown, others become a plain message; all 43 translated in 20 languages; regression test added. Verified in the built window                                                                                                                                                                                                                                                                                        |
| R-03 | P2 (open, approval needed) | 2 critical advisories in `tinypool`, used only by the dev formatter `oxfmt` 0.41                                                                                                                                                                                                                                                                                                                              | `npm audit`: GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr; not in the shipped app (`npm audit --omit=dev`: 0)                                     | Upgrade `oxfmt` to 0.74 (major version jump) when you approve                                                                                                                                                                                                                                                                                                                                                                                       |
| R-07 | P0 (fixed 27 Oct)          | The packaged and installed app showed a blank white window. The `GrantFileProtocolExtraPrivileges` fuse was turned off in an earlier audit; with it off, a page loaded from `file://` can't load its own script and stylesheet. Development runs use `http://localhost`, and every packaged check, in that audit and in this review, only waited for a window titled "Tracer" without looking at its contents | Your install of the v1.0.0 draft; reproduced with the local packaged `Tracer.exe`; the same build rendered with only that fuse turned back on | Fixed without weakening security: packaged windows now load from a custom `tracer://app` protocol served only from the app's renderer folder (`app-protocol.mjs`), and the fuse stays off. Verified: packaged window renders, captures and the overlay work, settings persist across restarts. New tests for the protocol and navigation rules, and `scripts/verify-packaged-window.ps1` fails the release workflow if the packaged window is blank |
| R-04 | P3 (resolved by R-07)      | The window loaded from `file://` instead of a custom protocol (Electron checklist item 18)                                                                                                                                                                                                                                                                                                                    | —                                                                                                                                             | Now served from `tracer://app`                                                                                                                                                                                                                                                                                                                                                                                                                      |
| R-05 | P3 (open)                  | GitHub Actions are pinned to major tags (`@v5`), not commit SHAs                                                                                                                                                                                                                                                                                                                                              | Workflow files                                                                                                                                | Pin to SHAs to harden the release job, which can write releases                                                                                                                                                                                                                                                                                                                                                                                     |
| R-06 | P3 (open)                  | Unused dev dependency `@electron-forge/plugin-auto-unpack-natives`; unused `backend/` stub and two unused helpers                                                                                                                                                                                                                                                                                             | `forge.config.mjs` doesn't use the plugin; earlier audit                                                                                      | Remove in a cleanup change                                                                                                                                                                                                                                                                                                                                                                                                                          |

Checked with no finding: no `innerHTML`, `eval`, `new Function`, or `executeJavaScript` in app code; answers rendered with `textContent`; `shell.openExternal` only with allowlisted URLs; permission requests denied except clipboard write from the main window; `getDisplayMedia` refused; fuses (RunAsNode off, asar integrity, only load from asar); single-instance lock; no secrets in git history, tracked files, or `app.asar`; no advisories for Electron 44.9.3 or `jose` 6.2.13 (GitHub advisory database); the only dependency install script is the build-time `electron-winstaller`.

**Authentication** (inspected in code and in 25 ChatGPT tests against a fake OpenAI server): PKCE with S256, a random `state` compared in constant time, `nonce`, a loopback listener on `127.0.0.1` that accepts only `/auth/callback` with the exact Host header and closes after 5 minutes, ID token verified with `jose` against OpenAI's JWKS, plan usage only when the granted scope includes `chatgpt.tokens.use.direct`, refresh before expiry, one forced refresh and retry on a 401, revoke before clearing, terminal refresh errors mapped per OpenAI's guidance, account switching that changes nothing until the new identity verifies. Tokens never reach the window, logs, URLs, or error messages. Risk: OpenAI documents this program as a preview, so its terms or endpoints may change (section G).

**Prompt injection:** screenshot text and answers are treated as data. The model has no tools; Tracer never acts on an answer (no links, commands, or file access); answers are displayed as text. The worst case is a misleading answer.

## C. Performance results

| Metric                                 | Baseline               | Result                                             | Change                             |
| -------------------------------------- | ---------------------- | -------------------------------------------------- | ---------------------------------- |
| Shortcut → capture starts (from tray)  | 159 ms median          | 0 ms                                               | −159 ms (fix)                      |
| Shortcut → overlay ready (from tray)   | 711 ms median, p95 772 | 599 ms, p95 646                                    | −16% (fix)                         |
| Shortcut → overlay ready (window open) | 730 ms, p95 827        | 719 ms, p95 756                                    | unchanged; the wait is needed here |
| Windows screen capture, 3440×1440      | ~400–420 ms            | ~410–440 ms                                        | not app-controlled                 |
| Selection → preview                    | 109 ms                 | 76 ms                                              | variation, not a change            |
| Packaged warm start to window          | —                      | 305 ms median (5 runs)                             | —                                  |
| First launch after build               | —                      | 1,192 ms                                           | not a true cold start              |
| Idle memory (packaged)                 | —                      | 189 MB private, 280 MB working set                 | —                                  |
| Idle CPU / network (packaged)          | —                      | below 16 ms per 10 s / 0 connections               | —                                  |
| Memory over 50 captures                | —                      | flat at 382–421 MB after warm-up; main heap 6–7 MB | no leak seen                       |

Baseline and result runs measured 10 and 25 captures per scenario. Method details: [TEST_REPORT.md](../TEST_REPORT.md#release-candidate-measurements-26-oct-final-audit).

The largest remaining app-controlled cost is about 130 ms to load the overlay window and draw the frozen frame. Keeping a hidden overlay ready would save most of it at the cost of an extra renderer process (about 30–50 MB). Not done; it is a design trade-off for you.

**Not measured:** ChatGPT time to first text and total answer time (needs your account; the development build prints both), true cold start after reboot, sleep/resume and lock/unlock.

## D. Testing results

| Command                                             | Result                                                                                                                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test` (after R-07)                             | 102 passed, 0 failed. Added: `app-protocol.test.mjs` (files outside the renderer folder, other hosts and schemes refused) and updated navigation tests                            |
| `scripts/verify-packaged-window.ps1`                | Fails on the build from `62891bb` (0% of the page drawn); passes on the fixed build (55.8%)                                                                                       |
| `npm test` (before R-07)                            | 100 passed, 0 failed (1.0 s). Two tests added in this review: a lost connection before or during an answer, and a response over 2 MB. One source test checks the new capture wait |
| `npm run lint`                                      | Pass (oxlint and oxfmt)                                                                                                                                                           |
| GitHub Actions, Tests workflow, `746857e`           | Pass, including lint (run 40448387353)                                                                                                                                            |
| `npm audit --omit=dev` / `npm audit`                | 0 / 2 critical (dev-only, R-03)                                                                                                                                                   |
| `npm run package`, `npm run make`                   | Pass                                                                                                                                                                              |
| `npx electron scripts/verify-handoff-clipboard.mjs` | `ok: true`                                                                                                                                                                        |
| Window harness, fake main process                   | Language picker, translations, streaming, Arabic right-to-left, prompts toggle, plain technical errors, translated errors, tab keys: all as expected                              |
| Tray harness, shipped `main.cjs`                    | Close hides; shortcut stays; notice once; cancelled capture from tray stays hidden; second launch shows; Vietnamese tray menu; quit and session end exit                          |
| Performance harness, shipped `main.cjs`             | Section C; corrupted settings ignored; 10 rapid presses → 1 overlay; quit during capture exits cleanly                                                                            |
| Packaged app, fresh profile                         | Window shows; holds `Ctrl+Shift+Space`; 0 idle connections; real profile untouched                                                                                                |

**Mocked versus real:** the ChatGPT tests use a fake OpenAI server with real signed tokens and a real loopback listener. They prove Tracer follows OpenAI's documented contract, not that the live service behaves that way. Live runs by you on 26 October covered sign-in, plan usage, analysis, translation, follow-ups, auto-send, Apply & Save, and the tray.

**Gaps:** no automated end-to-end test of the installed app; Disconnect and account switching against the live service; multiple monitors and display scaling on real hardware; screen readers; offline recovery in the live app; sleep/resume.

## E. Packaging and installation

| Item                | Status                                                                                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tooling             | Electron Forge 8, Vite plugin, Squirrel.Windows maker, fuses                                                                                                                             |
| Release candidate   | `Tracer-Setup-win32-x64.exe` 147 MB (154,136,576 bytes), `tracer-1.0.0-full.nupkg`, `RELEASES`. Local SHA-256 `6079676c…a55a54cc3` (the release workflow builds and hashes its own copy) |
| Metadata            | Tracer, Tracy Tran, 1.0.0, © 2026 Tracy Tran, Tracer icon, MIT license and third-party notices in `resources/`                                                                           |
| Contents            | `app.asar` holds only the Vite build and `package.json`; no source maps, `.env`, keys, or `backend/`                                                                                     |
| Standalone          | Runs without Node.js (verified on this PC with a fresh profile)                                                                                                                          |
| Install / uninstall | **Not verified.** Installing writes to `%LocalAppData%` on C:, which this environment avoids, and Windows 10 Home has no Windows Sandbox. Needs a clean PC or VM                         |
| Upgrade             | Not verified. Squirrel keeps `%APPDATA%\Tracer` across versions by design                                                                                                                |
| Platforms           | Windows 10 x64 tested; Windows 11 expected but not tested; Arm64 not built                                                                                                               |
| Signing             | Not signed; SmartScreen will warn. Options and costs: [RELEASING.md](RELEASING.md#code-signing)                                                                                          |
| Updates             | None; recommendation in RELEASING.md                                                                                                                                                     |
| Defender / firewall | Not verified on a clean machine. The loopback sign-in listener uses `127.0.0.1` only, which normally triggers no firewall prompt                                                         |

Automatable: build, metadata, contents, checksums, standalone launch, smoke tests (all done, mostly in CI). Needs a physical or virtual clean machine: SmartScreen, install and uninstall, Start menu and Settings → Apps entries, Defender, upgrade, multi-monitor and DPI.

## F. Files changed

Committed earlier today (`5c441cb`, `e165cac`, `746857e`): translated and plain error messages, keyboard and screen-reader fixes, installer and app identity, release workflow, lint in CI, `.gitattributes`, LICENSE, notices, PRIVACY.md, docs/INSTALL.md, docs/RELEASING.md, release notes.

Uncommitted, fixing R-07: `src/app-protocol.mjs` (new), `src/main.js` (register and serve `tracer://app`, load the window and overlay from it), `src/security-policy.mjs` (navigation allows only the app origin), `test/app-protocol.test.mjs` (new), `test/security-policy.test.mjs`, `test/architecture.test.mjs`, `scripts/verify-packaged-window.ps1` (new), `.github/workflows/release.yml` (runs the window check), and the docs.

Committed after the review (`993ea86`, `62891bb`):

- `src/main.js`: the 150 ms pre-capture wait only applies when the window is on screen.
- `test/architecture.test.mjs`: checks that rule.
- `test/chatgpt.test.mjs`: lost-connection and oversized-response tests.
- `README.md`: keyboard shortcuts, contributing, test and performance results.
- `ARCHITECTURE.md`, `TEST_REPORT.md`, `RELEASE_CHECKLIST.md`, and this file.

## G. Remaining risks

1. Clean-machine install, uninstall, and upgrade are untested.
2. Disconnect's remote revocation and account switching are verified only against a fake server.
3. Multiple monitors and display scaling are verified only by unit tests of the math.
4. OpenAI's plan usage for open-source apps is a documented preview; changes on OpenAI's side could break sign-in or requests. Error handling covers the documented failure codes.
5. Not code-signed: SmartScreen warnings will deter some users, and antivirus tools are more suspicious of unsigned apps.
6. A crash while the credential file is being written could corrupt it (T-16/T-17); the user would have to sign in again.
7. The interface translations are AI-generated and unreviewed; screen-reader behavior is untested.
8. Dev-only `tinypool` advisories until `oxfmt` is upgraded.

## H. Release readiness checklist

| Check                                                                                                  | Result                                                                             |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Electron security settings and CSP                                                                     | PASS                                                                               |
| IPC sender validation (17 channels)                                                                    | PASS                                                                               |
| No unsafe DOM or code execution                                                                        | PASS                                                                               |
| Secrets scan (history, files, package)                                                                 | PASS                                                                               |
| Production dependency vulnerabilities                                                                  | PASS (0)                                                                           |
| All dependency vulnerabilities                                                                         | FAIL (2 critical, dev-only; R-03)                                                  |
| Authentication flow (mocked)                                                                           | PASS                                                                               |
| Authentication live: sign-in, plan usage, answers                                                      | PASS (your run, 26 Oct)                                                            |
| Disconnect, live                                                                                       | PASS (reported by you on the installed 1.0.0 build)                                |
| Account switching, live                                                                                | NOT VERIFIED                                                                       |
| Screenshot privacy (no disk, no logs, user-initiated send)                                             | PASS                                                                               |
| Privacy documentation matches behavior                                                                 | PASS                                                                               |
| Unit and integration tests                                                                             | PASS (100)                                                                         |
| Lint                                                                                                   | PASS                                                                               |
| CI on GitHub                                                                                           | PASS                                                                               |
| Production build and installer                                                                         | PASS                                                                               |
| Packaged app runs standalone                                                                           | PASS (window content checked after R-07)                                           |
| Packaged window renders (`verify-packaged-window.ps1`)                                                 | PASS                                                                               |
| Installed app from the release workflow                                                                | FAIL for the `62891bb` draft (R-07); PASS for the published build (development PC) |
| Capture performance measured                                                                           | PASS                                                                               |
| Memory stability over repeated captures                                                                | PASS (50 captures)                                                                 |
| Idle CPU and network                                                                                   | PASS                                                                               |
| Edge cases: rapid presses, quit during capture, corrupt settings, offline and dropped streams (mocked) | PASS                                                                               |
| Sleep/resume, lock/unlock, resolution change                                                           | NOT VERIFIED                                                                       |
| Multi-monitor and high-DPI on real hardware                                                            | NOT VERIFIED                                                                       |
| Clean-machine install, first run, uninstall                                                            | NOT VERIFIED                                                                       |
| Code signing                                                                                           | FAIL (unsigned; documented)                                                        |
| Keyboard navigation and focus                                                                          | PASS (harness and code)                                                            |
| Screen reader with Narrator or NVDA                                                                    | NOT VERIFIED                                                                       |
| Documentation: install, troubleshooting, privacy, license                                              | PASS                                                                               |

## I. Final engineering verdict

**CONDITIONAL GO.** There are no known P0 or P1 defects in the code. Security, privacy, and authentication were verified in code and tests, and performance and stability were measured on the shipped code. The unsigned installer and the dev-only advisories are documented and don't put users at risk. Publishing is conditional on:

1. Installing the installer built by the release workflow on a clean Windows 10 or 11 PC or VM, then completing first run, sign-in, a capture, an answer, the tray, and uninstall.
2. On that installed build, choosing Disconnect and confirming Tracer is gone from ChatGPT Settings → Security and login → Login connections.

Strongly recommended before or soon after release: a second-monitor and 150% scaling check, and a Narrator pass.
