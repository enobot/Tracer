# Releasing Tracer

How to publish a version, and the decisions still open for signing, updates, and other platforms. The step-by-step readiness list is [RELEASE_CHECKLIST.md](../RELEASE_CHECKLIST.md).

## How a release is built

Tracer uses Electron Forge with the Vite plugin. `npm run make` builds:

| File                                                                       | What it is                                                                                                                                                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `out/make/squirrel.windows/x64/Tracer-Setup-win32-x64.exe`                 | The installer people download. Per-user Squirrel.Windows installer: no administrator rights, installs to `%LocalAppData%\tracer`, adds Start menu and desktop shortcuts, and opens Tracer |
| `out/make/squirrel.windows/x64/tracer-<version>-full.nupkg` and `RELEASES` | The package and index Squirrel uses for updates. Upload them with every release so automatic updates can be added later                                                                   |
| `out/Tracer-win32-x64/`                                                    | The unpacked app, for testing without installing                                                                                                                                          |

The packaged app contains only the Vite build (`main.cjs`, `preload.cjs`, the renderer files, and `package.json`). It needs no Node.js on the user's computer.

## Publishing a version

The workflow in [.github/workflows/release.yml](../.github/workflows/release.yml) builds the installer on a clean GitHub Windows machine and creates a **draft** release. Nothing is public until you publish the draft.

1. Make sure `main` is green on the Tests workflow.
2. Set the version: `npm version 1.0.1 --no-git-tag-version` (skip this for 1.0.0, which is already set).
3. Write the release notes in `docs/releases/v<version>.md`. The workflow refuses to run without them.
4. Commit and push those changes to `main`.
5. Tag the commit and push the tag:

   ```bash
   git tag v1.0.0
   ```

   ```bash
   git push origin v1.0.0
   ```

6. Wait for the Release workflow (Actions tab). It checks that the tag matches `package.json`, runs the tests and lint, builds the installer, writes `SHA256SUMS.txt`, and creates the draft release with all four files.
7. Download the installer from the draft and test it on a Windows PC (see "Before publishing" below).
8. On the draft release page, choose **Publish release**.

If the workflow fails, fix the problem on `main`, delete the tag (`git push origin :refs/tags/v1.0.0` and `git tag -d v1.0.0`), and tag again.

### Before publishing

On a Windows PC, ideally one that never had Tracer:

- the SmartScreen warning appears and **More info → Run anyway** installs Tracer;
- the language picker opens first; sign-in, a capture, an answer, and a follow-up work;
- closing the window leaves Tracer in the tray, the notice appears once, and **Quit Tracer** exits;
- Tracer appears in Settings → Apps with its icon, and uninstalling removes the shortcuts.

### Links for your portfolio

- Release page: `https://github.com/enobot/Tracer/releases/latest`
- Direct download of the newest installer: `https://github.com/enobot/Tracer/releases/latest/download/Tracer-Setup-win32-x64.exe`

The installer name has no version number, so these links keep working for every future release.

## Code signing

Tracer's installer and program are not signed. Windows SmartScreen shows "Windows protected your PC" until a file has a signature and a reputation. The warning means "unknown publisher," not "malware," but it will stop some people.

Options, per Microsoft Learn (updated 29 August 2026). Nothing has been purchased.

| Option                                                 | Cost                                     | Notes                                                                                                                                                                  |
| ------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Azure Artifact Signing (formerly Trusted Signing)      | about $9.99/month                        | Individuals in the USA and Canada only, after identity verification. Works from GitHub Actions without a hardware token. SmartScreen reputation still builds over time |
| SignPath Foundation                                    | Free for qualifying open-source projects | Acceptance is at their discretion. The certificate is issued to the SignPath Foundation, not to you                                                                    |
| OV certificate (DigiCert, Sectigo, Certum, and others) | about $150–300/year                      | The key must be on a hardware token or cloud HSM. Builds reputation like Artifact Signing                                                                              |
| EV certificate                                         | $400+/year                               | No SmartScreen advantage since 2024                                                                                                                                    |
| Microsoft Store (MSIX)                                 | Free developer registration              | The Store signs the package; no SmartScreen warning. Needs MSIX packaging and Store review                                                                             |
| Unsigned                                               | Free                                     | What Tracer does today. Publish SHA-256 checksums and build from a tagged commit, as the release workflow does                                                         |

**Recommendation.** Release 1.0.0 unsigned with the checksums and the SmartScreen instructions already in the release notes. Then apply to the SignPath Foundation (free, since Tracer is MIT-licensed and public). If you are not accepted, Azure Artifact Signing at about $120 a year is the simplest paid option for an individual in the US. Keep the same signing identity for every release so reputation accumulates.

Signing plugs into Forge through `packagerConfig.windowsSign` and the Squirrel maker's signing options. Add it to the release workflow, keeping credentials in GitHub Actions secrets, never in the repository.

## Automatic updates

Not built yet. Today people download each new version themselves; installing over an older version keeps their settings.

**What fits Tracer.** Electron's free service, update.electronjs.org, serves updates for Squirrel.Windows apps whose builds are on GitHub Releases in a public repository. It does not require code signing for Squirrel.Windows (it does for macOS). The `update-electron-app` package connects to it in a few lines of the main process. By default it checks at startup and every 10 minutes, downloads in the background, and asks to restart.

The release workflow already uploads what the service needs: the `-win32` installer name, the `.nupkg`, and `RELEASES`.

**Before turning it on:**

- It adds a dependency and regular network requests to update.electronjs.org, which sees your IP address and Tracer version. Add this to PRIVACY.md and the README, which today say there are no update checks.
- Updates are only as safe as your GitHub account and releases. Turn on two-factor authentication, protect `v*` tags, and keep releases created by the workflow.
- Signing first is strongly recommended. Unsigned updates are delivered over HTTPS from GitHub, but nothing proves to Windows that they came from you.
- Run the updater only when `app.isPackaged`, and handle its `error` event so a failed check never shows a technical message.

**Recommendation.** Add auto-update in a release after 1.0.0, once signing is decided, as an opt-out setting with a clear note.

## macOS and Linux

The code is mostly cross-platform (Electron, no native modules), and Forge already lists ZIP (macOS), deb, and rpm makers. Each platform still needs its own work and testing.

### macOS

- **Screen Recording permission.** macOS asks the user to allow screen recording before `desktopCapturer` returns real pixels. Tracer needs a first-run explanation and a check with `systemPreferences.getMediaAccessStatus('screen')`.
- **Signing and notarization are required** in practice: an Apple Developer Program membership ($99/year), Developer ID signing, and notarization. Otherwise Gatekeeper blocks the app.
- **Shortcut.** Show `Cmd+Shift+Space` instead of Ctrl, and check it doesn't clash with Spotlight or input-source shortcuts.
- **Menu bar icon.** The tray icon should be a black-and-white "template" image so it adapts to light and dark menu bars.
- **Credentials.** `safeStorage` uses the Keychain, which may prompt the user once.
- **Builds.** Separate Apple-silicon (arm64) and Intel (x64) builds, or a universal build. A DMG maker is friendlier than ZIP. Automatic updates through update.electronjs.org require signing.

### Linux

- **Wayland screen capture** goes through the desktop portal and PipeWire. The system shows its own picker, so Tracer's freeze-and-select overlay across all monitors may not work as it does on Windows. X11 sessions behave closer to Windows.
- **Global shortcuts** don't work the usual way under Wayland. Electron offers a portal-based option that needs testing on GNOME and KDE.
- **Tray icon** needs StatusNotifier/AppIndicator support (on GNOME, an extension).
- **Credentials.** `safeStorage` needs a secret service (GNOME Keyring or KWallet). Without one, Electron falls back to a weak `basic_text` mode. Before shipping on Linux, refuse sign-in when `safeStorage.getSelectedStorageBackend()` reports `basic_text`.
- **Packages.** deb and rpm makers are configured; AppImage or Flatpak would reach more distributions. update.electronjs.org does not serve Linux.

**Suggested order:** Windows 1.0 → macOS (largest remaining audience; needs the Apple membership) → Linux X11 → Linux Wayland.
