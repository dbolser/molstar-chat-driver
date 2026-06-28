import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpBackend } from '../src/backend';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Minimal stand-in for the bits of `Response` the backend touches. */
function fakeResponse(opts: {
  ok: boolean;
  status?: number;
  json?: () => unknown;
  text?: () => string;
}): Response {
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    async json() {
      if (!opts.json) throw new SyntaxError('Unexpected token');
      return opts.json();
    },
    async text() {
      return opts.text ? opts.text() : '';
    },
  } as unknown as Response;
}

test('returns an error result when the network call rejects', async () => {
  globalThis.fetch = async () => {
    throw new Error('ECONNREFUSED');
  };
  const res = await createHttpBackend('http://x/chat').run({ prompt: 'hi' });
  assert.equal(res.mvsj, null);
  assert.match(res.error ?? '', /Network error/);
});

test('returns an error result on a non-2xx response', async () => {
  globalThis.fetch = async () => fakeResponse({ ok: false, status: 503, text: () => 'upstream down' });
  const res = await createHttpBackend('http://x/chat').run({ prompt: 'hi' });
  assert.equal(res.mvsj, null);
  assert.match(res.error ?? '', /HTTP 503/);
});

test('returns an error result (does not throw) when a 200 body is not JSON', async () => {
  globalThis.fetch = async () => fakeResponse({ ok: true }); // json() throws
  const res = await createHttpBackend('http://x/chat').run({ prompt: 'hi' });
  assert.equal(res.mvsj, null);
  assert.match(res.error ?? '', /Invalid JSON/);
});

test('returns an error result when a 200 body is the wrong shape', async () => {
  globalThis.fetch = async () => fakeResponse({ ok: true, json: () => ({ unexpected: true }) });
  const res = await createHttpBackend('http://x/chat').run({ prompt: 'hi' });
  assert.equal(res.mvsj, null);
  assert.match(res.error ?? '', /Malformed/);
});

test('passes a well-formed response through untouched', async () => {
  globalThis.fetch = async () => fakeResponse({ ok: true, json: () => ({ mvsj: '{}', text: 'ok' }) });
  const res = await createHttpBackend('http://x/chat').run({ prompt: 'hi' });
  assert.equal(res.mvsj, '{}');
  assert.equal(res.text, 'ok');
});

test('sends the request as JSON with merged headers', async () => {
  let captured: RequestInit | undefined;
  globalThis.fetch = async (_url, init) => {
    captured = init as RequestInit;
    return fakeResponse({ ok: true, json: () => ({ mvsj: null }) });
  };
  await createHttpBackend('http://x/chat', { headers: { 'x-api-key': 'secret' } }).run({ prompt: 'hi' });
  assert.equal((captured?.headers as Record<string, string>)['content-type'], 'application/json');
  assert.equal((captured?.headers as Record<string, string>)['x-api-key'], 'secret');
  assert.deepEqual(JSON.parse(String(captured?.body)), { prompt: 'hi' }); // undefined model is omitted
});
