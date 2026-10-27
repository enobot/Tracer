# Tracer release checklist (v1.0.0)

Status as of 25 October 2026: **ready after specific fixes**. Tick items as they are done. Details and evidence are in [SECURITY_AUDIT.md](SECURITY_AUDIT.md), [TEST_REPORT.md](TEST_REPORT.md), and [PRIVACY_REVIEW.md](PRIVACY_REVIEW.md).

## 1. Critical blockers

- [ ] Review and commit the audit changes (`git diff`). `npm test` should report 79 passing.
- [ ] Run `npx electron scripts/verify-handoff-clipboard.mjs` and confirm `"ok":true`.
- [x] **Live ChatGPT test with your own eligible account.** Done 26 Oct 2026: sign-in, plan usage, and two analyses with GPT-6.1-Sol, which read the image (T-07 cleared for this account).
- [ ] Repeat with the new window: auto-send on capture, one follow-up from the bottom box, Disconnect.
- [ ] Confirm Tracer disappears from ChatGPT Settings → Security and login → Login connections after Disconnect.
- [ ] With a second account, try "Use a different ChatGPT account". Tracer should leave the first account's Login connections and appear in the second's.
- [ ] **Paste test** on gemini.google.com and claude.ai. If one Ctrl+V doesn't deliver both the image and the prompt, change the handoff to copy the image first, then offer a "Copy prompt" button.
- [ ] Add a `LICENSE` file. `package.json` says MIT, but the repository has none. Standard MIT text with `Copyright (c) 2026 Tracy Tran`.
- [ ] Confirm the GitHub repository is public. OpenAI's self-serve plan usage is documented for open-source and locally hosted apps.

## 2. High-priority fixes

- [x] **T-05:** on a 401, refresh once and retry once; revoke before clearing; keep credentials on temporary failures. Done, 3 regression tests.
- [x] **T-06:** "Use a different ChatGPT account" with a fresh registration; the old grant is revoked only after the new identity verifies. Done, 3 regression tests.
- [ ] **T-07:** a model picker, or retry with the next listed model on `subscription_sharing_unsupported_capability`. Decide after the live test.
- [x] Plan and credit wording in the ChatGPT panel (done; a "Learn more" link to the Help Center is still optional). Suggested: "Analysis uses your ChatGPT plan's usage limits. If you allow credits for Tracer in ChatGPT settings, extra use can spend credits. [Learn more](https://help.openai.com/en/articles/20001542)".
- [ ] After a handoff, say "The screenshot is on your clipboard until you copy something else."

## 3. Recommended before or soon after release

- [x] Make sending obvious: capture sends right away by default, Analyze screenshot is a solid button, and follow-ups have their own box.
- [ ] Stream answer text to the window as it arrives.
- [ ] Serialize credential-record writes in `chatgpt-runtime.mjs` (T-16) and write the file atomically: temp file, then rename (T-17).
- [ ] Don't persist `tracer:draft` while "Remember prompts" is off, or say that it is kept.
- [ ] Higher-quality overlay preview (the 1600 px q60 frame is blurry on wide or 4K monitors).
- [x] Hotkey dialog: Apply & Save and Cancel, reachable with Tab and Enter.
- [ ] Remove `backend/` and its tests. Remove `releaseMediaStream` and `buildInspectResult`.
- [ ] Upgrade `oxfmt` to 0.74 in its own change to clear the dev-only `tinypool` advisory. Re-run the formatter.
- [ ] Plan the Electron 45 upgrade within the support window. Read its breaking changes first; the Electron 44 clipboard change is what broke the handoff.

## 4. Functional tests (manual)

- [ ] Ctrl+Shift+Space with another app focused, and with Tracer minimized
- [ ] Ten fast presses → one overlay
- [ ] Drag, right-click, and Escape on each monitor
- [ ] Two monitors with different scaling (for example 100% and 150%), one left of or above the primary
- [ ] Drag from one monitor and release on another → crop ends at the first monitor's edge
- [ ] 125% and 150% on a single monitor: selection matches the preview
- [ ] Custom shortcut: set, restart, still active. A taken shortcut shows an error. `Shift+A` is refused
- [ ] Second launch focuses the existing window
- [ ] Prompt library: save, edit, rename, favorite and unfavorite from every tab, delete, restart
- [ ] Remember prompts off, then Clear history
- [ ] Error paths: airplane mode, wait past 90 s, cancel mid-request
- [ ] Narrator reads the answer; keyboard-only use

## 5. Packaging

- [x] Asar contains only `.vite/build`, `.vite/renderer`, `package.json`
- [x] Fuses: RunAsNode off, NODE_OPTIONS off, inspect off, asar integrity on, only-load-from-asar on, file-protocol privileges off
- [x] Production CSP present; no DevTools; no dev-server URL; no source maps
- [x] No `.env`, keys, or `backend/` in the package
- [x] Version 1.0.0, company Tracy Tran, copyright corrected, FileDescription "Tracer"
- [ ] `productName` is `tracer` (lowercase). Changing it to `Tracer` renames the exe and shortcuts; decide before the first public release, since later changes affect upgrades
- [ ] App icon (`packagerConfig.icon`, `MakerSquirrel({ setupIcon })`). Currently the default Electron icon
- [ ] Portable build: `MakerZIP` is limited to `darwin`. Add `win32` if you want a no-install zip
- [ ] Uninstall leaves `%APPDATA%\tracer` (encrypted tokens and prompts). Document it, or handle `--squirrel-uninstall`
- [ ] No auto-update. Decide between manual downloads and `update-electron-app` / update.electronjs.org (needs signed builds to be useful)

## 6. Code signing

Both `tracer.exe` and `tracer-1.0.0 Setup.exe` are unsigned. SmartScreen will show "Windows protected your PC" on first run. That warning means "unknown publisher," not that the file is malware.

Options, per Microsoft Learn (updated 29 August 2026):

| Option | Cost | Notes |
| --- | --- | --- |
| Azure Artifact Signing (formerly Trusted Signing) | about $9.99/month | Individuals in the USA and Canada only. CI-friendly, no hardware token. Reputation still builds over time |
| SignPath Foundation | Free for qualifying open-source projects | Acceptance is at their discretion. The certificate is issued to the SignPath Foundation, not to you |
| OV certificate (DigiCert, Sectigo, Certum, etc.) | about $150–300/year | Key must be on a hardware token or cloud HSM since 2023. Builds reputation like Artifact Signing |
| EV certificate | $400+/year | No SmartScreen advantage since 2024 |
| Microsoft Store (MSIX) | Free developer registration | The Store re-signs; no SmartScreen warning. Needs MSIX packaging and Store review |
| Unsigned | Free | Publish SHA-256 checksums and build from a tagged commit so users can verify |

Nothing was purchased. Whatever you choose, keep the same signing identity across releases so reputation accumulates.

## 7. Documentation

- [x] SECURITY_AUDIT.md, TEST_REPORT.md, PRIVACY_REVIEW.md, ARCHITECTURE.md, RELEASE_CHECKLIST.md
- [x] README corrected (credential storage, model choice, handoff)
- [ ] User-facing `PRIVACY.md` (short version of PRIVACY_REVIEW §3–§9)
- [ ] "Not affiliated with OpenAI, Google, or Anthropic" in the README and the release notes
- [ ] SmartScreen instructions for users ("More info" → "Run anyway") until the app is signed
- [ ] Third-party notices: `jose` (MIT), `electron-squirrel-startup` (Apache-2.0), `debug` and `ms` (MIT) are bundled into `main.cjs`. Electron's `LICENSE` and `LICENSES.chromium.html` are already in the package

## 8. Clean-machine install test

Use Windows Sandbox or a fresh VM, not your development PC.

- [ ] Download the release asset from GitHub (not from `out/`)
- [ ] Verify the SHA-256 against the release notes
- [ ] Note the SmartScreen behavior
- [ ] Install. Check the Start menu entry and any desktop shortcut, and confirm no admin prompt
- [ ] First run: hotkey registers, window appears, no network until sign-in (Resource Monitor → Network)
- [ ] Sign in, analyze, Disconnect
- [ ] Uninstall from Settings → Apps. Check what remains in `%LOCALAPPDATA%\tracer` and `%APPDATA%\tracer`

## 9. GitHub release

- [ ] Clean `main`, all tests passing, tag `v1.0.0`
- [ ] Build from the tag with `npm ci` then `npm run make`
- [ ] Attach `tracer-1.0.0 Setup.exe` (and a zip, if added). Attach `RELEASES` and the `.nupkg` only if you plan Squirrel updates
- [ ] SHA-256 for every asset in the notes. The fixed local build from this audit (not for release) was `Setup.exe 752C88B8373B92C6860D840B2BA8F4092C5F6B0BA50E2D1CB2DC608F947B98B3`
- [ ] Release notes: what it does, which plans OpenAI says are eligible (link the Help Center article), that Gemini and Claude are copy-and-open, the privacy summary, unsigned status, known limits (one monitor tested; no macOS or Linux build)
- [ ] Consider GitHub artifact attestations for build provenance
