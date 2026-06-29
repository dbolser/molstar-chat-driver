/**
 * Evaluator preview site — free-play with capture.
 *
 * Mounts the molstar-chat-driver plugin against the Supabase `chat` Edge Function (which holds
 * the model keys and records each prompt server-side), and adds the site-level bits the plugin
 * deliberately doesn't carry: a name gate, a recording banner (in index.html), and a feedback
 * widget. Everything is tagged with the evaluator's token from the `?e=<token>` link.
 */
import { createHttpBackend, createUmdRenderer, mountChatDriver } from '../src/index';

declare global {
  interface Window {
    molstar: any;
    MCD_CONFIG: { functionsUrl: string; anonKey: string };
  }
}

const cfg = window.MCD_CONFIG;

// Evaluator token: from the secret invite link `?e=<token>`, else a stable per-browser id.
const params = new URLSearchParams(location.search);
let token = params.get('e');
if (!token) {
  token = localStorage.getItem('mcd-token') ?? crypto.randomUUID();
  localStorage.setItem('mcd-token', token);
}
const nameKey = `mcd-name-${token}`;

/** Fire-and-forget capture; never blocks or breaks the user's session. */
function capture(body: Record<string, unknown>): void {
  void fetch(`${cfg.functionsUrl}/capture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.anonKey}` },
    body: JSON.stringify({ token, ...body }),
    keepalive: true,
  }).catch(() => {});
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

  send.addEventListener('click', () => {
    const comment = ta.value.trim();
    if (!comment) return;
    capture({ kind: 'feedback', comment, turnId: getTurnId() });
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
      headers: { authorization: `Bearer ${cfg.anonKey}`, 'x-evaluator-token': token! },
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
  const input = document.getElementById('gate-name') as HTMLInputElement;
  const go = document.getElementById('gate-go')!;

  const existing = localStorage.getItem(nameKey);
  if (existing) input.value = existing;

  const begin = () => {
    const name = input.value.trim() || 'anonymous';
    localStorage.setItem(nameKey, name);
    if (name !== existing) capture({ kind: 'register', name });
    gate.style.display = 'none';
    void start(name);
  };

  go.addEventListener('click', begin);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') begin();
  });
  input.focus();
}

main();
