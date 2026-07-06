import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { ChatBackend, ChatRequest, MvsRenderer, SuggestionContext } from '../src/types';

let mountChatDriver: typeof import('../src/panel').mountChatDriver;
let win: Window & typeof globalThis;

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  win = dom.window as unknown as Window & typeof globalThis;
  // Expose the DOM as globals so the panel's bare `document`/`HTMLElement` refs resolve.
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    HTMLElement: win.HTMLElement,
    Node: win.Node,
    KeyboardEvent: win.KeyboardEvent,
  });
  ({ mountChatDriver } = await import('../src/panel'));
});

beforeEach(() => {
  document.body.innerHTML = '<div id="chat"></div>';
});

const okRenderer: MvsRenderer = { async loadMvsj() {} };

function recordingBackend(): { backend: ChatBackend; calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  return {
    calls,
    backend: {
      async run(req) {
        calls.push(req);
        return { mvsj: null };
      },
    },
  };
}

const key = (init: KeyboardEventInit) =>
  new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
const tick = () => new Promise((r) => setTimeout(r, 0));

test('Enter submits the prompt and clears the box', async () => {
  const { backend, calls } = recordingBackend();
  mountChatDriver('chat', { backend, renderer: okRenderer });
  const ta = document.querySelector('textarea')!;
  ta.value = 'show lysozyme';
  ta.dispatchEvent(key({ key: 'Enter' }));
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, 'show lysozyme');
  assert.equal(ta.value, '');
});

test('Shift+Enter does not submit (it leaves a newline to the browser)', async () => {
  const { backend, calls } = recordingBackend();
  mountChatDriver('chat', { backend, renderer: okRenderer });
  const ta = document.querySelector('textarea')!;
  ta.value = 'line one';
  ta.dispatchEvent(key({ key: 'Enter', shiftKey: true }));
  await tick();
  assert.equal(calls.length, 0);
});

test('Enter while an IME is composing does not submit', async () => {
  const { backend, calls } = recordingBackend();
  mountChatDriver('chat', { backend, renderer: okRenderer });
  const ta = document.querySelector('textarea')!;
  ta.value = 'にほん';
  ta.dispatchEvent(key({ key: 'Enter', isComposing: true }));
  await tick();
  assert.equal(calls.length, 0);
});

test('ArrowUp at the start of the box recalls the previous prompt', async () => {
  const { backend } = recordingBackend();
  mountChatDriver('chat', { backend, renderer: okRenderer });
  const ta = document.querySelector('textarea')!;
  ta.value = 'first prompt';
  ta.dispatchEvent(key({ key: 'Enter' }));
  await tick();
  assert.equal(ta.value, ''); // cleared after sending
  ta.setSelectionRange(0, 0);
  ta.dispatchEvent(key({ key: 'ArrowUp' }));
  assert.equal(ta.value, 'first prompt');
});

test('the model selector appears for 2+ models and preselects the default', () => {
  const { backend } = recordingBackend();
  mountChatDriver('chat', {
    backend,
    renderer: okRenderer,
    models: ['anthropic:claude-haiku-4-5', 'openrouter:qwen/qwen3.6-27b'],
    defaultModel: 'openrouter:qwen/qwen3.6-27b',
  });
  const select = document.querySelector('select');
  assert.ok(select, 'a selector should be rendered');
  assert.equal(select!.options.length, 2);
  assert.equal(select!.value, 'openrouter:qwen/qwen3.6-27b');
});

test('no selector is shown for a single configured model', () => {
  const { backend } = recordingBackend();
  mountChatDriver('chat', { backend, renderer: okRenderer, models: ['anthropic:claude-haiku-4-5'] });
  assert.equal(document.querySelector('select'), null);
});

test('no suggestion row is rendered without a provider', () => {
  const { backend } = recordingBackend();
  mountChatDriver('chat', { backend, renderer: okRenderer });
  assert.equal(document.querySelector('.mcd-suggest'), null);
});

test('the suggestion provider is called on mount with an empty first-prompt context', async () => {
  const { backend } = recordingBackend();
  const seen: SuggestionContext[] = [];
  mountChatDriver('chat', {
    backend,
    renderer: okRenderer,
    suggestions: (ctx) => {
      seen.push(ctx);
      return ['Show me lysozyme', 'Load hemoglobin'];
    },
  });
  await tick();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].isFirstPrompt, true);
  assert.equal(seen[0].turns.length, 0);
  const chips = document.querySelectorAll('.mcd-suggest .mcd-chip');
  assert.equal(chips.length, 2);
  assert.equal(chips[0].textContent, 'Show me lysozyme');
  // A 🎲 reshuffle button accompanies the chips.
  assert.ok(document.querySelector('.mcd-suggest .mcd-dice'));
});

test('maxSuggestions caps how many chips are shown', async () => {
  const { backend } = recordingBackend();
  mountChatDriver('chat', {
    backend,
    renderer: okRenderer,
    maxSuggestions: 2,
    suggestions: () => ['a', 'b', 'c', 'd'],
  });
  await tick();
  assert.equal(document.querySelectorAll('.mcd-suggest .mcd-chip').length, 2);
});

test('non-string suggestions are dropped rather than crashing the row', async () => {
  const { backend } = recordingBackend();
  mountChatDriver('chat', {
    backend,
    renderer: okRenderer,
    // Untrusted providers (e.g. a backend response) may include junk; it must not throw.
    suggestions: () => ['Show me lysozyme', null, 42, '  ', 'Load hemoglobin'] as unknown as string[],
  });
  await tick();
  const chips = [...document.querySelectorAll('.mcd-suggest .mcd-chip')].map((c) => c.textContent);
  assert.deepEqual(chips, ['Show me lysozyme', 'Load hemoglobin']);
});

test('clicking a suggestion chip submits that prompt', async () => {
  const { backend, calls } = recordingBackend();
  mountChatDriver('chat', {
    backend,
    renderer: okRenderer,
    suggestions: (ctx) => (ctx.isFirstPrompt ? ['Show me lysozyme'] : []),
  });
  await tick();
  const chip = document.querySelector('.mcd-suggest .mcd-chip') as HTMLButtonElement;
  chip.click();
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, 'Show me lysozyme');
});
