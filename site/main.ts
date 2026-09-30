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

/** Build stamp ("0.2.1+abc1234"), injected by esbuild so captured data says which build made it. */
declare const __MCD_CLIENT_VERSION__: string;
const CLIENT_VERSION = typeof __MCD_CLIENT_VERSION__ === 'string' ? __MCD_CLIENT_VERSION__ : 'dev';

/** Fire-and-forget POST to /capture. Resolves to the Response, or null on network failure. */
function capture(body: Record<string, unknown>): Promise<Response | null> {
  return fetch(`${cfg.functionsUrl}/capture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: cfg.anonKey, 'x-mcd-client': CLIENT_VERSION },
    body: JSON.stringify({ token, ...body }),
    keepalive: true,
  }).catch(() => null);
}

// Quick reactions: one tap = lightweight rating (sent immediately). The same selection also
// tags any longer written feedback. 'neutral' is the default highlight but is never auto-sent.
const RATING_SETTLE_MS = 1200;
const REACTIONS: { rating: string; emoji: string; title: string }[] = [
  { rating: 'love', emoji: '🤯', title: 'I love it' },
  { rating: 'happy', emoji: '🙂', title: 'Happy' },
  { rating: 'neutral', emoji: '😐', title: 'Neutral' },
  { rating: 'sad', emoji: '☹️', title: 'Not great' },
  { rating: 'hate', emoji: '💩', title: 'I hate it' },
];

/** What the evaluator is looking at, as a small JPEG data URL — or null if Mol* can't say. */
async function screenshot(viewer: { plugin: any }): Promise<string | null> {
  try {
    const uri: string = await viewer.plugin.helpers.viewportScreenshot.getImageDataUri();
    // Shrink to ≤ 800px wide JPEG: plenty to see what went wrong, ~50 KB instead of a full PNG.
    const img = new Image();
    await new Promise<void>((ok, fail) => {
      const timer = setTimeout(() => fail(new Error('decode timeout')), 3000); // never hold up the feedback
      img.onload = () => { clearTimeout(timer); ok(); };
      img.onerror = () => { clearTimeout(timer); fail(new Error('decode')); };
      img.src = uri;
    });
    const scale = Math.min(1, 800 / img.width);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  } catch {
    return null; // a missing picture must never block the feedback itself
  }
}

function buildFeedback(getTurnId: () => string | null, shoot: () => Promise<string | null>): void {
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
  let ratingTimer: ReturnType<typeof setTimeout> | undefined;
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
    b.addEventListener('click', () => {
      rating = r.rating;
      for (const [rt, btn] of buttons) btn.classList.toggle('on', rt === rating);
      // One tap is itself a (lightweight) rating — but people browse the faces while deciding,
      // and every tap used to land as its own row. Send the choice they settle on.
      if (ratingTimer !== undefined) clearTimeout(ratingTimer);
      ratingTimer = setTimeout(async () => {
        ratingTimer = undefined;
        const res = await capture({ kind: 'feedback', rating, turnId: getTurnId(), screenshot: await shoot() });
        status(res?.ok ? 'Thanks ✓' : 'Could not send — retry?', 2500);
      }, RATING_SETTLE_MS);
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
    if (ratingTimer !== undefined) clearTimeout(ratingTimer); // this row carries the rating already
    ratingTimer = undefined;
    const res = await capture({ kind: 'feedback', comment, rating, turnId: getTurnId(), screenshot: await shoot() });
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
      headers: { apikey: cfg.anonKey, 'x-evaluator-token': token!, 'x-mcd-client': CLIENT_VERSION },
    }),
    renderer: createUmdRenderer(window.molstar, viewer),
    onTurn: (t) => {
      latestTurnId = ((t.response as Record<string, unknown>)?.turnId as string) ?? null;
      // Tell the backend whether Mol* actually drew the scene — the server only knows it parsed.
      if (latestTurnId && t.response?.mvsj) {
        const error = t.renderError instanceof Error ? t.renderError.message : t.renderError ? String(t.renderError) : null;
        void capture({ kind: 'render', turnId: latestTurnId, rendered: t.rendered, error });
      }
    },
    // Chip row above the composer: starter ideas for a blank session (the 🎲 reshuffles them),
    // and predicted next steps once a scene is going. The content comes from the `suggest` Edge
    // Function; the plugin just renders + submits what we return.
    suggestions: async ({ turns }) => {
      try {
        const res = await fetch(`${cfg.functionsUrl}/suggest`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', apikey: cfg.anonKey, 'x-evaluator-token': token! },
          body: JSON.stringify({ recent: turns.map((t) => t.prompt) }),
        });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data?.suggestions) ? (data.suggestions as string[]) : [];
      } catch {
        return []; // a network hiccup just means no chips this round
      }
    },
    placeholder: 'Ask for any molecular view or ask me a question…',
    welcome: `Hi ${name} — type anything to build a molecular scene, then refine it. Tap a suggestion or 🎲 for ideas, and hit ↺ New scene to start fresh. Your prompts and feedback are being recorded.`,
  });

  buildFeedback(() => latestTurnId, () => screenshot(viewer));
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

/** Waitlist form shown to visitors WITHOUT an invite token: collect an email so we can send a
 *  link, instead of a dead-end "invite only" message. Posts to the token-free `waitlist` function. */
function showWaitlist(card: Element): void {
  const h = document.createElement('h2');
  h.textContent = 'Mol* chat — preview';
  const p = document.createElement('p');
  p.textContent =
    "This preview is invite-only for now — but we're opening it up. Leave your email and we'll send you a link.";
  const email = document.createElement('input');
  email.type = 'email';
  email.placeholder = 'you@example.com';
  email.autocomplete = 'email';
  const name = document.createElement('input');
  name.placeholder = 'Your name (optional)';
  name.autocomplete = 'name';
  const go = document.createElement('button');
  go.textContent = 'Request access';
  const errorEl = document.createElement('div');
  errorEl.id = 'gate-error';
  errorEl.setAttribute('role', 'status');
  errorEl.setAttribute('aria-live', 'polite');
  // Stack the two inputs; keep the button on its own line so the form reads top-to-bottom.
  const wrap = document.createElement('div');
  wrap.className = 'gate-form';
  wrap.append(email, name, go);
  card.replaceChildren(h, p, wrap, errorEl);

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let sending = false;
  const submit = async () => {
    if (sending) return;
    const addr = email.value.trim();
    if (!EMAIL_RE.test(addr)) {
      errorEl.textContent = 'Please enter a valid email address.';
      email.focus();
      return;
    }
    sending = true;
    errorEl.textContent = 'Sending…';
    go.setAttribute('disabled', 'true');
    // Time the request out so a stalled network can't leave the form stuck on "Sending…"
    // forever with no way to retry (abort surfaces as a throw → the catch re-enables the button).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(`${cfg.functionsUrl}/waitlist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: cfg.anonKey },
        body: JSON.stringify({ email: addr, name: name.value.trim() || null }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const done = document.createElement('h2');
      done.textContent = "You're on the list 🎉";
      const msg = document.createElement('p');
      msg.textContent = "Thanks! We'll email you a link as soon as a spot opens up.";
      card.replaceChildren(done, msg);
    } catch (e) {
      console.error('waitlist signup failed', e);
      errorEl.textContent = 'Could not save that — please try again in a moment.';
      go.removeAttribute('disabled');
      sending = false;
    } finally {
      clearTimeout(timer);
    }
  };
  go.addEventListener('click', submit);
  for (const input of [email, name]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }
  email.focus();
}

function main(): void {
  const gate = document.getElementById('gate')!;
  const card = gate.querySelector('.card')!;

  // No invite token → collect an email for the waitlist instead of a dead end.
  if (!token) {
    showWaitlist(card);
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
