/**
 * Evaluator preview site — free-play with capture.
 *
 * Mounts the molstar-chat-driver plugin against the Supabase `chat` Edge Function (which holds
 * the model keys and records each prompt server-side), and adds the site-level bits the plugin
 * deliberately doesn't carry: a name gate, a recording banner (in index.html), and a feedback
 * widget. Everything is tagged with the evaluator's token from the `?e=<token>` invite link.
 *
 * The site is invite-only: without a valid `?e=` token (or one remembered from a previous visit
 * on this browser) it shows a "need your link" message and never mounts — the Edge Functions
 * reject unknown tokens anyway, so this just fails closed gracefully.
 */
import { createHttpBackend, createUmdRenderer, mountChatDriver } from '../src/index';

declare global {
  interface Window {
    molstar: any;
    MCD_CONFIG: { functionsUrl: string; anonKey: string };
  }
}

const cfg = window.MCD_CONFIG;

// Evaluator token: from the secret invite link `?e=<token>`, remembered per-browser so a
// reviewer who reopens the bare URL keeps their identity. No token at all → fail closed.
const tokenKey = 'mcd-token';
const params = new URLSearchParams(location.search);
const fromLink = params.get('e');
if (fromLink) localStorage.setItem(tokenKey, fromLink);
const token = fromLink ?? localStorage.getItem(tokenKey);
const nameKey = `mcd-name-${token}`;

/** Fire-and-forget POST to /capture. Resolves to the Response, or null on network failure. */
function capture(body: Record<string, unknown>): Promise<Response | null> {
  return fetch(`${cfg.functionsUrl}/capture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: cfg.anonKey },
    body: JSON.stringify({ token, ...body }),
    keepalive: true,
  }).catch(() => null);
}

// Quick reactions: one tap = lightweight rating (sent immediately). The same selection also
// tags any longer written feedback. 'neutral' is the default highlight but is never auto-sent.
const REACTIONS: { rating: string; emoji: string; title: string }[] = [
  { rating: 'love', emoji: '🤯', title: 'I love it' },
  { rating: 'happy', emoji: '🙂', title: 'Happy' },
  { rating: 'neutral', emoji: '😐', title: 'Neutral' },
  { rating: 'sad', emoji: '☹️', title: 'Not great' },
  { rating: 'hate', emoji: '💩', title: 'I hate it' },
];

function buildFeedback(getTurnId: () => string | null): void {
  const root = document.getElementById('feedback')!;
  let rating = 'neutral';

  const emojiRow = document.createElement('div');
  emojiRow.className = 'emoji';
  const buttons = new Map<string, HTMLButtonElement>();
  const sent = document.createElement('span');
  sent.className = 'sent';
  sent.setAttribute('role', 'status'); // announce success/failure to screen readers
  sent.setAttribute('aria-live', 'polite');

  // One shared status line; clear any pending auto-hide first so rapid taps don't race
  // (an earlier timeout blanking a later message).
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  function status(msg: string, autoHideMs?: number): void {
    if (statusTimer !== undefined) clearTimeout(statusTimer);
    sent.textContent = msg;
    statusTimer = autoHideMs
      ? setTimeout(() => {
          sent.textContent = '';
          statusTimer = undefined;
        }, autoHideMs)
      : undefined;
  }

  for (const r of REACTIONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = r.emoji;
    b.title = r.title;
    b.setAttribute('aria-label', r.title);
    if (r.rating === rating) b.classList.add('on');
    b.addEventListener('click', async () => {
      rating = r.rating;
      for (const [rt, btn] of buttons) btn.classList.toggle('on', rt === rating);
      // One tap is itself a (lightweight) rating — record it right away.
      const res = await capture({ kind: 'feedback', rating, turnId: getTurnId() });
      status(res?.ok ? 'Thanks ✓' : 'Could not send — retry?', 2500);
    });
    buttons.set(r.rating, b);
    emojiRow.append(b);
  }

  const ta = document.createElement('textarea');
  ta.placeholder = 'Anything more? What worked, what didn’t… (recorded)';
  const send = document.createElement('button');
  send.className = 'thoughts';
  send.textContent = 'Thoughts?';
  const row = document.createElement('div');
  row.className = 'row';
  row.append(send, sent);
  root.append(emojiRow, ta, row);

  send.addEventListener('click', async () => {
    const comment = ta.value.trim();
    if (!comment) return;
    send.disabled = true;
    status('Sending…');
    const res = await capture({ kind: 'feedback', comment, rating, turnId: getTurnId() });
    send.disabled = false;
    if (!res || !res.ok) {
      status('Could not send — please retry.', 4000);
      return;
    }
    ta.value = '';
    status('Thanks — saved ✓', 3000);
  });
}

async function start(name: string): Promise<void> {
  const viewer = await window.molstar.Viewer.create('viewer', {
    layoutIsExpanded: false,
    layoutShowControls: false,
    layoutShowLog: false,
    layoutShowLeftPanel: false,
    viewportShowExpand: true,
  });

  let latestTurnId: string | null = null;
  mountChatDriver('chat', {
    backend: createHttpBackend(`${cfg.functionsUrl}/chat`, {
      headers: { apikey: cfg.anonKey, 'x-evaluator-token': token! },
    }),
    renderer: createUmdRenderer(window.molstar, viewer),
    onTurn: (t) => {
      latestTurnId = ((t.response as Record<string, unknown>)?.turnId as string) ?? null;
    },
    placeholder: 'Ask for any molecular view…',
    welcome: `Hi ${name} — type anything to build a molecular scene, then refine it. Hit ↺ New scene to start fresh. Your prompts and feedback are being recorded.`,
  });

  buildFeedback(() => latestTurnId);
}

/** Drag or arrow-key the divider to resize the side (chat) pane. Width lives in a CSS custom
 *  property so it never leaks into (and break) the mobile stacked layout, which overrides flex. */
function setupResize(): void {
  const app = document.getElementById('app');
  const side = document.getElementById('side');
  const divider = document.getElementById('divider');
  if (!app || !side || !divider) return;
  const MIN = 260;
  const apply = (w: number) => {
    const max = app.getBoundingClientRect().width - 200;
    const c = Math.min(Math.max(w, MIN), Math.max(MIN, max));
    side.style.setProperty('--side-w', `${Math.round(c)}px`);
    divider.setAttribute('aria-valuemin', String(MIN));
    divider.setAttribute('aria-valuemax', String(Math.round(Math.max(MIN, max))));
    divider.setAttribute('aria-valuenow', String(Math.round(c)));
  };
  let dragging = false;
  divider.addEventListener('pointerdown', (e) => {
    dragging = true;
    divider.classList.add('dragging');
    divider.setPointerCapture(e.pointerId);
    document.body.style.userSelect = 'none';
  });
  divider.addEventListener('pointermove', (e) => {
    if (dragging) apply(app.getBoundingClientRect().right - e.clientX);
  });
  const stop = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove('dragging');
    try {
      divider.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    document.body.style.userSelect = '';
  };
  apply(side.getBoundingClientRect().width || 420); // seed aria-value* on load
  divider.addEventListener('pointerup', stop);
  divider.addEventListener('pointercancel', stop);
  divider.addEventListener('keydown', (e) => {
    const cur = side.getBoundingClientRect().width;
    if (e.key === 'ArrowLeft') apply(cur + 24); // divider left → wider chat
    else if (e.key === 'ArrowRight') apply(cur - 24);
    else return;
    e.preventDefault();
  });
}

function main(): void {
  const gate = document.getElementById('gate')!;
  const card = gate.querySelector('.card')!;

  // No invite token → don't mount; explain how to get in.
  if (!token) {
    card.innerHTML =
      '<h2>Invite only</h2><p>This preview is invite-only. Please open it using the personal link you were sent (it ends with <code>?e=…</code>).</p>';
    return;
  }

  setupResize();

  // Build (or rebuild) the name-entry gate. Used first-time AND as the fallback if an auto-start
  // for a returning evaluator fails — so a bad startup can't trap them in a reload loop.
  const showNameGate = (prefill: string, errorMsg = ''): void => {
    const h = document.createElement('h2');
    h.textContent = 'Mol* chat — preview';
    const p = document.createElement('p');
    p.textContent = 'Pop your name in so we can credit your feedback.';
    const input = document.createElement('input');
    input.placeholder = 'Your name';
    input.autocomplete = 'name';
    input.value = prefill;
    const go = document.createElement('button');
    go.textContent = 'Start';
    const errorEl = document.createElement('div');
    errorEl.id = 'gate-error';
    errorEl.textContent = errorMsg;
    const wrap = document.createElement('div');
    wrap.append(input, go);
    card.replaceChildren(h, p, wrap, errorEl);

    let starting = false;
    const begin = async () => {
      if (starting) return; // guard: Enter can re-fire while start() is still pending
      starting = true;
      const name = input.value.trim() || 'anonymous';
      errorEl.textContent = '';
      go.setAttribute('disabled', 'true');
      try {
        localStorage.setItem(nameKey, name);
        void capture({ kind: 'register', name });
        await start(name); // only dismiss the gate once the viewer + chat are actually up
        gate.style.display = 'none';
      } catch (e) {
        console.error('startup failed', e);
        errorEl.textContent = 'Something went wrong starting up. Please try again.';
        go.removeAttribute('disabled');
        starting = false; // allow a retry
      }
    };
    go.addEventListener('click', begin);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') begin();
    });
    input.focus();
  };

  // Returning evaluator (name remembered on this browser) → skip the prompt, go straight in;
  // fall back to the name gate (pre-filled) if startup fails.
  const existing = localStorage.getItem(nameKey);
  if (existing) {
    const h = document.createElement('h2');
    h.textContent = `Welcome back, ${existing}`;
    const p = document.createElement('p');
    p.textContent = 'Starting your session…';
    card.replaceChildren(h, p);
    start(existing)
      .then(() => (gate.style.display = 'none'))
      .catch((e) => {
        console.error('startup failed', e);
        showNameGate(existing, 'Could not start automatically — please try again.');
      });
    return;
  }

  showNameGate('');
}

main();
