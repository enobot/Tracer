import './index.css';
import {
  DEFAULT_PROMPT,
  hasInterface,
  isDefaultPrompt,
  isMessage,
  translator,
} from './i18n.mjs';
import {
  LANGUAGE_CODES,
  englishName,
  isLanguageCode,
  isRightToLeft,
  matchLanguage,
  nativeName,
} from './languages.mjs';
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
import {
  LIMITS,
  isValidAccelerator,
  validateInspectPayload,
} from './security-policy.mjs';

const MAX_HISTORY = 14;
const LIBRARY_KEY = 'tracer:library';
const DRAFT_KEY = 'tracer:draft';
const AUTO_SEND_KEY = 'tracer:auto-send';
const LANGUAGE_KEY = 'tracer:language';
const LIBRARY_HIDDEN_KEY = 'tracer:library-hidden';
const PROVIDER_NAMES = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  claude: 'Claude',
};

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

function storedLanguage() {
  const code = readStorage(LANGUAGE_KEY);
  return isLanguageCode(code) ? code : null;
}

// Interface direction follows the language only when its labels are
// translated; otherwise the English labels stay left to right.
function setDocumentLanguage(code) {
  document.documentElement.lang = code;
  document.documentElement.dir =
    hasInterface(code) && isRightToLeft(code) ? 'rtl' : 'ltr';
}

function translateStatic(t) {
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll('[data-i18n-label]')) {
    element.setAttribute('aria-label', t(element.dataset.i18nLabel));
  }
  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) {
    element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder));
  }
  for (const element of document.querySelectorAll('[data-i18n-alt]')) {
    element.setAttribute('alt', t(element.dataset.i18nAlt));
  }
}

const params = new URLSearchParams(location.search);
if (params.get('overlay') === '1') {
  initOverlay();
} else {
  initWorkspace();
}

function initOverlay() {
  document.body.classList.add('is-overlay');
  const language = storedLanguage() ?? 'en';
  setDocumentLanguage(language);
  translateStatic(translator(language));
  const workspace = document.getElementById('workspace');
  const root = document.getElementById('snip');
  const image = document.getElementById('snip-image');
  const shade = document.getElementById('snip-shade');
  const band = document.getElementById('snip-rect');
  if (workspace) workspace.hidden = true;
  if (root) root.hidden = false;
  const gesture = createSelectionGesture(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

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
  const signedOut = () => ({
    status: 'disconnected',
    sharing: false,
    email: null,
    name: null,
    modelName: null,
    savedAccount: false,
  });
  let language = storedLanguage() ?? matchLanguage(navigator.language);
  let t = translator(language);
  let latestScreenshot = null;
  // Questions and answers about the current screenshot, oldest first.
  let turns = [];
  // The question and the line under it (waiting text, then the answer as it
  // streams in) while a reply is on its way.
  let pendingNodes = [];
  let streamText = '';
  let streamFrame = 0;
  let modelName = null;
  let session = signedOut();
  let busy = false;
  let actionGeneration = 0;
  let pendingAction = 0;
  let library = loadLibrary();
  let libraryTab = 'past';
  let editingId = '';
  let hotkeyAccelerator = 'Ctrl+Shift+Space';
  let pendingHotkey = '';
  let pendingLanguage = language;
  let firstRunLanguage = false;
  let lastStatus = { message: '', values: undefined };

  const app = document.getElementById('workspace');
  const promptInput = document.getElementById('tracer-prompt');
  const autoSend = document.getElementById('auto-send');
  const statusDisplay = document.getElementById('tracer-status');
  const conversation = document.getElementById('conversation');
  const emptyState = document.getElementById('empty-state');
  const hint = document.getElementById('capture-hint');
  const sendNote = document.getElementById('send-note');
  const shot = document.getElementById('shot');
  const shotToggle = document.getElementById('shot-toggle');
  const preview = document.getElementById('shot-preview');
  const shotLabel = document.getElementById('shot-label');
  const analyzeCommand = document.getElementById('analyze-command');
  const dismissPreview = document.getElementById('dismiss-preview');
  const followupRow = document.getElementById('followup-row');
  const followupInput = document.getElementById('followup-input');
  const followupSend = document.getElementById('followup-send');
  const cancelButton = document.getElementById('cancel-button');
  const planNote = document.getElementById('plan-note');
  const planText = document.getElementById('plan-text');
  const planUsage = document.getElementById('plan-usage');
  const statusLine = document.getElementById('provider-status');
  const noteLine = document.getElementById('provider-note');
  const signInButton = document.getElementById('chatgpt-sign-in');
  const switchButton = document.getElementById('chatgpt-switch');
  const disconnectButton = document.getElementById('chatgpt-disconnect');
  const usageButton = document.getElementById('manage-usage');
  const chip = document.getElementById('provider-chip');
  const panel = document.getElementById('provider-panel');
  const languageButton = document.getElementById('language-button');
  const languageNameLabel = document.getElementById('language-name');
  const libraryToggle = document.getElementById('library-toggle');
  const saveButton = document.getElementById('save-prompt');
  const hotkeyButton = document.getElementById('set-hotkey');
  const saveNote = document.getElementById('save-note');
  const hotkeyDialog = document.getElementById('hotkey-dialog');
  const hotkeyCurrent = document.getElementById('hotkey-current');
  const hotkeyCapture = document.getElementById('hotkey-capture');
  const hotkeyError = document.getElementById('hotkey-error');
  const hotkeyApply = document.getElementById('hotkey-apply');
  const hotkeyCancel = document.getElementById('hotkey-cancel');
  const languageDialog = document.getElementById('language-dialog');
  const languageSearch = document.getElementById('language-search');
  const languageList = document.getElementById('language-list');
  const languageDetail = document.getElementById('language-detail');
  const languageCancel = document.getElementById('language-cancel');
  const languageContinue = document.getElementById('language-continue');

  function bridgeReady() {
    return Boolean(window.tracer?.ask && window.tracer?.handoff);
  }

  function errorText(error) {
    const raw = typeof error?.message === 'string' ? error.message : '';
    const cleaned = raw.replace(
      /^Error invoking remote method '[^']+': Error: /,
      '',
    );
    // Only Tracer's own messages are shown. File, network, or other technical
    // errors get a plain message; the details stay in the developer console.
    if (!isMessage(cleaned)) {
      if (cleaned) console.warn(cleaned);
      return t('Tracer could not complete that request.');
    }
    return t(cleaned);
  }

  // Status messages are kept in English with their values, so they can be
  // shown again in a newly chosen language.
  function setStatus(message, values) {
    lastStatus = { message, values };
    if (statusDisplay)
      statusDisplay.textContent = message ? t(message, values) : '';
  }

  function appendInline(parent, segments) {
    for (const segment of segments) {
      if (segment.type === 'code' || segment.type === 'strong') {
        const element = document.createElement(segment.type);
        element.textContent = segment.text;
        parent.append(element);
      } else if (segment.type === 'em') {
        const em = document.createElement('em');
        em.textContent = segment.text;
        parent.append(em);
      } else {
        parent.append(document.createTextNode(segment.text));
      }
    }
  }

  function appendLines(parent, lines) {
    lines.forEach((segments, index) => {
      if (index > 0) parent.append(document.createElement('br'));
      appendInline(parent, segments);
    });
  }

  function copyButton(getText, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'link';
    button.textContent = t(label);
    button.addEventListener('click', () => {
      navigator.clipboard.writeText(getText()).then(
        () => {
          button.textContent = t('Copied');
        },
        () => {
          button.textContent = t('Copy failed');
        },
      );
    });
    return button;
  }

  function renderBlock(block) {
    if (block.type === 'code') {
      const wrapper = document.createElement('div');
      wrapper.className = 'code-block';
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = block.text;
      pre.append(code);
      wrapper.append(
        copyButton(() => block.text, 'Copy code'),
        pre,
      );
      return wrapper;
    }
    if (block.type === 'heading') {
      const heading = document.createElement(
        `h${Math.min(block.level + 2, 6)}`,
      );
      appendInline(heading, block.segments);
      return heading;
    }
    if (block.type === 'rule') return document.createElement('hr');
    if (block.type === 'quote') {
      const quote = document.createElement('blockquote');
      appendLines(quote, block.lines);
      return quote;
    }
    if (block.type === 'list') {
      const list = document.createElement(block.ordered ? 'ol' : 'ul');
      if (block.ordered && block.start !== 1) list.start = block.start;
      for (const item of block.items) {
        const line = document.createElement('li');
        appendInline(line, item);
        list.append(line);
      }
      return list;
    }
    if (block.type === 'table') {
      const scroll = document.createElement('div');
      scroll.className = 'table-scroll';
      const table = document.createElement('table');
      const head = table.createTHead().insertRow();
      for (const cell of block.header) {
        const th = document.createElement('th');
        appendInline(th, cell);
        head.append(th);
      }
      const body = table.createTBody();
      for (const row of block.rows) {
        const line = body.insertRow();
        for (const cell of row) appendInline(line.insertCell(), cell);
      }
      scroll.append(table);
      return scroll;
    }
    const paragraph = document.createElement('p');
    appendLines(paragraph, block.lines);
    return paragraph;
  }

  function answerBody(text) {
    const body = document.createElement('div');
    body.className = 'answer-body';
    body.dir = 'auto';
    for (const block of parseMarkdown(text)) body.append(renderBlock(block));
    return body;
  }

  function questionNode(text) {
    const question = document.createElement('p');
    question.className = 'turn-question';
    question.dir = 'auto';
    const label = document.createElement('span');
    label.className = 'sr-only';
    label.textContent = `${t('You asked:')} `;
    question.append(label, document.createTextNode(text));
    return question;
  }

  function answerNode(text) {
    const answer = document.createElement('div');
    answer.className = 'turn-answer';
    const label = document.createElement('span');
    label.className = 'sr-only';
    label.textContent = `${t('ChatGPT answered:')} `;
    const body = answerBody(text);
    const actions = document.createElement('div');
    actions.className = 'answer-actions';
    actions.append(copyButton(() => body.innerText, 'Copy answer'));
    answer.append(label, body, actions);
    return answer;
  }

  function showPending(prompt) {
    const question = questionNode(prompt);
    const waiting = document.createElement('p');
    waiting.className = 'waiting';
    waiting.textContent = t('Waiting for ChatGPT…');
    conversation?.append(question, waiting);
    pendingNodes = [question, waiting];
    streamText = '';
    waiting.scrollIntoView({ block: 'nearest' });
  }

  // Shows the answer so far. Screen readers hear it once, when it is done.
  function renderStream() {
    streamFrame = 0;
    const [question, placeholder] = pendingNodes;
    if (!placeholder) return;
    let live = placeholder;
    if (!live.classList.contains('turn-answer')) {
      live = document.createElement('div');
      live.className = 'turn-answer';
      live.setAttribute('aria-busy', 'true');
      // Screen readers wait for the finished answer instead of every piece.
      conversation?.setAttribute('aria-busy', 'true');
      placeholder.replaceWith(live);
      pendingNodes = [question, live];
      question.scrollIntoView({ block: 'start' });
    }
    live.replaceChildren(answerBody(streamText));
  }

  // Replaces the waiting line or partial answer with the full answer, or
  // removes the unanswered question when the request failed.
  function settlePending(answerText) {
    if (streamFrame) cancelAnimationFrame(streamFrame);
    streamFrame = 0;
    const [question, placeholder] = pendingNodes;
    const streamed = placeholder?.classList.contains('turn-answer');
    pendingNodes = [];
    streamText = '';
    conversation?.removeAttribute('aria-busy');
    if (answerText === null) {
      question?.remove();
      placeholder?.remove();
      return;
    }
    const answer = answerNode(answerText);
    if (placeholder) placeholder.replaceWith(answer);
    else conversation?.append(answer);
    if (!streamed) question?.scrollIntoView({ block: 'start' });
  }

  function clearConversation() {
    if (streamFrame) cancelAnimationFrame(streamFrame);
    streamFrame = 0;
    conversation?.removeAttribute('aria-busy');
    turns = [];
    pendingNodes = [];
    streamText = '';
    conversation?.replaceChildren();
  }

  function selectedProvider() {
    const selected = document.querySelector('input[name="provider"]:checked');
    if (selected?.value === 'gemini' || selected?.value === 'claude') {
      return selected.value;
    }
    return 'chatgpt';
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

  function showSaveNote(message, values) {
    if (!saveNote) return;
    const text = t(message, values);
    saveNote.textContent = text;
    setTimeout(() => {
      if (saveNote.textContent === text) saveNote.textContent = '';
    }, 2500);
  }

  function validationMessage(error) {
    if (error === 'Invalid prompt') {
      return 'Enter a prompt of 2000 characters or fewer.';
    }
    if (error === 'Invalid screenshot') {
      return 'The screenshot could not be used. Capture the screen again.';
    }
    return 'Tracer could not complete that request.';
  }

  function setBusy(value) {
    busy = value;
    for (const button of [
      signInButton,
      switchButton,
      disconnectButton,
      analyzeCommand,
      followupSend,
    ]) {
      if (button) button.disabled = value;
    }
    if (cancelButton) cancelButton.hidden = !value;
  }

  // The screenshot or conversation changed, so a reply still on its way
  // belongs to the old picture. Stop it and ignore whatever arrives.
  function abandonAction() {
    actionGeneration += 1;
    void window.tracer?.cancelAsk?.();
    if (pendingAction) {
      pendingAction = 0;
      setBusy(false);
    }
  }

  function setPanel(open) {
    if (!panel || !chip) return;
    panel.hidden = !open;
    chip.setAttribute('aria-expanded', String(open));
  }

  function setLibraryHidden(hidden) {
    app?.classList.toggle('library-hidden', hidden);
    if (libraryToggle) {
      libraryToggle.textContent = t(hidden ? 'Show prompts' : 'Hide prompts');
      libraryToggle.setAttribute('aria-expanded', String(!hidden));
    }
  }

  function planReady() {
    return session.status === 'connected' && session.sharing;
  }

  // Returns why ChatGPT cannot be asked yet, or '' when it can.
  function signInNeeded() {
    if (selectedProvider() !== 'chatgpt' || planReady()) return '';
    return session.status === 'connected'
      ? 'Allow ChatGPT plan usage to ask about this screenshot.'
      : 'Sign in with ChatGPT to ask about this screenshot.';
  }

  function updateHint() {
    if (hint) {
      hint.textContent = t(
        'Press {hotkey}, then drag over what you want to ask about. Right-click captures the whole monitor, and Esc cancels.',
        { hotkey: hotkeyAccelerator },
      );
    }
    if (!sendNote) return;
    const provider = selectedProvider();
    if (!autoSend?.checked) {
      sendNote.textContent = t(
        'Nothing is sent until you choose Analyze screenshot.',
      );
    } else if (provider === 'chatgpt') {
      sendNote.textContent = t(
        'Tracer sends the capture to ChatGPT with your prompt as soon as you let go.',
      );
    } else {
      sendNote.textContent = t(
        'Tracer copies the capture and your prompt, then opens {provider}, as soon as you let go.',
        { provider: PROVIDER_NAMES[provider] },
      );
    }
  }

  function updateLayout() {
    const provider = selectedProvider();
    const handoff = provider !== 'chatgpt';
    const hasShot = Boolean(latestScreenshot);
    const asked = turns.length > 0 || pendingNodes.length > 0;
    if (emptyState) emptyState.hidden = hasShot;
    if (shot) shot.hidden = !hasShot;
    if (analyzeCommand) {
      analyzeCommand.textContent = handoff
        ? t('Open in {provider}', { provider: PROVIDER_NAMES[provider] })
        : t('Analyze screenshot');
      analyzeCommand.hidden = !handoff && asked;
    }
    if (followupRow) followupRow.hidden = handoff || !hasShot;
    if (followupInput) {
      followupInput.placeholder = t(
        turns.length
          ? 'Ask a follow-up about this screenshot'
          : 'Ask about this screenshot',
      );
    }
    if (planNote) planNote.hidden = handoff || !planReady();
    if (planText) {
      planText.textContent = modelName
        ? t(
            'Uses your ChatGPT plan with {model}. Follow-ups send the screenshot again.',
            { model: modelName },
          )
        : t('Uses your ChatGPT plan. Follow-ups send the screenshot again.');
    }
    if (shotToggle && shot) {
      shotToggle.title = t(
        shot.classList.contains('expanded') ? 'Show smaller' : 'Show full size',
      );
    }
    updateHint();
  }

  function renderConnection() {
    const provider = selectedProvider();
    const handoff = provider !== 'chatgpt';
    let chipText = 'ChatGPT';
    if (handoff) chipText = PROVIDER_NAMES[provider];
    else if (planReady())
      chipText = t('{provider} connected', { provider: 'ChatGPT' });
    else if (session.status === 'connected') {
      chipText = t('{provider} signed in', { provider: 'ChatGPT' });
    }
    if (chip) chip.textContent = chipText;
    if (statusLine) {
      if (handoff) statusLine.textContent = t('Open in browser');
      else if (session.status === 'connected')
        statusLine.textContent = t('Connected');
      else statusLine.textContent = t('Not connected');
    }
    if (noteLine) {
      if (handoff) {
        noteLine.textContent = t(
          'Tracer does not connect to a {provider} subscription. It copies the screenshot and prompt so you can paste them into the official site.',
          { provider: PROVIDER_NAMES[provider] },
        );
      } else if (session.status === 'connecting') {
        noteLine.textContent = t(
          'Opening the browser to sign in with ChatGPT.',
        );
      } else if (session.status === 'reauth_required') {
        noteLine.textContent = t(
          'The saved ChatGPT connection expired. Continue with ChatGPT to sign in again.',
        );
      } else if (planReady()) {
        const who = session.email || session.name || t('your ChatGPT account');
        noteLine.textContent = t(
          "Signed in as {who}. Analysis uses this account's ChatGPT plan limits. If you allow credits for Tracer in ChatGPT settings, extra use can spend credits.",
          { who },
        );
      } else if (session.status === 'connected') {
        noteLine.textContent = t(
          'You are signed in, but ChatGPT plan usage is not enabled. Allow plan usage before analyzing.',
        );
      } else {
        noteLine.textContent = t(
          'Continue with ChatGPT uses your own ChatGPT account. Analysis needs a ChatGPT plan that works in other apps, and your permission to use it.',
        );
      }
    }
    if (signInButton) {
      signInButton.hidden = handoff || planReady();
      signInButton.textContent = t(
        session.status === 'connected'
          ? 'Allow ChatGPT plan usage'
          : 'Continue with ChatGPT',
      );
    }
    if (switchButton) {
      switchButton.hidden =
        handoff || !session.savedAccount || session.status === 'connecting';
    }
    if (disconnectButton) {
      disconnectButton.hidden = handoff || session.status !== 'connected';
    }
    if (usageButton) {
      usageButton.hidden = handoff || session.status !== 'connected';
    }
    updateLayout();
  }

  // Applies a language to every label. `remember` keeps it for next time.
  function applyLanguage(code, { remember = false } = {}) {
    language = code;
    t = translator(code);
    setDocumentLanguage(code);
    translateStatic(t);
    if (languageNameLabel) languageNameLabel.textContent = nativeName(code);
    languageButton?.setAttribute(
      'aria-label',
      `${t('Language')}: ${nativeName(code)}`,
    );
    if (promptInput && isDefaultPrompt(promptInput.value)) {
      promptInput.value = t(DEFAULT_PROMPT);
      writeStorage(DRAFT_KEY, promptInput.value);
    }
    if (remember) writeStorage(LANGUAGE_KEY, code);
    void window.tracer?.setLanguage?.(code)?.catch(() => {});
    setLibraryHidden(app?.classList.contains('library-hidden') ?? false);
    renderConnection();
    renderLibrary();
    setStatus(lastStatus.message, lastStatus.values);
  }

  function searchable(text) {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  }

  function languageOption(code) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'language-option';
    option.dataset.code = code;
    option.lang = code;
    option.setAttribute('aria-pressed', String(code === pendingLanguage));
    const native = document.createElement('span');
    native.className = 'language-native';
    native.textContent = nativeName(code);
    option.append(native);
    const english = englishName(code);
    if (english !== nativeName(code)) {
      const label = document.createElement('span');
      label.className = 'language-english';
      label.lang = 'en';
      label.textContent = english;
      option.append(label);
    }
    option.addEventListener('click', () => chooseLanguage(code));
    option.addEventListener('dblclick', () => commitLanguage());
    return option;
  }

  function renderLanguageList() {
    if (!languageList) return;
    const query = searchable(languageSearch?.value.trim() ?? '');
    const matches = LANGUAGE_CODES.filter(
      (code) =>
        !query ||
        searchable(nativeName(code)).includes(query) ||
        searchable(englishName(code)).includes(query) ||
        code.toLowerCase() === query,
    ).sort((a, b) => englishName(a).localeCompare(englishName(b), 'en'));
    languageList.replaceChildren();
    for (const [title, codes] of [
      ['Full app translation', matches.filter((code) => hasInterface(code))],
      ['Answers only', matches.filter((code) => !hasInterface(code))],
    ]) {
      if (!codes.length) continue;
      const heading = document.createElement('p');
      heading.className = 'language-group';
      heading.textContent = t(title);
      const options = document.createElement('div');
      options.className = 'language-options';
      for (const code of codes) options.append(languageOption(code));
      languageList.append(heading, options);
    }
    if (languageDetail) {
      languageDetail.textContent = t(
        hasInterface(pendingLanguage)
          ? 'Buttons and answers use this language.'
          : 'Answers use this language. Buttons stay in English.',
      );
    }
  }

  // Previews a language while the picker is open.
  function chooseLanguage(code) {
    pendingLanguage = code;
    applyLanguage(code);
    renderLanguageList();
    languageList
      ?.querySelector(`[data-code="${code}"]`)
      ?.focus({ preventScroll: true });
  }

  function commitLanguage() {
    applyLanguage(pendingLanguage, { remember: true });
    firstRunLanguage = false;
    languageDialog?.close();
  }

  function openLanguageDialog({ firstRun = false } = {}) {
    if (!languageDialog) return;
    firstRunLanguage = firstRun;
    pendingLanguage = language;
    if (languageSearch) languageSearch.value = '';
    if (languageCancel) languageCancel.hidden = firstRun;
    renderLanguageList();
    languageDialog.showModal();
    languageList
      ?.querySelector(`[data-code="${pendingLanguage}"]`)
      ?.scrollIntoView({ block: 'center' });
    languageSearch?.focus();
  }

  function clearPreview() {
    latestScreenshot = null;
    clearConversation();
    preview?.removeAttribute('src');
    shot?.classList.remove('expanded');
    updateLayout();
  }

  function showPreview(image, mode) {
    abandonAction();
    clearConversation();
    latestScreenshot = image;
    if (preview) preview.src = image;
    shot?.classList.remove('expanded');
    shotToggle?.setAttribute('aria-expanded', 'false');
    if (shotLabel) {
      shotLabel.textContent = t(
        mode === 'full' ? 'Captured monitor' : 'Captured area',
      );
    }
    updateLayout();
    if (autoSend?.checked) {
      void sendCapture();
    } else {
      setStatus('Captured. Nothing has been sent yet.');
    }
  }

  async function refreshSession() {
    if (!window.tracer?.getSession) return;
    try {
      session = await window.tracer.getSession();
    } catch {
      session = signedOut();
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

  // Sends one question about the current screenshot. Returns false when it
  // was not sent or failed, so a typed follow-up can be put back.
  async function ask(prompt) {
    if (busy || hotkeyDialog?.open || languageDialog?.open) return false;
    const generation = ++actionGeneration;
    pendingAction = generation;
    setBusy(true);
    try {
      if (!latestScreenshot) {
        setStatus('Capture a screenshot first: press {hotkey}.', {
          hotkey: hotkeyAccelerator,
        });
        return false;
      }
      if (!prompt) {
        setStatus('Type a question first.');
        return false;
      }
      const validation = validateInspectPayload({
        screenshot: latestScreenshot,
        prompt,
      });
      if (!validation.ok) {
        setStatus(validationMessage(validation.error));
        return false;
      }
      if (!bridgeReady()) {
        setStatus('Tracer could not complete that request.');
        return false;
      }
      const provider = selectedProvider();
      if (provider !== 'chatgpt') {
        setStatus('Copying the screenshot and opening {provider}.', {
          provider: PROVIDER_NAMES[provider],
        });
        const result = await window.tracer.handoff({
          provider,
          screenshot: latestScreenshot,
          prompt,
        });
        rememberPrompt(prompt);
        if (generation === actionGeneration) setStatus(result.message);
        return true;
      }
      setStatus('');
      showPending(prompt);
      updateLayout();
      const result = await window.tracer.ask({
        screenshot: latestScreenshot,
        prompt,
        history: turns.slice(-MAX_HISTORY),
        requestId: generation,
        language,
      });
      rememberPrompt(prompt);
      if (generation !== actionGeneration) return true;
      turns.push(
        { role: 'user', text: prompt },
        { role: 'assistant', text: result.text },
      );
      modelName = result.modelName || modelName;
      settlePending(result.text);
      return true;
    } catch (error) {
      if (generation !== actionGeneration) return true;
      settlePending(null);
      const raw = typeof error?.message === 'string' ? error.message : '';
      if (raw.endsWith('The request was cancelled.')) setStatus('Canceled.');
      else {
        lastStatus = { message: '', values: undefined };
        if (statusDisplay) statusDisplay.textContent = errorText(error);
      }
      return false;
    } finally {
      if (pendingAction === generation) pendingAction = 0;
      if (generation === actionGeneration) {
        setBusy(false);
        updateLayout();
      }
    }
  }

  // Sends the prompt box. Used by auto-send, Analyze screenshot, Ctrl+Enter,
  // and File > Analyze screenshot.
  function sendCapture() {
    const blocked = latestScreenshot ? signInNeeded() : '';
    if (blocked) {
      setStatus(blocked);
      setPanel(true);
      return Promise.resolve(false);
    }
    return ask(currentPrompt());
  }

  function fitFollowup() {
    if (!followupInput) return;
    followupInput.style.height = 'auto';
    followupInput.style.height = `${Math.min(followupInput.scrollHeight + 2, 128)}px`;
  }

  async function sendFollowup() {
    const text = followupInput?.value.trim() ?? '';
    if (!text || busy) return;
    const blocked = signInNeeded();
    if (blocked) {
      setStatus(blocked);
      setPanel(true);
      return;
    }
    followupInput.value = '';
    fitFollowup();
    const sent = await ask(text);
    if (!sent && !followupInput.value) {
      followupInput.value = text;
      fitFollowup();
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
      if (button) {
        button.setAttribute('aria-selected', String(tab === libraryTab));
        // Only the selected tab is in the Tab order; arrow keys move between tabs.
        button.tabIndex = tab === libraryTab ? 0 : -1;
        if (tab === libraryTab) list.setAttribute('aria-labelledby', button.id);
      }
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
      label.append(checkbox, document.createTextNode(t('Remember prompts')));
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'link';
      clear.textContent = t('Clear history');
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
      empty.textContent = t(
        libraryTab === 'saved'
          ? 'Saved prompts appear here.'
          : libraryTab === 'favorites'
            ? 'Star a prompt to keep it here.'
            : 'Prompts you submit appear here.',
      );
      list.append(empty);
      return;
    }
    for (const item of items) list.append(renderCard(item));
  }

  // Puts a library prompt in the prompt box, and in the question box when a
  // screenshot is open so Enter asks it right away.
  function usePrompt(text) {
    if (promptInput) {
      promptInput.value = text;
      writeStorage(DRAFT_KEY, text.slice(0, LIMITS.promptChars));
    }
    if (latestScreenshot && followupInput && !followupRow?.hidden) {
      followupInput.value = text;
      fitFollowup();
      followupInput.focus();
      return;
    }
    promptInput?.focus();
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
      title.dir = 'auto';
      title.setAttribute('aria-label', t('Prompt title'));
      const text = document.createElement('textarea');
      text.value = item.text;
      text.maxLength = 2000;
      text.dir = 'auto';
      text.setAttribute('aria-label', t('Prompt text'));
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn';
      save.textContent = t('Save');
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn btn-quiet';
      cancel.textContent = t('Cancel');
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
      const actions = document.createElement('div');
      actions.className = 'card-edit-actions';
      actions.append(save, cancel);
      card.append(title, text, actions);
      return card;
    }
    const title = document.createElement('div');
    title.className = 'prompt-title';
    title.dir = 'auto';
    title.textContent = item.title || t('Prompt');
    const body = document.createElement('button');
    body.type = 'button';
    body.className = 'prompt-body';
    body.dir = 'auto';
    body.textContent =
      item.text.length > 90 ? `${item.text.slice(0, 89)}…` : item.text;
    body.addEventListener('click', () => usePrompt(item.text));
    const meta = document.createElement('div');
    meta.className = 'prompt-meta';
    const stamp = item.updatedAt || item.usedAt;
    meta.textContent = stamp ? new Date(stamp).toLocaleString(language) : '';
    const menu = document.createElement('div');
    menu.className = 'card-menu';
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'link';
    star.textContent = t(item.favorite ? 'Unfavorite' : 'Favorite');
    star.addEventListener('click', () => {
      library = setFavorite(library, item.id, !item.favorite);
      persistLibrary();
      renderLibrary();
    });
    menu.append(star);
    if (library.saved.some((entry) => entry.id === item.id)) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'link';
      edit.textContent = t('Edit');
      edit.addEventListener('click', () => {
        editingId = item.id;
        libraryTab = 'saved';
        renderLibrary();
      });
      menu.append(edit);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'link';
    remove.textContent = t('Delete');
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
    if (event.ctrlKey) modifiers.push('Ctrl');
    if (event.altKey) modifiers.push('Alt');
    if (event.shiftKey) modifiers.push('Shift');
    if (event.metaKey) modifiers.push('Super');
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
    pendingHotkey = '';
    if (hotkeyCurrent) {
      hotkeyCurrent.textContent = t('Current shortcut: {hotkey}', {
        hotkey: hotkeyAccelerator,
      });
    }
    if (hotkeyCapture) {
      hotkeyCapture.textContent = t(
        'Press the new shortcut, for example Ctrl+Alt+S.',
      );
    }
    if (hotkeyError) hotkeyError.textContent = '';
    if (hotkeyApply) hotkeyApply.disabled = true;
    await window.tracer?.suspendHotkey?.();
    hotkeyDialog.showModal();
  }

  async function applyHotkey() {
    if (!pendingHotkey || !hotkeyApply) return;
    hotkeyApply.disabled = true;
    let result;
    try {
      result = await window.tracer?.setHotkey?.(pendingHotkey);
    } catch {
      result = null;
    }
    if (!result?.ok) {
      if (hotkeyError) {
        hotkeyError.textContent = t(
          result?.error || 'That shortcut could not be registered.',
        );
      }
      hotkeyApply.disabled = false;
      return;
    }
    hotkeyAccelerator = result.accelerator;
    updateHint();
    hotkeyDialog?.close();
    showSaveNote('Hotkey set to {hotkey}.', { hotkey: hotkeyAccelerator });
  }

  const savedDraft = readStorage(DRAFT_KEY) ?? readStorage('tracer:prompt');
  if (promptInput) {
    promptInput.value =
      typeof savedDraft === 'string'
        ? savedDraft.slice(0, LIMITS.promptChars)
        : t(DEFAULT_PROMPT);
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
  if (autoSend) autoSend.checked = readStorage(AUTO_SEND_KEY) !== 'off';

  promptInput?.addEventListener('input', () => {
    writeStorage(DRAFT_KEY, promptInput.value.slice(0, LIMITS.promptChars));
  });
  promptInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void sendCapture();
    }
  });
  autoSend?.addEventListener('change', () => {
    writeStorage(AUTO_SEND_KEY, autoSend.checked ? 'on' : 'off');
    updateHint();
  });
  followupInput?.addEventListener('input', fitFollowup);
  followupInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void sendFollowup();
  });
  followupSend?.addEventListener('click', () => {
    void sendFollowup();
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
    const accelerator = acceleratorFromEvent(event);
    if (accelerator === '') {
      // A modifier on its own: wait for the rest of the shortcut.
      event.preventDefault();
      return;
    }
    const modified =
      event.ctrlKey || event.altKey || event.shiftKey || event.metaKey;
    // Tab, Enter, and Space without modifiers still reach the buttons.
    if (!modified || event.key === 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    if (!accelerator) {
      if (hotkeyError) {
        hotkeyError.textContent = t(
          'Use a letter, number, Space, or F1 to F24 with Ctrl or Alt.',
        );
      }
      return;
    }
    pendingHotkey = accelerator;
    if (hotkeyCapture) hotkeyCapture.textContent = accelerator;
    const valid = isValidAccelerator(accelerator);
    if (hotkeyError) {
      hotkeyError.textContent = valid
        ? ''
        : t('Add Ctrl or Alt so the shortcut does not block normal typing.');
    }
    if (hotkeyApply) hotkeyApply.disabled = !valid;
  });
  hotkeyApply?.addEventListener('click', () => {
    void applyHotkey();
  });
  hotkeyCancel?.addEventListener('click', () => {
    hotkeyDialog?.close();
  });
  hotkeyDialog?.addEventListener('close', () => {
    void window.tracer?.resumeHotkey?.().then((result) => {
      if (result?.accelerator) {
        hotkeyAccelerator = result.accelerator;
        updateHint();
      }
    });
  });
  languageButton?.addEventListener('click', () => {
    openLanguageDialog();
  });
  languageSearch?.addEventListener('input', renderLanguageList);
  languageSearch?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const first = languageList?.querySelector('.language-option');
    if (first?.dataset.code) chooseLanguage(first.dataset.code);
  });
  languageContinue?.addEventListener('click', () => {
    commitLanguage();
  });
  languageCancel?.addEventListener('click', () => {
    languageDialog?.close();
  });
  languageDialog?.addEventListener('cancel', (event) => {
    // On first launch a language must be chosen before anything else.
    if (firstRunLanguage) event.preventDefault();
  });
  languageDialog?.addEventListener('close', () => {
    // Closing without Continue puts the saved language back.
    const saved = storedLanguage();
    if (saved && saved !== language) applyLanguage(saved);
  });
  libraryToggle?.addEventListener('click', () => {
    const hidden = !app?.classList.contains('library-hidden');
    setLibraryHidden(hidden);
    writeStorage(LIBRARY_HIDDEN_KEY, hidden ? 'on' : 'off');
  });
  chip?.addEventListener('click', () => {
    setPanel(panel?.hidden ?? false);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!panel || panel.hidden) return;
    if (panel.contains(event.target) || chip?.contains(event.target)) return;
    setPanel(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !panel || panel.hidden) return;
    if (hotkeyDialog?.open || languageDialog?.open) return;
    setPanel(false);
    chip?.focus();
  });
  for (const input of document.querySelectorAll('input[name="provider"]')) {
    input.addEventListener('change', () => {
      writeStorage('tracer:provider', selectedProvider());
      renderConnection();
    });
  }
  shotToggle?.addEventListener('click', () => {
    if (!shot) return;
    const expanded = !shot.classList.contains('expanded');
    shot.classList.toggle('expanded', expanded);
    shotToggle.setAttribute('aria-expanded', String(expanded));
    updateLayout();
  });
  analyzeCommand?.addEventListener('click', () => {
    void sendCapture();
  });
  cancelButton?.addEventListener('click', () => {
    void window.tracer?.cancelAsk?.();
    void window.tracer?.cancelSignIn?.();
  });
  dismissPreview?.addEventListener('click', () => {
    abandonAction();
    clearPreview();
    setStatus('Screenshot and conversation removed.');
  });
  // `fresh` registers a different ChatGPT account instead of reusing the
  // remembered one.
  async function startSignIn(fresh) {
    if (!window.tracer?.signIn) {
      setStatus('Tracer could not complete that request.');
      return;
    }
    const reconsent =
      !fresh && session.status === 'connected' && !session.sharing;
    setBusy(true);
    session = { ...session, status: 'connecting' };
    renderConnection();
    setStatus('Opening the browser to sign in with ChatGPT.');
    try {
      session = await window.tracer.signIn({ reconsent, fresh });
      renderConnection();
      if (session.notice) setStatus(session.notice);
      else if (session.sharing) {
        setStatus('ChatGPT is connected. Press {hotkey} to capture.', {
          hotkey: hotkeyAccelerator,
        });
      } else {
        setStatus('Signed in. Allow ChatGPT plan usage before analyzing.');
      }
    } catch (error) {
      await refreshSession();
      const raw = typeof error?.message === 'string' ? error.message : '';
      if (raw.endsWith('Sign-in was cancelled.'))
        setStatus('Sign-in canceled.');
      else if (statusDisplay) statusDisplay.textContent = errorText(error);
    } finally {
      setBusy(false);
    }
  }
  signInButton?.addEventListener('click', () => {
    void startSignIn(false);
  });
  switchButton?.addEventListener('click', () => {
    void startSignIn(true);
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
      if (statusDisplay) statusDisplay.textContent = errorText(error);
    } finally {
      setBusy(false);
    }
  });
  for (const button of [usageButton, planUsage]) {
    button?.addEventListener('click', async () => {
      try {
        await window.tracer?.openUsage?.();
      } catch (error) {
        if (statusDisplay) statusDisplay.textContent = errorText(error);
      }
    });
  }
  const libraryTabs = [
    ['tab-past', 'past'],
    ['tab-favorites', 'favorites'],
    ['tab-saved', 'saved'],
  ];
  for (const tab of libraryTabs) {
    document.getElementById(tab[0])?.addEventListener('click', () => {
      libraryTab = tab[1];
      renderLibrary();
    });
  }
  document.querySelector('.tabs')?.addEventListener('keydown', (event) => {
    const current = libraryTabs.findIndex((tab) => tab[1] === libraryTab);
    const step = document.documentElement.dir === 'rtl' ? -1 : 1;
    const moves = {
      ArrowRight: current + step,
      ArrowLeft: current - step,
      Home: 0,
      End: libraryTabs.length - 1,
    };
    if (!Object.hasOwn(moves, event.key)) return;
    event.preventDefault();
    const next = (moves[event.key] + libraryTabs.length) % libraryTabs.length;
    libraryTab = libraryTabs[next][1];
    renderLibrary();
    document.getElementById(libraryTabs[next][0])?.focus();
  });
  window.tracer?.onAnswerText?.((event) => {
    if (event?.requestId !== actionGeneration || pendingNodes.length !== 2) {
      return;
    }
    streamText += event.text;
    if (!streamFrame) streamFrame = requestAnimationFrame(renderStream);
  });
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
    if (command === 'analyze') {
      // Ctrl+Enter reaches both the focused box and the File menu, so both
      // paths send whatever box has focus.
      if (document.activeElement === followupInput) void sendFollowup();
      else void sendCapture();
    }
    if (command === 'clear') {
      abandonAction();
      clearPreview();
      setStatus('Screenshot and conversation removed.');
    }
  });

  app?.classList.toggle(
    'library-hidden',
    readStorage(LIBRARY_HIDDEN_KEY) === 'on',
  );
  applyLanguage(language);
  void refreshSession();
  void window.tracer?.getHotkey?.().then((result) => {
    if (result?.accelerator) {
      hotkeyAccelerator = result.accelerator;
      updateHint();
    }
  });
  if (!storedLanguage()) openLanguageDialog({ firstRun: true });
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
