import { contextBridge, ipcRenderer } from 'electron';
import { createListenerHub, isScreenshotDataUrl } from './security-policy.mjs';

const hotkeys = createListenerHub();
const captures = createListenerHub();
const commands = createListenerHub();

ipcRenderer.on('tracer-event', (_event, payload) => {
  if (!payload || typeof payload !== 'object') {
    hotkeys.emit();
    return;
  }
  if (payload.type === 'capture' && isScreenshotDataUrl(payload.image)) {
    captures.deliver({
      type: 'capture',
      mode: payload.mode === 'full' ? 'full' : 'region',
      image: payload.image,
    });
    return;
  }
  if (
    payload.type === 'capture-failed' ||
    payload.type === 'capture-cancelled'
  ) {
    captures.deliver({ type: payload.type });
    return;
  }
  if (payload.type === 'analyze' || payload.type === 'clear') {
    commands.deliver(payload.type);
    return;
  }
  hotkeys.emit();
});

contextBridge.exposeInMainWorld('tracer', {
  onHotkeyPressed: (callback) => hotkeys.add(callback),
  onCapture: (callback) => captures.add(callback),
  onCommand: (callback) => commands.add(callback),
  getSession: () => ipcRenderer.invoke('tracer:get-session'),
  signIn: (options) =>
    ipcRenderer.invoke('tracer:sign-in', {
      reconsent: options?.reconsent === true,
      fresh: options?.fresh === true,
    }),
  cancelSignIn: () => ipcRenderer.invoke('tracer:cancel-sign-in'),
  disconnect: () => ipcRenderer.invoke('tracer:disconnect'),
  ask: (payload) => ipcRenderer.invoke('tracer:ask', payload),
  cancelAsk: () => ipcRenderer.invoke('tracer:cancel-ask'),
  handoff: (payload) => ipcRenderer.invoke('tracer:handoff', payload),
  openUsage: () => ipcRenderer.invoke('tracer:open-usage'),
  reveal: () => ipcRenderer.invoke('tracer:reveal'),
  frozenFrame: () => ipcRenderer.invoke('tracer:frozen-frame'),
  chooseRegion: (payload) =>
    ipcRenderer.invoke('tracer:choose-region', payload),
  cancelRegion: () => ipcRenderer.invoke('tracer:cancel-region'),
  getHotkey: () => ipcRenderer.invoke('tracer:get-hotkey'),
  setHotkey: (accelerator) =>
    ipcRenderer.invoke('tracer:set-hotkey', accelerator),
  suspendHotkey: () => ipcRenderer.invoke('tracer:suspend-hotkey'),
  resumeHotkey: () => ipcRenderer.invoke('tracer:resume-hotkey'),
});
