# Tracer release checklist

Status on 27 October 2026: **not yet released.** The first v1.0.0 draft (from `62891bb`) shows a blank window when installed and must not be published; fixed since (R-07 in the review). **Final review verdict: CONDITIONAL GO** ([docs/RELEASE_REVIEW.md](docs/RELEASE_REVIEW.md)). The packaging, security, error-message, accessibility, and documentation work for a Windows 1.0.0 release is done and tested locally. Tracer should not be called production-ready until the P0 items marked "you" are done on a clean Windows PC.

How to publish: [docs/RELEASING.md](docs/RELEASING.md). Evidence: [TEST_REPORT.md](TEST_REPORT.md), [SECURITY_AUDIT.md](SECURITY_AUDIT.md), [PRIVACY_REVIEW.md](PRIVACY_REVIEW.md).

## P0: before publishing 1.0.0

### Done and verified

- [x] Packaging: Electron Forge 8 with the Vite plugin, Squirrel.Windows maker, and security fuses (RunAsNode off, asar integrity, only load from asar).
- [x] Installer: `Tracer-Setup-win32-x64.exe`, per-user, no administrator rights, Tracer icon, product name "Tracer", publisher Tracy Tran, version 1.0.0. App ID set so the tray notice and taskbar pins belong to the installed app.
- [x] The packaged app runs on its own: no Node.js needed. Smoke test on 26 Oct: window opened, profile written only where told, no network connections while idle.
- [x] `npm test`: 102 passing. `npm run lint`: passing (it was failing on formatting; fixed, and now also run in CI). `.gitattributes` keeps CI checkouts at LF so the format check matches.
- [x] `npm audit --omit=dev`: 0 vulnerabilities in what ships. No secrets in the git history, tracked files, or the app archive.
- [x] IPC: every handler checks the sender; the new `tracer:set-language` accepts only listed codes. Screenshots stay in memory and are sent only when the user sends.
- [x] Error messages: the window shows only Tracer's own messages, now translated in all 20 languages (43 added). Anything else, such as a file or network exception, becomes "Tracer could not complete that request." A test fails if a new message isn't translated.
- [x] Accessibility: visible focus outline (already present); prompt-library tabs linked to their panel with arrow-key movement; screen readers get each answer once, not word by word; smallest text raised to 0.9rem.
- [x] Documents: `LICENSE` (MIT), `PRIVACY.md`, `THIRD_PARTY_NOTICES.md` (also shipped in the app), `docs/INSTALL.md` (install, first run, permissions, troubleshooting, supported systems, limitations), `docs/RELEASING.md`, and release notes `docs/releases/v1.0.0.md`.
- [x] Release workflow: tag `v1.0.0` → tests, lint, build on a clean GitHub Windows machine, SHA-256 checksums, **draft** release.

### Still to do

- [x] Release preparation committed and pushed (`5c441cb`, `e165cac`, `746857e`); Tests workflow with lint passes.
- [x] Final review: capture wait removed when starting from the tray (−16% to a ready overlay), lost-connection and oversized-response tests, release candidate rebuilt and smoke-tested.
- [ ] **You:** review and commit the final-review changes.
- [x] Repository is public and GitHub detects the MIT license.
- [ ] **You:** push the `v1.0.0` tag, download the installer from the draft release, and test it in Windows Sandbox or on a PC that never had Tracer: SmartScreen → Run anyway, language picker, sign-in, capture, answer, follow-up, tray notice, Quit Tracer, uninstall from Settings → Apps.
- [ ] **You:** publish the draft.

## P1: soon after (or before, if time allows)

- [ ] Disconnect removes Tracer from ChatGPT Settings → Security and login → Login connections (live check).
- [ ] "Use a different ChatGPT account" with a second account (live check).
- [ ] Paste into gemini.google.com and claude.ai. If one Ctrl+V doesn't deliver both the image and the question, copy the image first and add a "Copy prompt" button.
- [ ] After a handoff, say "The screenshot is on your clipboard until you copy something else."
- [ ] Two monitors with different scaling, and 125% / 150% on one monitor (`npx electron scripts/verify-region-capture.mjs`, then real drags).
- [ ] Narrator or NVDA reads status messages and the finished answer; keyboard-only use end to end.
- [ ] Native-speaker review of the 20 interface translations.
- [ ] Code signing: apply to the SignPath Foundation; otherwise decide on Azure Artifact Signing (about $9.99/month). See docs/RELEASING.md. Nothing is purchased without your decision.
- [ ] Upgrade `oxfmt` from 0.41 to 0.74 to clear 2 critical advisories in the dev-only `tinypool` dependency. It never ships to users, but it is a major-version jump, so it waits for your OK.
- [ ] T-07: retry with the next listed model when the first can't read images.
- [ ] T-16 / T-17: serialize credential-file writes and write atomically.

## P2: later releases

- [ ] Automatic updates through update.electronjs.org, after signing; disclose the update checks (docs/RELEASING.md).
- [ ] macOS build: Screen Recording permission, Apple signing and notarization, template tray icon.
- [ ] Linux build: Wayland capture and shortcuts, tray support, refuse `basic_text` credential storage.
- [ ] Electron 45 upgrade within the support window; read its breaking changes first.
- [ ] Don't keep `tracer:draft` while "Remember prompts" is off, or say that it is kept.
- [ ] Sharper overlay preview on wide and 4K monitors.
- [ ] Remove `backend/` and its tests, the unused `releaseMediaStream` and `buildInspectResult`, and the unused `@electron-forge/plugin-auto-unpack-natives`.
- [ ] Pin GitHub Actions to commit SHAs.
- [ ] Consider a custom protocol instead of `file://` for the window, and a pre-warmed overlay (about 130 ms faster captures, about 30–50 MB more memory).
- [ ] Optional uninstall cleanup of `%APPDATA%\Tracer`.
- [ ] GitHub artifact attestations for build provenance.

## Manual test list for each release

- [ ] Ctrl+Shift+Space with another app focused, with Tracer minimized, and with Tracer in the tray
- [ ] Ten fast presses → one overlay
- [ ] Drag, right-click, and Escape on each monitor
- [ ] Custom shortcut: set, restart, still active; a taken shortcut shows an error; `Shift+A` is refused
- [ ] Second launch shows the existing window
- [ ] Prompt library: save, edit, rename, favorite and unfavorite from every tab, delete, restart; Hide prompts survives a restart
- [ ] Language: first launch shows the picker; the choice survives a restart; Arabic mirrors the window; a language without a translation keeps English buttons and still answers in that language
- [ ] Close the window: notice once, shortcut still captures, tray icon reopens, Quit Tracer exits, Windows sign-out isn't blocked
- [ ] Error paths: airplane mode, a request past 90 s, cancel mid-request; each shows a plain message
- [ ] Remember prompts off, then Clear history
