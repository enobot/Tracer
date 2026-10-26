import './index.css';
import { parseMarkdown } from './markdown-blocks.mjs';
import { createSelectionGesture } from './overlay-gestures.mjs';
import {
  clearPast,
  deletePrompt,
  emptyLibrary,
  listFavorites,
  normalizeLibrary,
  recordSubmission,
  savePrompt,
  setFavorite,
  setHistoryEnabled,
  updatePrompt,
} from './prompt-library.mjs';
import { LIMITS, validateInspectPayload } from './security-policy.mjs';

const MAX_HISTORY = 14;
const LIBRARY_KEY = 'tracer:library';
const DRAFT_KEY = 'tracer:draft';

const params = new URLSearchParams(location.search);
if (params.get('overlay') === '1') {
  initOverlay();
} else {
  initWorkspace();
}

function initOverlay() {
  document.body.classList.add('is-overlay');
  const workspace = document.getElementById('workspace');
  const root = document.getElementById('snip');
  const image = document.getElementById('snip-image');
  const shade = document.getElementById('snip-shade');
  const band = document.getElementById('snip-rect');
  if (workspace) workspace.hidden = true;
  if (root) root.hidden = false;
  const gesture = createSelectionGesture();

  const showRect = (rect) => {
    if (!band || !shade || !rect) return;
    band.hidden = false;
    band.style.left = `${rect.x}px`;
    band.style.top = `${rect.y}px`;
    band.style.width = `${rect.width}px`;
    band.style.height = `${rect.height}px`;
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    shade.style.clipPath = `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${rect.x}px ${rect.y}px, ${rect.x}px ${bottom}px, ${right}px ${bottom}px, ${right}px ${rect.y}px, ${rect.x}px ${rect.y}px)`;
  };

  const finish = (decision) => {
    if (!decision || decision.type === 'ignore' || decision.type === 'begin') {
      return;
    }
    if (decision.type === 'move') {
      showRect(decision.rect);
      return;
    }
    if (decision.type === 'region') {
      void window.tracer
        ?.chooseRegion?.({
          mode: 'region',
          ...decision.rect,
        })
        .catch(() => {});
      return;
    }
    if (decision.type === 'full') {
      void window.tracer?.chooseRegion?.({ mode: 'full' }).catch(() => {});
      return;
    }
    if (decision.type === 'cancel') {
      void window.tracer?.cancelRegion?.().catch(() => {});
    }
  };

  const onDown = (event) => {
    if (event.button === 2) event.preventDefault();
    const decision = gesture.pointerDown({
      button: event.button,
      x: event.clientX,
      y: event.clientY,
    });
    if (decision.type === 'begin') {
      showRect(decision.rect);
      if (root?.setPointerCapture && event.pointerId != null) {
        try {
          root.setPointerCapture(event.pointerId);
        } catch {
          // The drag still tracks while the pointer stays over this monitor.
        }
      }
      return;
    }
    finish(decision);
  };
  const onMove = (event) => {
    finish(
      gesture.pointerMove({
        button: event.button,
        x: event.clientX,
        y: event.clientY,
      }),
    );
  };
  const onUp = (event) => {
    finish(
      gesture.pointerUp({
        button: event.button,
        x: event.clientX,
        y: event.clientY,
      }),
    );
  };

  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    finish(gesture.cancel());
  });
  window.addEventListener('contextmenu', (event) => {
    if (gesture.contextMenu().prevent) event.preventDefault();
  });
  window.addEventListener('auxclick', (event) => event.preventDefault());
  window.addEventListener('dragstart', (event) => event.preventDefault());

  void window.tracer
    ?.frozenFrame?.()
    .then((result) => {
      if (result?.ok && typeof result.image === 'string' && image) {
        image.src = result.image;
      }
    })
    .catch(() => {
      // The selection rectangle still crops the snapshot held in the main process.
    });
}

function initWorkspace() {
  let latestScreenshot = null;
  let history = [];
  let session = {
    status: 'disconnected',
    sharing: false,
    email: null,
    name: null,
    modelName: null,
  };
  let busy = false;
  let actionGeneration = 0;
  let library = loadLibrary();
  let libraryTab = 'past';
  let editingId = '';
  let hotkeyAccelerator = 'Ctrl+Shift+Space';

  const promptInput = document.getElementById('tracer-prompt');
  const resultDisplay = document.getElementById('analysis-result');
  const preview = document.getElementById('shot-preview');
  const dismissPreview = document.getElementById('dismiss-preview');
  const statusLine = document.getElementById('provider-status');
  const noteLine = document.getElementById('provider-note');
  const signInButton = document.getElementById('chatgpt-sign-in');
  const disconnectButton = document.getElementById('chatgpt-disconnect');
  const usageButton = document.getElementById('manage-usage');
  const chip = document.getElementById('provider-chip');
  const panel = document.getElementById('provider-panel');
  const saveButton = document.getElementById('save-prompt');
  const hotkeyButton = document.getElementById('set-hotkey');
  const saveNote = document.getElementById('save-note');
  const analyzeCommand = document.getElementById('analyze-command');
  const cancelButton = document.getElementById('cancel-button');
  const hint = document.getElementById('capture-hint');
  const hotkeyDialog = document.getElementById('hotkey-dialog');
  const hotkeyCurrent = document.getElementById('hotkey-current');
  const hotkeyCapture = document.getElementById('hotkey-capture');
  const hotkeyError = document.getElementById('hotkey-error');

  function bridgeReady() {
    return Boolean(window.tracer?.ask && window.tracer?.handoff);
  }

  function errorText(error) {
    const raw = typeof error?.message === 'string' ? error.message : '';
    const cleaned = raw.replace(
      /^Error invoking remote method '[^']+': Error: /,
      '',
    );
    if (!cleaned || cleaned === 'Unauthorized IPC sender') {
      return 'Tracer could not complete that request.';
    }
    return cleaned.slice(0, 300);
  }

  function setStatus(message) {
    if (!resultDisplay) return;
    resultDisplay.textContent = message;
  }

  function appendInline(parent, segments) {
    for (const segment of segments) {
      if (segment.type === 'code') {
        const code = document.createElement('code');
        code.textContent = segment.text;
        parent.append(code);
      } else if (segment.type === 'strong') {
        const strong = document.createElement('strong');
        strong.textContent = segment.text;
        parent.append(strong);
      } else {
        parent.append(document.createTextNode(segment.text));
      }
    }
  }

  function renderAnswer(text, modelName) {
    if (!resultDisplay) return;
    resultDisplay.replaceChildren();
    if (modelName) {
      const heading = document.createElement('p');
      heading.textContent = `Using ${modelName}. This used your ChatGPT plan. Follow-up questions send the screenshot again.`;
      resultDisplay.append(heading);
    }
    for (const block of parseMarkdown(text)) {
      if (block.type === 'code') {
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'text-command';
        copy.textContent = 'Copy';
        copy.addEventListener('click', () => {
          navigator.clipboard.writeText(block.text).then(
            () => {
              copy.textContent = 'Copied';
            },
            () => {
              copy.textContent = 'Copy failed';
            },
          );
        });
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = block.text;
        pre.append(code);
        resultDisplay.append(copy, pre);
      } else if (block.type === 'list') {
        const list = document.createElement('ul');
        for (const item of block.items) {
          const line = document.createElement('li');
          appendInline(line, item);
          list.append(line);
        }
        resultDisplay.append(list);
      } else {
        const paragraph = document.createElement('p');
        appendInline(paragraph, block.segments);
        resultDisplay.append(paragraph);
      }
    }
  }

  function selectedProvider() {
    const selected = document.querySelector('input[name="provider"]:checked');
    if (selected?.value === 'gemini' || selected?.value === 'claude') {
      return selected.value;
    }
    return 'chatgpt';
  }

  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Preferences still work for this session.
    }
  }

  function loadLibrary() {
    try {
      const parsed = JSON.parse(readStorage(LIBRARY_KEY) || 'null');
      return normalizeLibrary(parsed || emptyLibrary());
    } catch {
      return emptyLibrary();
    }
  }

  function persistLibrary() {
    writeStorage(LIBRARY_KEY, JSON.stringify(library));
  }

  function currentPrompt() {
    return promptInput?.value.trim() ?? '';
  }

  function showSaveNote(message) {
    if (!saveNote) return;
    saveNote.textContent = message;
    setTimeout(() => {
      if (saveNote.textContent === message) saveNote.textContent = '';
    }, 2000);
  }

  function validationMessage(error) {
    if (error === 'Invalid prompt') {
      return 'Enter a prompt of 2000 characters or fewer.';
    }
    if (error === 'Invalid screenshot') {
      return 'The screenshot could not be used. Capture the screen again.';
    }
    return 'The request could not be processed.';
  }

  function setBusy(value) {
    busy = value;
    if (signInButton) signInButton.disabled = value;
    if (analyzeCommand) analyzeCommand.disabled = value;
    if (cancelButton) cancelButton.hidden = !value;
  }

  function renderConnection() {
    const provider = selectedProvider();
    const handoff = provider !== 'chatgpt';
    let chipText = 'ChatGPT';
    if (handoff) chipText = provider === 'gemini' ? 'Gemini' : 'Claude';
    else if (session.status === 'connected' && session.sharing) {
      chipText = 'ChatGPT connected';
    } else if (session.status === 'connected') chipText = 'ChatGPT signed in';
    if (chip) chip.textContent = chipText;
    if (statusLine) {
      if (handoff) statusLine.textContent = 'Open in browser';
      else if (session.status === 'connected')
        statusLine.textContent = 'Connected';
      else statusLine.textContent = 'Connection available';
    }
    if (noteLine) {
      if (provider === 'gemini') {
        noteLine.textContent =
          'Tracer does not connect to a Gemini subscription. Submitting copies the screenshot and prompt so you can paste them into the official site.';
      } else if (provider === 'claude') {
        noteLine.textContent =
          'Tracer does not connect to a Claude subscription. Submitting copies the screenshot and prompt so you can paste them into the official site.';
      } else if (session.status === 'connecting') {
        noteLine.textContent = 'Opening the browser to sign in with ChatGPT.';
      } else if (session.status === 'reauth_required') {
        noteLine.textContent =
          'The saved ChatGPT connection expired. Continue with ChatGPT to sign in again.';
      } else if (session.status === 'connected' && session.sharing) {
        const who = session.email || session.name || 'your ChatGPT account';
        noteLine.textContent = `Signed in as ${who}. Analysis uses that account's Plus or Pro plan allowance, not a separate API bill.`;
      } else if (session.status === 'connected') {
        noteLine.textContent =
          'You are signed in, but ChatGPT plan usage is not enabled. Allow plan usage before analyzing.';
      } else {
        noteLine.textContent =
          'Continue with ChatGPT uses your own ChatGPT account. Analysis inside Tracer needs a Plus or Pro plan and permission to use that plan.';
      }
    }
    if (signInButton) {
      signInButton.hidden =
        handoff || (session.status === 'connected' && session.sharing);
      signInButton.textContent =
        session.status === 'connected'
          ? 'Allow ChatGPT plan usage'
          : 'Continue with ChatGPT';
    }
    if (disconnectButton) {
      disconnectButton.hidden = handoff || session.status !== 'connected';
    }
    if (usageButton) {
      usageButton.hidden = handoff || session.status !== 'connected';
    }
    if (analyzeCommand) {
      analyzeCommand.textContent = handoff
        ? 'Open in browser'
        : 'Analyze screenshot';
    }
  }

  function updateHint() {
    if (!hint) return;
    hint.textContent = `Press ${hotkeyAccelerator}, drag to select an area, or right-click a monitor to capture it. Escape cancels. Nothing is sent until you submit it.`;
  }

  function clearPreview() {
    latestScreenshot = null;
    history = [];
    if (preview) {
      preview.removeAttribute('src');
      preview.hidden = true;
    }
    if (dismissPreview) dismissPreview.hidden = true;
  }

  function showPreview(image, mode) {
    latestScreenshot = image;
    history = [];
    if (preview) {
      preview.src = image;
      preview.hidden = false;
    }
    if (dismissPreview) dismissPreview.hidden = false;
    setStatus(
      mode === 'full'
        ? 'Captured this monitor. Nothing has been sent.'
        : 'Captured the selected area. Nothing has been sent.',
    );
  }

  async function refreshSession() {
    if (!window.tracer?.getSession) return;
    try {
      session = await window.tracer.getSession();
    } catch {
      session = {
        status: 'disconnected',
        sharing: false,
        email: null,
        name: null,
        modelName: null,
      };
    }
    renderConnection();
  }

  function rememberPrompt(prompt) {
    library = recordSubmission(
      library,
      prompt,
      new Date().toISOString(),
      createId(),
    );
    persistLibrary();
    renderLibrary();
  }

  async function runAction() {
    if (busy || hotkeyDialog?.open) return;
    const generation = ++actionGeneration;
    setBusy(true);
    try {
      if (!latestScreenshot) {
        setStatus('Please capture a screenshot first.');
        return;
      }
      const prompt = currentPrompt();
      if (!prompt) {
        setStatus('Please enter a prompt.');
        return;
      }
      const validation = validateInspectPayload({
        screenshot: latestScreenshot,
        prompt,
      });
      if (!validation.ok) {
        setStatus(validationMessage(validation.error));
        return;
      }
      if (!bridgeReady()) {
        setStatus('Tracer desktop bridge is unavailable.');
        return;
      }
      const provider = selectedProvider();
      if (provider === 'chatgpt') {
        setStatus('Sending the screenshot to ChatGPT.');
        const result = await window.tracer.ask({
          screenshot: latestScreenshot,
          prompt,
          history,
        });
        history.push(
          { role: 'user', text: prompt },
          { role: 'assistant', text: result.text },
        );
        while (history.length > MAX_HISTORY) history.splice(0, 2);
        rememberPrompt(prompt);
        renderAnswer(result.text, result.modelName);
      } else {
        setStatus('Copying the screenshot and opening the official site.');
        const result = await window.tracer.handoff({
          provider,
          screenshot: latestScreenshot,
          prompt,
        });
        rememberPrompt(prompt);
        setStatus(result.message);
      }
    } catch (error) {
      if (generation !== actionGeneration) return;
      const message = errorText(error);
      setStatus(
        message === 'The request was cancelled.' ? 'Canceled.' : message,
      );
    } finally {
      if (generation === actionGeneration) setBusy(false);
    }
  }

  function renderLibrary() {
    const tools = document.getElementById('library-tools');
    const list = document.getElementById('library-list');
    if (!tools || !list) return;
    tools.replaceChildren();
    list.replaceChildren();
    for (const tab of ['past', 'favorites', 'saved']) {
      const button = document.getElementById(
        tab === 'past'
          ? 'tab-past'
          : tab === 'favorites'
            ? 'tab-favorites'
            : 'tab-saved',
      );
      if (button)
        button.setAttribute('aria-selected', String(tab === libraryTab));
    }
    if (libraryTab === 'past') {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = library.historyEnabled;
      checkbox.addEventListener('change', () => {
        library = setHistoryEnabled(library, checkbox.checked);
        persistLibrary();
      });
      label.append(checkbox, document.createTextNode(' Remember prompts'));
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.textContent = 'Clear history';
      clear.addEventListener('click', () => {
        library = clearPast(library);
        persistLibrary();
        renderLibrary();
      });
      tools.append(label, clear);
    }
    const items =
      libraryTab === 'saved'
        ? library.saved
        : libraryTab === 'favorites'
          ? listFavorites(library)
          : library.past;
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent =
        libraryTab === 'saved'
          ? 'Saved prompts appear here.'
          : libraryTab === 'favorites'
            ? 'Star a prompt to keep it here.'
            : 'Prompts you submit appear here.';
      list.append(empty);
      return;
    }
    for (const item of items) list.append(renderCard(item));
  }

  function renderCard(item) {
    const card = document.createElement('article');
    card.className = 'prompt-card';
    if (
      editingId === item.id &&
      library.saved.some((entry) => entry.id === item.id)
    ) {
      const title = document.createElement('input');
      title.value = item.title;
      title.maxLength = 80;
      const text = document.createElement('textarea');
      text.value = item.text;
      text.maxLength = 2000;
      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = 'Save';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      save.addEventListener('click', () => {
        const result = updatePrompt(
          library,
          item.id,
          { title: title.value, text: text.value },
          new Date().toISOString(),
        );
        if (result.status === 'saved') {
          library = result.state;
          editingId = '';
          persistLibrary();
          renderLibrary();
        } else {
          showSaveNote(
            result.status === 'duplicate'
              ? 'Already saved.'
              : 'Could not save.',
          );
        }
      });
      cancel.addEventListener('click', () => {
        editingId = '';
        renderLibrary();
      });
      card.append(title, text, save, cancel);
      return card;
    }
    const title = document.createElement('div');
    title.className = 'prompt-title';
    title.textContent = item.title || 'Prompt';
    const body = document.createElement('button');
    body.type = 'button';
    body.textContent = item.text.slice(0, 90);
    body.addEventListener('click', () => {
      if (!promptInput) return;
      promptInput.value = item.text;
      writeStorage(DRAFT_KEY, promptInput.value.slice(0, LIMITS.promptChars));
      promptInput.focus();
    });
    const meta = document.createElement('div');
    meta.className = 'prompt-meta';
    const stamp = item.updatedAt || item.usedAt;
    meta.textContent = stamp ? new Date(stamp).toLocaleString() : '';
    const menu = document.createElement('div');
    menu.className = 'card-menu';
    const star = document.createElement('button');
    star.type = 'button';
    star.textContent = item.favorite ? 'Unfavorite' : 'Favorite';
    star.addEventListener('click', () => {
      library = setFavorite(library, item.id, !item.favorite);
      persistLibrary();
      renderLibrary();
    });
    menu.append(star);
    if (library.saved.some((entry) => entry.id === item.id)) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => {
        editingId = item.id;
        libraryTab = 'saved';
        renderLibrary();
      });
      menu.append(edit);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => {
      library = deletePrompt(library, item.id);
      persistLibrary();
      renderLibrary();
    });
    menu.append(remove);
    card.append(title, body, meta, menu);
    return card;
  }

  function acceleratorFromEvent(event) {
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return '';
    const modifiers = [];
    if (event.ctrlKey || event.metaKey) modifiers.push('Ctrl');
    if (event.altKey) modifiers.push('Alt');
    if (event.shiftKey) modifiers.push('Shift');
    if (!modifiers.length || !event.code) return null;
    let key = '';
    if (event.code === 'Space') key = 'Space';
    else if (event.code.startsWith('Key')) key = event.code.slice(3);
    else if (event.code.startsWith('Digit')) key = event.code.slice(5);
    else if (/^F(?:[1-9]|1\d|2[0-4])$/.test(event.code)) key = event.code;
    else return null;
    return [...modifiers, key].join('+');
  }

  async function openHotkeyDialog() {
    if (!hotkeyDialog) return;
    if (hotkeyCurrent)
      hotkeyCurrent.textContent = `Current shortcut: ${hotkeyAccelerator}`;
    if (hotkeyCapture) {
      hotkeyCapture.textContent =
        'Press a shortcut with at least one modifier.';
    }
    if (hotkeyError) hotkeyError.textContent = '';
    await window.tracer?.suspendHotkey?.();
    hotkeyDialog.showModal();
  }

  const savedDraft = readStorage(DRAFT_KEY) ?? readStorage('tracer:prompt');
  if (promptInput && typeof savedDraft === 'string') {
    promptInput.value = savedDraft.slice(0, LIMITS.promptChars);
  }
  const savedProvider = readStorage('tracer:provider');
  if (
    savedProvider === 'chatgpt' ||
    savedProvider === 'gemini' ||
    savedProvider === 'claude'
  ) {
    const input = document.querySelector(
      `input[name="provider"][value="${savedProvider}"]`,
    );
    if (input) input.checked = true;
  }

  promptInput?.addEventListener('input', () => {
    writeStorage(DRAFT_KEY, promptInput.value.slice(0, LIMITS.promptChars));
  });
  promptInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void runAction();
    }
  });
  saveButton?.addEventListener('click', () => {
    const result = savePrompt(
      library,
      currentPrompt(),
      new Date().toISOString(),
      createId(),
    );
    if (result.status === 'saved') {
      library = result.state;
      persistLibrary();
      libraryTab = 'saved';
      renderLibrary();
      showSaveNote('Saved.');
      return;
    }
    showSaveNote(
      result.status === 'duplicate'
        ? 'Already saved.'
        : 'Enter a prompt before saving.',
    );
  });
  hotkeyButton?.addEventListener('click', () => {
    void openHotkeyDialog();
  });
  hotkeyDialog?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    const accelerator = acceleratorFromEvent(event);
    if (!accelerator) return;
    if (hotkeyCapture) hotkeyCapture.textContent = accelerator;
    void window.tracer?.setHotkey?.(accelerator).then((result) => {
      if (!result?.ok) {
        if (hotkeyError) {
          hotkeyError.textContent =
            result?.error || 'That shortcut could not be registered.';
        }
        return;
      }
      hotkeyAccelerator = result.accelerator;
      updateHint();
      hotkeyDialog.close();
      showSaveNote(`Hotkey set to ${hotkeyAccelerator}.`);
    });
  });
  hotkeyDialog?.addEventListener('close', () => {
    void window.tracer?.resumeHotkey?.().then((result) => {
      if (result?.accelerator) {
        hotkeyAccelerator = result.accelerator;
        updateHint();
      }
    });
  });
  chip?.addEventListener('click', () => {
    if (!panel || !chip) return;
    panel.hidden = !panel.hidden;
    chip.setAttribute('aria-expanded', String(!panel.hidden));
  });
  for (const input of document.querySelectorAll('input[name="provider"]')) {
    input.addEventListener('change', () => {
      writeStorage('tracer:provider', selectedProvider());
      renderConnection();
    });
  }
  analyzeCommand?.addEventListener('click', () => {
    void runAction();
  });
  cancelButton?.addEventListener('click', () => {
    void window.tracer?.cancelAsk?.();
    void window.tracer?.cancelSignIn?.();
  });
  dismissPreview?.addEventListener('click', () => {
    actionGeneration += 1;
    void window.tracer?.cancelAsk?.();
    clearPreview();
    setStatus('Screenshot and conversation cleared. Nothing was kept.');
    setBusy(false);
  });
  signInButton?.addEventListener('click', async () => {
    if (!window.tracer?.signIn) {
      setStatus('Tracer desktop bridge is unavailable.');
      return;
    }
    const reconsent = session.status === 'connected' && !session.sharing;
    setBusy(true);
    session = { ...session, status: 'connecting' };
    renderConnection();
    setStatus('Opening the browser to sign in with ChatGPT.');
    try {
      session = await window.tracer.signIn(reconsent);
      renderConnection();
      setStatus(
        session.sharing
          ? 'ChatGPT is connected. Capture a screenshot, then submit it.'
          : 'Signed in. Allow ChatGPT plan usage before analyzing.',
      );
    } catch (error) {
      await refreshSession();
      const message = errorText(error);
      setStatus(
        message === 'Sign-in was cancelled.' ? 'Sign-in canceled.' : message,
      );
    } finally {
      setBusy(false);
    }
  });
  disconnectButton?.addEventListener('click', async () => {
    if (!window.tracer?.disconnect) return;
    setBusy(true);
    try {
      session = await window.tracer.disconnect();
      renderConnection();
      setStatus('Disconnected from ChatGPT on this computer.');
    } catch (error) {
      await refreshSession();
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  });
  usageButton?.addEventListener('click', async () => {
    try {
      await window.tracer?.openUsage?.();
    } catch (error) {
      setStatus(errorText(error));
    }
  });
  for (const tab of [
    ['tab-past', 'past'],
    ['tab-favorites', 'favorites'],
    ['tab-saved', 'saved'],
  ]) {
    document.getElementById(tab[0])?.addEventListener('click', () => {
      libraryTab = tab[1];
      renderLibrary();
    });
  }
  window.tracer?.onCapture?.((event) => {
    if (event?.type === 'capture' && typeof event.image === 'string') {
      showPreview(event.image, event.mode);
      return;
    }
    if (event?.type === 'capture-cancelled') {
      setStatus(
        latestScreenshot
          ? 'Selection canceled. The previous screenshot was kept.'
          : 'Selection canceled.',
      );
      return;
    }
    if (event?.type === 'capture-failed') {
      setStatus(
        'Screen capture failed. Try the shortcut again. If Windows blocked screen access, allow it for Tracer and retry.',
      );
    }
  });
  window.tracer?.onCommand?.((command) => {
    if (command === 'analyze') void runAction();
    if (command === 'clear') {
      actionGeneration += 1;
      void window.tracer?.cancelAsk?.();
      clearPreview();
      setStatus('Screenshot and conversation cleared. Nothing was kept.');
      setBusy(false);
    }
  });

  renderConnection();
  renderLibrary();
  updateHint();
  void refreshSession();
  void window.tracer?.getHotkey?.().then((result) => {
    if (result?.accelerator) {
      hotkeyAccelerator = result.accelerator;
      updateHint();
    }
  });
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
