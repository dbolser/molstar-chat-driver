/**
 * mountChatDriver — a small, dependency-free chat panel that drives a Mol* viewer.
 *
 * Renders next to a Mol* viewer (it does not own the viewer). Handles the three result states
 * a model can land in — rendered, no-valid-MVS (Tier-0 fail), render-failed — and collects a
 * rating (and optionally free-text feedback) per turn.
 */
import { ChatDriver } from './driver';
import {
  CaptureSink,
  DEFAULT_RATING_SCALE,
  EndpointClient,
  MvsRenderer,
  RatingOption,
} from './types';

export interface ChatDriverPanelConfig {
  endpoint: EndpointClient;
  renderer: MvsRenderer;
  capture?: CaptureSink;
  sessionId: string;
  evaluatorId?: string;
  /** Models the user can pick from. The first is the default. */
  models: string[];
  /** Rating buttons shown under each result. Defaults to {@link DEFAULT_RATING_SCALE}. */
  ratingScale?: RatingOption[];
  /** Show a "your prompts are being recorded" banner (use in free-play). */
  recordingNotice?: boolean;
  /** Offer a free-text feedback box after each result (use in free-play). Default `false`. */
  collectFeedback?: boolean;
  /** Placeholder text for the prompt box. */
  placeholder?: string;
}

export interface ChatDriverPanelHandle {
  driver: ChatDriver;
  destroy(): void;
}

const STYLE_ID = 'mcd-styles';
const CSS = `
.mcd-panel { display:flex; flex-direction:column; height:100%; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; font-size:14px; color:#1a1a1a; background:#fafafa; }
.mcd-banner { padding:6px 12px; background:#fff7e6; border-bottom:1px solid #ffe2a8; color:#7a5b00; font-size:12px; }
.mcd-transcript { flex:1; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:12px; }
.mcd-turn { border:1px solid #e6e6e6; border-radius:8px; background:#fff; overflow:hidden; }
.mcd-prompt { padding:8px 12px; background:#f0f4ff; border-bottom:1px solid #e1e8ff; }
.mcd-prompt .mcd-model { font-size:11px; color:#5566aa; margin-bottom:2px; }
.mcd-status { padding:8px 12px; font-size:13px; }
.mcd-status.ok { color:#1a7f37; }
.mcd-status.warn { color:#9a6700; }
.mcd-status.err { color:#cf222e; }
.mcd-raw { margin:0 12px 8px; padding:8px; background:#f6f8fa; border:1px solid #eaeaea; border-radius:6px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px; white-space:pre-wrap; word-break:break-word; max-height:160px; overflow:auto; }
.mcd-rate { display:flex; flex-wrap:wrap; gap:6px; padding:0 12px 10px; }
.mcd-rate button { cursor:pointer; border:1px solid #d0d0d0; background:#fff; border-radius:999px; padding:4px 12px; font-size:12px; }
.mcd-rate button:hover { background:#f0f0f0; }
.mcd-rate button.sel { background:#1a7f37; border-color:#1a7f37; color:#fff; }
.mcd-rate.done button:not(.sel) { opacity:.4; }
.mcd-fb { display:flex; flex-direction:column; gap:6px; padding:0 12px 12px; }
.mcd-fb textarea { resize:vertical; min-height:48px; border:1px solid #d0d0d0; border-radius:6px; padding:6px; font:inherit; }
.mcd-fb button { align-self:flex-start; cursor:pointer; border:1px solid #d0d0d0; background:#fff; border-radius:6px; padding:4px 12px; font-size:12px; }
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
  const scale = config.ratingScale ?? DEFAULT_RATING_SCALE;

  const driver = new ChatDriver({
    endpoint: config.endpoint,
    renderer: config.renderer,
    capture: config.capture,
    sessionId: config.sessionId,
    evaluatorId: config.evaluatorId,
  });

  const panel = el('div', { class: 'mcd-panel' });
  if (config.recordingNotice) {
    panel.append(
      el('div', { class: 'mcd-banner' }, '● Recording — your prompts and feedback are being saved to help build the benchmark.'),
    );
  }

  const transcript = el('div', { class: 'mcd-transcript' });
  panel.append(transcript);

  // Composer
  const textarea = el('textarea', { placeholder: config.placeholder ?? 'Ask for a molecular view…', rows: '2' });
  const select = el('select');
  for (const m of config.models) select.append(el('option', { value: m }, m));
  const send = el('button', { class: 'mcd-send', type: 'submit' }, 'Send');
  const form = el(
    'form',
    { class: 'mcd-form' },
    textarea,
    el('div', { class: 'mcd-row' }, select, send),
  );
  panel.append(form);

  root.replaceChildren(panel);

  function addTurn(prompt: string, model: string): { status: HTMLElement; turn: HTMLElement } {
    const status = el('div', { class: 'mcd-status' }, 'Thinking…');
    const turn = el(
      'div',
      { class: 'mcd-turn' },
      el('div', { class: 'mcd-prompt' }, el('div', { class: 'mcd-model' }, model), prompt),
      status,
    );
    transcript.append(turn);
    transcript.scrollTop = transcript.scrollHeight;
    return { status, turn };
  }

  function addRating(turn: HTMLElement, prompt: string, model: string): void {
    const row = el('div', { class: 'mcd-rate' });
    for (const opt of scale) {
      const btn = el('button', { type: 'button' }, opt.label);
      btn.addEventListener('click', () => {
        if (row.classList.contains('done')) return;
        driver.rate(opt.value, { prompt, model });
        btn.classList.add('sel');
        row.classList.add('done');
      });
      row.append(btn);
    }
    turn.append(row);

    if (config.collectFeedback) {
      const fbText = el('textarea', { placeholder: 'Anything to add? (optional)' });
      const fbBtn = el('button', { type: 'button' }, 'Submit feedback');
      const fb = el('div', { class: 'mcd-fb' }, fbText, fbBtn);
      fbBtn.addEventListener('click', () => {
        const value = fbText.value.trim();
        if (!value) return;
        driver.feedback(value, { prompt, model });
        fbBtn.textContent = 'Saved ✓';
        fbBtn.setAttribute('disabled', 'true');
        fbText.setAttribute('disabled', 'true');
      });
      turn.append(fb);
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const prompt = textarea.value.trim();
    if (!prompt) return;
    const model = select.value;

    const { status, turn } = addTurn(prompt, model);
    textarea.value = '';
    send.setAttribute('disabled', 'true');

    void driver
      .submit(prompt, model)
      .then((result) => {
        if (result.tier0 === 'fail') {
          status.className = 'mcd-status warn';
          status.textContent = '⚠ No valid scene produced (model output was not parseable MVS).';
        } else if (result.renderOk) {
          status.className = 'mcd-status ok';
          status.textContent = '✓ Rendered in the viewer.';
        } else {
          status.className = 'mcd-status err';
          status.textContent = '✗ Valid MVS, but rendering failed.';
        }
        if (result.tier0 === 'fail' || !result.renderOk) {
          turn.append(el('pre', { class: 'mcd-raw' }, result.response.rawOutput || '(empty)'));
        }
        addRating(turn, prompt, model);
      })
      .catch((err) => {
        status.className = 'mcd-status err';
        status.textContent = `✗ Error: ${String(err)}`;
      })
      .finally(() => {
        send.removeAttribute('disabled');
        transcript.scrollTop = transcript.scrollHeight;
      });
  });

  return {
    driver,
    destroy(): void {
      root.replaceChildren();
    },
  };
}
