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

function buildFeedback(getTurnId: () => string | null): void {
  const root = document.getElementById('feedback')!;
  const ta = document.createElement('textarea');
  ta.placeholder = 'Feedback on the last result, or any thoughts… (recorded)';
  const send = document.createElement('button');
  send.textContent = 'Send feedback';
  const sent = document.createElement('span');
  sent.className = 'sent';
  const row = document.createElement('div');
  row.className = 'row';
  row.append(send, sent);
  root.append(ta, row);

  send.addEventListener('click', async () => {
    const comment = ta.value.trim();
    if (!comment) return;
    send.disabled = true;
    sent.textContent = 'Sending…';
    const res = await capture({ kind: 'feedback', comment, turnId: getTurnId() });
    send.disabled = false;
    if (!res || !res.ok) {
      sent.textContent = 'Could not send — please retry.';
      return;
    }
    ta.value = '';
    sent.textContent = 'Thanks — saved ✓';
    setTimeout(() => (sent.textContent = ''), 3000);
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
    welcome: `Hi ${name} — type anything to build a molecular scene. Try a real question you'd ask a structure. Your prompts and feedback are being recorded.`,
  });

  buildFeedback(() => latestTurnId);
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

  const input = document.getElementById('gate-name') as HTMLInputElement;
  const go = document.getElementById('gate-go')!;
  const error = document.getElementById('gate-error')!;

  const existing = localStorage.getItem(nameKey);
  if (existing) input.value = existing;

  const begin = async () => {
    const name = input.value.trim() || 'anonymous';
    error.textContent = '';
    go.setAttribute('disabled', 'true');
    try {
      localStorage.setItem(nameKey, name);
      if (name !== existing) void capture({ kind: 'register', name });
      await start(name); // only dismiss the gate once the viewer + chat are actually up
      gate.style.display = 'none';
    } catch (e) {
      console.error('startup failed', e);
      error.textContent = 'Something went wrong starting up. Please reload and try again.';
      go.removeAttribute('disabled');
    }
  };

  go.addEventListener('click', begin);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') begin();
  });
  input.focus();
}

main();
