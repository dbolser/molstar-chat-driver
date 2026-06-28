/**
 * mountChatDriver — a small, dependency-free chat panel that drives a Mol* viewer.
 *
 * Renders next to a Mol* viewer (it does not own the viewer). Each turn shows the prompt and a
 * status line: rendered, no scene, or an error. That is the whole job — anything beyond it
 * (ratings, recording, …) belongs to the consumer via the `onTurn` hook.
 */
import { ChatDriver } from './driver';
import { PromptHistory } from './history';
import { ChatBackend, ChatTurn, MvsRenderer } from './types';

export interface ChatDriverPanelConfig {
  backend: ChatBackend;
  renderer: MvsRenderer;
  /** Optional models the user can pick from. A selector is shown only when there are 2+. */
  models?: string[];
  /** Which of `models` is selected initially (and used when no selector is shown). */
  defaultModel?: string;
  /** Optional observer fired after each completed turn. */
  onTurn?: (turn: ChatTurn) => void;
  /** Placeholder text for the prompt box. */
  placeholder?: string;
  /** Optional intro line shown above the first turn. */
  welcome?: string;
}

export interface ChatDriverPanelHandle {
  driver: ChatDriver;
  destroy(): void;
}

const STYLE_ID = 'mcd-styles';
const CSS = `
.mcd-panel { display:flex; flex-direction:column; height:100%; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; font-size:14px; color:#1a1a1a; background:#fafafa; }
.mcd-transcript { flex:1; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:12px; }
.mcd-welcome { color:#666; font-size:13px; padding:4px 2px; }
.mcd-turn { border:1px solid #e6e6e6; border-radius:8px; background:#fff; overflow:hidden; }
.mcd-prompt { padding:8px 12px; background:#f0f4ff; border-bottom:1px solid #e1e8ff; }
.mcd-prompt .mcd-model { font-size:11px; color:#5566aa; margin-bottom:2px; }
.mcd-status { padding:8px 12px; font-size:13px; }
.mcd-status.ok { color:#1a7f37; }
.mcd-status.warn { color:#9a6700; }
.mcd-status.err { color:#cf222e; }
.mcd-text { padding:0 12px 10px; font-size:13px; color:#333; white-space:pre-wrap; }
.mcd-form { display:flex; flex-direction:column; gap:8px; padding:12px; border-top:1px solid #e6e6e6; background:#fff; }
.mcd-form .mcd-row { display:flex; gap:8px; align-items:center; }
.mcd-form select { flex:0 0 auto; padding:6px; border:1px solid #d0d0d0; border-radius:6px; font:inherit; }
.mcd-form textarea { flex:1; resize:vertical; min-height:44px; border:1px solid #d0d0d0; border-radius:6px; padding:8px; font:inherit; }
.mcd-form button.mcd-send { cursor:pointer; border:none; background:#1a66ff; color:#fff; border-radius:6px; padding:8px 16px; font:inherit; }
.mcd-form button.mcd-send:disabled { opacity:.5; cursor:default; }
`;

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

type Attrs = Record<string, string>;
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
  }
  for (const c of children) node.append(c);
  return node;
}

const caretAtStart = (t: HTMLTextAreaElement): boolean => t.selectionStart === 0 && t.selectionEnd === 0;
const caretAtEnd = (t: HTMLTextAreaElement): boolean =>
  t.selectionStart === t.value.length && t.selectionEnd === t.value.length;

/** Replace the textarea's text and drop the caret at the end (used when recalling history). */
function setText(t: HTMLTextAreaElement, value: string): void {
  t.value = value;
  t.setSelectionRange(value.length, value.length);
}

/** Resolve the mount target from an element or an element id. */
function resolveTarget(target: string | HTMLElement): HTMLElement {
  const node = typeof target === 'string' ? document.getElementById(target) : target;
  if (!node) throw new Error(`mountChatDriver: target not found: ${String(target)}`);
  return node;
}

export function mountChatDriver(
  target: string | HTMLElement,
  config: ChatDriverPanelConfig,
): ChatDriverPanelHandle {
  ensureStyles();
  const root = resolveTarget(target);
  const models = config.models ?? [];

  const driver = new ChatDriver({
    backend: config.backend,
    renderer: config.renderer,
    onTurn: config.onTurn,
  });

  const panel = el('div', { class: 'mcd-panel' });
  const transcript = el('div', { class: 'mcd-transcript' });
  if (config.welcome) transcript.append(el('div', { class: 'mcd-welcome' }, config.welcome));
  panel.append(transcript);

  // Composer
  const textarea = el('textarea', {
    placeholder: config.placeholder ?? 'Ask for a molecular view…',
    rows: '2',
    title: 'Enter to send · Shift+Enter for a newline · ↑/↓ to recall earlier prompts',
  });
  const send = el('button', { class: 'mcd-send', type: 'submit' }, 'Send');
  const row = el('div', { class: 'mcd-row' });
  let select: HTMLSelectElement | undefined;
  if (models.length > 1) {
    select = el('select');
    for (const m of models) select.append(el('option', { value: m }, m));
    if (config.defaultModel && models.includes(config.defaultModel)) select.value = config.defaultModel;
    row.append(select);
  }
  row.append(send);
  const form = el('form', { class: 'mcd-form' }, textarea, row);
  panel.append(form);

  root.replaceChildren(panel);

  function addTurn(prompt: string, model?: string): { status: HTMLElement; turn: HTMLElement } {
    const status = el('div', { class: 'mcd-status' }, 'Thinking…');
    const head = el('div', { class: 'mcd-prompt' });
    if (model) head.append(el('div', { class: 'mcd-model' }, model));
    head.append(prompt);
    const turn = el('div', { class: 'mcd-turn' }, head, status);
    transcript.append(turn);
    transcript.scrollTop = transcript.scrollHeight;
    return { status, turn };
  }

  const history = new PromptHistory();

  function runPrompt(): void {
    const prompt = textarea.value.trim();
    if (!prompt) return;
    const model = select?.value || (models.length === 1 ? models[0] : config.defaultModel);

    history.add(prompt);
    const { status, turn } = addTurn(prompt, model);
    textarea.value = '';
    send.setAttribute('disabled', 'true');

    void driver
      .submit(prompt, model)
      .then((result) => {
        if (result.rendered) {
          status.className = 'mcd-status ok';
          status.textContent = '✓ Rendered in the viewer.';
        } else if (result.response.mvsj) {
          // A scene was produced but Mol* rejected it — show why, don't swallow it.
          status.className = 'mcd-status err';
          status.textContent = result.renderError
            ? `✗ Could not render this scene: ${String(result.renderError)}`
            : '✗ Could not render this scene.';
        } else if (result.response.error) {
          // The backend itself failed: that's an error, not a benign "no scene".
          status.className = 'mcd-status err';
          status.textContent = `✗ ${result.response.error}`;
        } else {
          status.className = 'mcd-status warn';
          status.textContent = '⚠ No scene produced for that prompt.';
        }
        if (result.response.text) {
          turn.append(el('div', { class: 'mcd-text' }, result.response.text));
        }
      })
      .catch((err) => {
        status.className = 'mcd-status err';
        status.textContent = `✗ Error: ${String(err)}`;
      })
      .finally(() => {
        send.removeAttribute('disabled');
        transcript.scrollTop = transcript.scrollHeight;
      });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    runPrompt();
  });

  // Enter sends (Shift+Enter inserts a newline); ↑/↓ recall earlier prompts, shell-style.
  // History only fires when the caret is at the very start (↑) or end (↓) so normal
  // line-by-line cursor movement inside a multiline draft is left untouched.
  textarea.addEventListener('keydown', (e) => {
    // `!e.isComposing` so confirming an IME composition (CJK input) with Enter doesn't submit.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      runPrompt();
      return;
    }
    if (e.key === 'ArrowUp' && caretAtStart(textarea)) {
      const recalled = history.prev(textarea.value);
      if (recalled !== null) {
        e.preventDefault();
        setText(textarea, recalled);
      }
      return;
    }
    if (e.key === 'ArrowDown' && caretAtEnd(textarea)) {
      const recalled = history.next();
      if (recalled !== null) {
        e.preventDefault();
        setText(textarea, recalled);
      }
    }
  });

  return {
    driver,
    destroy(): void {
      root.replaceChildren();
    },
  };
}
