# Tracer

Tracer is a desktop AI assistant designed to let me interact with an AI using a single global hotkey and a saved prompt.

The goal is to make screen-based tasks quick and accessible:

**Press the hotkey → capture the current screen or window → send the screenshot with the saved prompt to the AI → display the response.**

---

## Current Status

🚧 **In development**

The initial Electron + Vite project is set up and connected to GitHub. The first global hotkey is working successfully, including when another application is focused.

### Completed

- [x] Electron Forge + Vite project created
- [x] JavaScript + Node.js environment configured
- [x] Git repository initialized
- [x] GitHub repository connected
- [x] Initial commit pushed to `main`
- [x] Electron desktop window launches successfully
- [x] Global `Ctrl + Shift + Space` hotkey registered
- [x] Hotkey tested while another application is focused
- [x] Hotkey registration and failure checks added

### Next

- [ ] Capture the user's screen/window
- [ ] Verify and display the captured image
- [ ] Send the screenshot + saved prompt to the OpenAI API
- [ ] Display the AI response
- [ ] Add saved/customizable prompt support
- [ ] Add optional text-to-speech
- [ ] Package Tracer as an installable desktop application

---

## How Tracer Will Work

```text
Global Hotkey
      ↓
Electron Main Process
      ↓
IPC / Preload Bridge
      ↓
Renderer
      ↓
Screen Capture
      ↓
Screenshot + Saved Prompt
      ↓
OpenAI API
      ↓
AI Response
      ↓
Tracer Overlay
```

The long-term goal is to keep the core interaction simple:

> **One hotkey + one saved prompt.**

The prompt will determine what Tracer does. Instead of creating separate hard-coded modes for translation, explanation, summarization, or question answering, the saved prompt will define the behavior.

---

## Tech Stack

| Technology | Purpose |
|---|---|
| **JavaScript** | Primary programming language |
| **Electron** | Desktop application framework and OS-level functionality |
| **Node.js + npm** | Runtime and package management |
| **Electron Forge** | Electron project scaffolding and development/build tooling |
| **Vite** | Renderer development server and bundler |
| **React** | Planned UI technology |
| **HTML + CSS** | Renderer structure and styling |
| **OpenAI API** | Planned AI service for screenshot + prompt processing |
| **Git + GitHub** | Version control and remote repository |
| **Visual Studio Code** | Development environment |

### Why These Tools?

**Electron**  
Electron was chosen because Tracer needs desktop functionality such as global hotkeys, application windows, screen access, and operating-system integration while still allowing development with JavaScript and web technologies.

**Vite**  
Vite provides a fast development workflow for the renderer. It is a development server and bundler, not the UI framework.

**React**  
React is planned for the UI because it is already familiar and will make Tracer's interface easier to organize into reusable components.

**Git + GitHub**  
Git + GitHub provide version control, checkpoints, and a remote copy of the project.

---

## Getting Started

### Requirements

- Windows
- Node.js
- npm
- Git
- Visual Studio Code

### Run Tracer

From the project directory:

```bash
npm start
```

Electron Forge should start the development application and open the Tracer window.

---

## Current Hotkey

### `Ctrl + Shift + Space`

This is currently a test shortcut.

When the shortcut is pressed, the Electron main-process terminal should print:

```text
Hotkey Detected
```

The shortcut is global, so it can be triggered while another application is focused.

### Hotkey Registration

Tracer currently uses Electron's `globalShortcut` API:

```javascript
const registered = globalShortcut.register('Ctrl+Shift+Space', () => {
  console.log('Hotkey Detected');
});

if (!registered) {
  console.log('registration failed');
}

console.log(globalShortcut.isRegistered('Ctrl+Shift+Space'));
```

- `globalShortcut.register()` returns a boolean indicating whether Electron successfully registered the shortcut.
- `globalShortcut.isRegistered()` checks whether the shortcut is currently registered.
- The callback runs when the shortcut is actually pressed.

---

## Electron Architecture

Tracer uses Electron's process model.

### Main Process

`src/main.js`

Responsible for application-level and desktop functionality, including:

- Creating the Electron window
- Managing the application lifecycle
- Registering the global hotkey
- Eventually handling screenshot and AI-related desktop operations

### Renderer Process

`src/renderer.js`

Responsible for the interface displayed inside the Electron window.

### Preload Script

`src/preload.js`

Acts as a controlled bridge between the renderer and privileged Electron functionality.

Tracer will use this layer when the renderer needs to communicate with the main process.

---

## Project Structure

```text
Tracer/
├── src/
│   ├── main.js
│   ├── preload.js
│   ├── renderer.js
│   └── index.css
├── index.html
├── package.json
├── package-lock.json
├── forge.config.mjs
├── vite.main.config.mjs
├── vite.preload.config.mjs
├── vite.renderer.config.mjs
└── README.md
```

---

## Development Workflow

1. Make a change.
2. Save with `Ctrl + S`.
3. Run/restart Tracer with `npm start`.
4. Test the feature.
5. Check `git status`.
6. Stage changes with `git add .`.
7. Commit the changes.
8. Push with `git push`.

### Useful Commands

```bash
npm start
git status
git add .
git commit -m "Describe the change"
git push
git pull
code .
```

---

## Roadmap

- [x] Electron app launches
- [x] Global hotkey works
- [ ] Capture the screen/window
- [ ] Verify/display the captured image
- [ ] Send screenshot + prompt to the AI
- [ ] Display the AI response
- [ ] Save/customize the prompt
- [ ] Add optional text-to-speech
- [ ] Allow a custom hotkey
- [ ] Package Tracer as an installable desktop app

---

## Performance Metrics

As development progresses, I plan to track:

- End-to-end latency
- Screenshot-capture latency
- AI request latency
- Request success rate
- Workflow-time reduction
- Text-to-speech startup latency

---

## References

- [Electron `globalShortcut` API](https://www.electronjs.org/docs/latest/api/global-shortcut)
- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron Forge](https://js.electronforge.io/)
- [React Documentation](https://react.dev/)
- [Vite Documentation](https://vite.dev/guide/)
- [Node.js Documentation](https://nodejs.org/docs/latest/api/)

---

## Repository

[GitHub — enobot/Tracer](https://github.com/enobot/Tracer)
