/**
 * Rating page — the MolBench judge-agreement study (A4).
 *
 * Shows one pair at a time: the task prompt, the reference render and a model's render. The
 * evaluator answers same / different / can't tell; the `rate` Edge Function saves the answer and
 * picks the next pair (least-rated first, so every pair gets two raters). Raters are blind: the
 * public items.json holds only opaque ids, prompts and images — the model and the VLM's verdict
 * stay in MolBench's private answer key.
 *
 * Same invite token as the chat page (`?e=<token>`, remembered per browser).
 */

declare global {
  interface Window {
    MCD_CONFIG: { functionsUrl: string; anonKey: string };
  }
}
declare const __MCD_CLIENT_VERSION__: string;
const CLIENT_VERSION = typeof __MCD_CLIENT_VERSION__ === 'string' ? __MCD_CLIENT_VERSION__ : 'dev';

const SET = 'a4-v1';
const GOAL = 70; // ~two ratings per pair across the volunteer panel; about 20 minutes

const cfg = window.MCD_CONFIG;
const tokenKey = 'mcd-token';
const fromLink = new URLSearchParams(location.search).get('e');
if (fromLink) localStorage.setItem(tokenKey, fromLink);
const token = fromLink ?? localStorage.getItem(tokenKey);
const nameKey = `mcd-name-${token}`;

type Label = 'same' | 'different' | 'unsure';
interface Item { id: string; prompt: string; ref: string; out: string }
type Flag = 'ref_wrong' | 'model_better';
interface Answer { item: string; label: Label; ref_wrong: boolean; model_better: boolean; note: string; ms: number }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const base = `./rate/${SET}/`;

async function post(fn: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${cfg.functionsUrl}/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: cfg.anonKey, 'x-mcd-client': CLIENT_VERSION },
    body: JSON.stringify({ token, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function gate(title: string, text: string): HTMLElement {
  const card = $('gate').querySelector('.card') as HTMLElement;
  const h = document.createElement('h2');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = text;
  card.replaceChildren(h, p);
  $('gate').style.display = '';
  return card;
}

/** Ask for a name once per browser (shared with the chat page), then resolve. */
function askName(): Promise<void> {
  if (localStorage.getItem(nameKey)) return Promise.resolve();
  const card = gate('Rate some scenes', 'Pop your name in so we can credit your help.');
  const input = document.createElement('input');
  input.placeholder = 'Your name';
  input.autocomplete = 'name';
  const go = document.createElement('button');
  go.textContent = 'Start';
  const row = document.createElement('div');
  row.append(input, go);
  card.append(row);
  input.focus();
  return new Promise((resolve) => {
    const begin = () => {
      const name = input.value.trim() || 'anonymous';
      localStorage.setItem(nameKey, name);
      void post('capture', { kind: 'register', name }).catch(() => null);
      resolve();
    };
    go.addEventListener('click', begin);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && begin());
  });
}

async function main(): Promise<void> {
  if (!token) {
    gate('Rate some scenes', 'This page needs your personal invite link. Please open the link you were sent.');
    return;
  }
  await askName();

  const set = await (await fetch(`${base}items.json`)).json();
  const items = new Map<string, Item>(set.items.map((i: Item) => [i.id, i]));
  const ids = [...items.keys()];
  $('question').textContent = set.question;

  let current: Item | null = null;
  let shownAt = 0;
  let busy = false;
  // Optional flags on the pair (either, both or neither), set before answering and sent with it.
  const flags: Record<Flag, boolean> = { ref_wrong: false, model_better: false };
  const flagButtons = document.querySelectorAll<HTMLButtonElement>('#flags button[data-flag]');
  const setFlag = (f: Flag, on: boolean) => {
    flags[f] = on;
    flagButtons.forEach((b) => {
      if (b.dataset.flag !== f) return;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  };
  let ready = false; // both renders on screen; until then answers are ignored
  const answerButtons = document.querySelectorAll<HTMLButtonElement>('#answers button[data-label]');
  const setReady = (on: boolean) => {
    ready = on;
    answerButtons.forEach((b) => b.toggleAttribute('disabled', !on));
  };
  const history: Answer[] = []; // answered this session, for "Back"

  const progress = (done: number) => {
    $('done').textContent = String(done);
    ($('bar') as HTMLProgressElement).value = Math.min(done, GOAL);
    $('goal-note').textContent = done >= GOAL ? 'Goal reached, thank you! Carry on if you like.' : `aim for ${GOAL}`;
  };

  const show = (item: Item | null, prior?: Answer) => {
    current = item;
    $('back').toggleAttribute('disabled', history.length === 0);
    if (!item) {
      $('pair').style.display = 'none';
      $('finished').style.display = '';
      return;
    }
    $('finished').style.display = 'none';
    $('pair').style.display = '';
    $('prompt').textContent = item.prompt;
    setReady(false);
    const loads = (['ref', 'out'] as const).map((side) => {
      const img = $<HTMLImageElement>(`img-${side}`);
      img.src = base + item[side];
      ($(`link-${side}`) as HTMLAnchorElement).href = base + item[side];
      return img.decode();
    });
    $<HTMLTextAreaElement>('note').value = prior?.note ?? '';
    answerButtons.forEach((b) => b.classList.toggle('on', b.dataset.label === prior?.label));
    setFlag('ref_wrong', prior?.ref_wrong ?? false);
    setFlag('model_better', prior?.model_better ?? false);
    // Start the clock once both renders are visible, so a slow load can't be rated blind.
    Promise.all(loads).then(
      () => {
        if (current !== item) return;
        setReady(true);
        shownAt = performance.now();
      },
      () => {
        if (current === item) $('status').textContent = 'The images did not load. Please refresh the page.';
      },
    );
  };

  const step = async (answer?: Answer) => {
    if (busy) return;
    busy = true;
    $('status').textContent = answer ? 'Saving…' : 'Loading…';
    try {
      const r = await post('rate', { set: SET, items: ids, answer });
      if (answer) history.push(answer);
      progress(r.done);
      $('status').textContent = '';
      show(r.next ? items.get(r.next) ?? null : null);
    } catch (e) {
      console.error('rate failed', e);
      $('status').textContent = answer
        ? `Could not save: ${(e as Error).message}. Please try again.`
        : `Could not load: ${(e as Error).message}. Please refresh the page.`;
    } finally {
      busy = false;
    }
  };

  const answer = (label: Label) => {
    if (!current || !ready || busy) return;
    void step({ item: current.id, label, ...flags, note: $<HTMLTextAreaElement>('note').value.trim(),
      ms: performance.now() - shownAt });
  };

  flagButtons.forEach((b) => b.addEventListener('click', () => {
    const f = b.dataset.flag as Flag;
    setFlag(f, !flags[f]);
  }));

  answerButtons.forEach((b) => b.addEventListener('click', () => answer(b.dataset.label as Label)));
  $('back').addEventListener('click', () => {
    if (busy) return; // a save in flight would overwrite the item we go back to
    const prev = history.pop();
    if (prev) show(items.get(prev.item) ?? null, prev);
  });
  document.addEventListener('keydown', (e) => {
    // A held key repeats; only a fresh press answers, so one keypress can't rate the next pair too.
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest('textarea, input')) return;
    const label = ({ 1: 'same', 2: 'different', 3: 'unsure' } as Record<string, Label>)[e.key];
    if (label) answer(label);
    const f = ({ w: 'ref_wrong', b: 'model_better' } as Record<string, Flag>)[e.key.toLowerCase()];
    if (f) setFlag(f, !flags[f]);
  });

  $('gate').style.display = 'none';
  await step();
}

main().catch((e) => {
  console.error(e);
  gate('Rate some scenes', `Something went wrong loading the page: ${(e as Error).message}`);
});

export {};
