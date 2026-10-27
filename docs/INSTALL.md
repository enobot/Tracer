# Installing and using Tracer

## Supported systems

| System                   | Status                                                              |
| ------------------------ | ------------------------------------------------------------------- |
| Windows 11, 64-bit (x64) | Supported                                                           |
| Windows 10, 64-bit (x64) | Supported (tested on Windows 10 Home 22H2)                          |
| Windows on Arm           | Not tested. The x64 installer may run under emulation               |
| macOS, Linux             | Not available yet. See [RELEASING.md](RELEASING.md#macos-and-linux) |

You also need a ChatGPT account whose plan allows use in other apps (OpenAI documents this for Plus and Pro plans) and an internet connection. Gemini and Claude only need a web browser.

## Install

1. Download `Tracer-Setup-win32-x64.exe` from the [latest release](https://github.com/enobot/Tracer/releases/latest).
2. Optional: check the download. In PowerShell, run `Get-FileHash .\Tracer-Setup-win32-x64.exe` and compare the result with `SHA256SUMS.txt` on the release page.
3. Open the file. Tracer is not code-signed yet, so Windows may show **Windows protected your PC**. This means Windows doesn't recognize the publisher, not that the file is harmful. Choose **More info**, then **Run anyway**.
4. Tracer installs for your Windows account only, without administrator rights, and opens when it is done. It adds Tracer to the Start menu and the desktop.

You don't need Node.js or any other software.

## First run

1. **Pick your language.** Tracer suggests your Windows language. Answers come back in the language you pick, and the buttons are translated for 21 languages (English plus 20). You can change it any time with the globe button at the top.
2. **Connect ChatGPT.** Click the account button at the top right and choose **Continue with ChatGPT**. Your browser opens OpenAI's sign-in page. Sign in there and allow Tracer to use your plan. Tracer never sees your password.
3. **Capture.** Press `Ctrl+Shift+Space`, then drag over the part of the screen you want to ask about. Right-click captures the whole monitor; Esc cancels.

### What Tracer can access

- **Your screen, only when you press the shortcut.** Windows does not ask for a separate screen-recording permission. Tracer takes one still picture when you press the shortcut and keeps it in memory.
- **The network, only to send what you ask.** The screenshot and question go to ChatGPT when you finish a selection (with "Send right after capture" on) or when you send. Turn that setting off to look at a screenshot before sending it.
- **Your clipboard, only for Gemini and Claude.** Tracer copies the screenshot and question so you can paste them.

Details: [PRIVACY.md](../PRIVACY.md).

## Everyday use

- **Closing the window keeps Tracer running** in the tray by the clock, so the shortcut still works. The icon may be under the **^** arrow; you can drag it onto the taskbar to keep it visible. Click it to open Tracer. To exit, right-click it and choose **Quit Tracer**.
- **Follow-up questions** go in the box at the bottom. Each one sends the screenshot again.
- **Hide prompts** at the top hides the prompt library.
- **Set Hotkey** changes the shortcut. Press the new keys, then **Apply & Save**.
- ChatGPT usage counts against your plan's limits. You can set a limit for Tracer in ChatGPT under Settings → Usage.

## Keyboard and accessibility

- Every button and field can be reached with **Tab**. A blue outline shows where the focus is.
- In the prompt library, **Left** and **Right** arrows move between Past Prompts, Favorites, and Saved Prompts.
- `Ctrl+Enter` analyzes the current screenshot. **Esc** closes dialogs and cancels a capture.
- To make everything larger or smaller, use **View → Zoom In** or **Zoom Out**; the menu shows the keyboard shortcuts. `Ctrl+0` resets the size.
- For screen readers, status messages are announced, and each answer is announced once it is complete rather than word by word. This has not yet been tested with Narrator or NVDA.

## Uninstall

1. Optional: in Tracer, choose **Disconnect** in the account menu so your ChatGPT grant is removed.
2. Quit Tracer from the tray icon.
3. Open Settings → Apps, find **Tracer**, and choose **Uninstall**.
4. To remove your prompts and settings too, delete `%APPDATA%\Tracer`.

## Troubleshooting

| Problem                                                                        | What to do                                                                                                        |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| "Windows protected your PC" when installing                                    | Choose **More info**, then **Run anyway**. Tracer is not code-signed yet                                          |
| The window disappeared                                                         | It is in the tray. Click the Tracer icon by the clock, or open Tracer from the Start menu                         |
| The shortcut does nothing                                                      | Another app may use `Ctrl+Shift+Space`. Open Tracer, choose **Set Hotkey**, and pick another combination          |
| "Tracer could not register the screenshot shortcut" at startup                 | Same as above: another app already uses the shortcut                                                              |
| The browser didn't open for sign-in                                            | Check that Windows has a default browser (Settings → Apps → Default apps), then try again                         |
| "ChatGPT plan usage is not enabled"                                            | Sign in again and allow Tracer to use your plan on OpenAI's page                                                  |
| "ChatGPT refused this request"                                                 | Your plan, workspace, or region may not allow use in other apps                                                   |
| Answers are in the wrong language                                              | Click the globe button and pick your language. You can also ask in your question, for example "answer in English" |
| An answer stopped partway                                                      | Send the question again. If it keeps happening, try a smaller selection                                           |
| The capture shows the wrong area on a second monitor or at 125% / 150% scaling | Please report it (see below). Multiple monitors and scaling are not fully tested yet                              |
| Tracer won't start                                                             | Make sure it isn't already running in the tray. If your antivirus quarantined it, restore it or reinstall         |
| Start fresh                                                                    | Quit Tracer, delete `%APPDATA%\Tracer`, and open Tracer again. You will need to sign in again                     |

To report a problem, open an issue at [github.com/enobot/Tracer/issues](https://github.com/enobot/Tracer/issues). Describe what you did and what happened. Don't attach screenshots that show private information.

## Known limitations

- Windows only, and not code-signed, so Windows shows a warning on first install.
- No automatic updates yet. Download new versions from the releases page; installing a new version keeps your settings.
- Tested on one monitor at 100% scaling.
- One ChatGPT account at a time; Tracer uses the first model your account offers.
- The 20 interface translations were AI-generated and have not been checked by native speakers.
- Tracer does not start with Windows.
- Uninstalling leaves `%APPDATA%\Tracer` and the ChatGPT grant in place until you remove them.
