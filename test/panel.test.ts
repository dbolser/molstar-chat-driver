import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { ChatBackend, ChatRequest, MvsRenderer } from '../src/types';

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
