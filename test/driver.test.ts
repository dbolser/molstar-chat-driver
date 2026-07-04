import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatDriver } from '../src/driver';
import { ChatBackend, ChatRequest, ChatResponse, MvsRenderer, ChatTurn } from '../src/types';

/** Backend that records every request it receives and returns a distinct scene per call. */
const spyBackend = (): { reqs: ChatRequest[]; backend: ChatBackend } => {
  const reqs: ChatRequest[] = [];
  return {
    reqs,
    backend: {
      async run(req) {
        reqs.push(req);
        return { mvsj: `scene-${reqs.length}` };
      },
    },
  };
};

const backendOf = (response: ChatResponse): ChatBackend => ({
  async run() {
    return response;
  },
});

const okRenderer = (): MvsRenderer => ({ async loadMvsj() {} });
const failingRenderer = (err: unknown): MvsRenderer => ({
  async loadMvsj() {
    throw err;
  },
});

test('renders when the backend returns a scene', async () => {
  const driver = new ChatDriver({ backend: backendOf({ mvsj: '{}' }), renderer: okRenderer() });
  const turn = await driver.submit('show lysozyme');
  assert.equal(turn.rendered, true);
  assert.equal(turn.renderError, undefined);
  assert.equal(turn.prompt, 'show lysozyme');
});

test('captures the render error instead of throwing when Mol* rejects the scene', async () => {
  const boom = new Error('invalid MVS');
  const driver = new ChatDriver({ backend: backendOf({ mvsj: '{}' }), renderer: failingRenderer(boom) });
  const turn = await driver.submit('bad scene');
  assert.equal(turn.rendered, false);
  assert.equal(turn.renderError, boom);
  assert.equal(turn.response.mvsj, '{}'); // response is preserved for the UI
});

test('does not attempt to render when there is no scene', async () => {
  let called = false;
  const renderer: MvsRenderer = {
    async loadMvsj() {
      called = true;
    },
  };
  const driver = new ChatDriver({ backend: backendOf({ mvsj: null, error: 'no key' }), renderer });
  const turn = await driver.submit('hello');
  assert.equal(called, false);
  assert.equal(turn.rendered, false);
  assert.equal(turn.renderError, undefined);
  assert.equal(turn.response.error, 'no key');
});

test('onTurn observes the completed turn', async () => {
  const seen: ChatTurn[] = [];
  const driver = new ChatDriver({
    backend: backendOf({ mvsj: '{}' }),
    renderer: okRenderer(),
    onTurn: (t) => seen.push(t),
  });
  const turn = await driver.submit('show insulin', 'anthropic:claude-haiku-4-5');
  assert.equal(seen.length, 1);
  assert.equal(seen[0], turn);
  assert.equal(seen[0].model, 'anthropic:claude-haiku-4-5');
});

test('a throwing observer does not corrupt a turn that already rendered', async () => {
  const driver = new ChatDriver({
    backend: backendOf({ mvsj: '{}' }),
    renderer: okRenderer(),
    onTurn: () => {
      throw new Error('observer blew up');
    },
  });
  const turn = await driver.submit('show p53'); // must resolve, not reject
  assert.equal(turn.rendered, true);
});

test('replays scene context (history) on follow-up prompts, in one session', async () => {
  const { reqs, backend } = spyBackend();
  const driver = new ChatDriver({ backend, renderer: okRenderer() });
  await driver.submit('show hemoglobin');
  await driver.submit('colour the oxygen red');
  assert.equal(reqs[0].history, undefined); // first turn carries no context
  assert.deepEqual(reqs[1].history, [{ prompt: 'show hemoglobin', mvsj: 'scene-1' }]);
  assert.ok(reqs[0].sessionId && reqs[0].sessionId === reqs[1].sessionId); // same scene session
});

test('reset() clears the context and starts a new session', async () => {
  const { reqs, backend } = spyBackend();
  const driver = new ChatDriver({ backend, renderer: okRenderer() });
  await driver.submit('a');
  const first = reqs[0].sessionId;
  driver.reset();
  await driver.submit('b');
  assert.equal(reqs[1].history, undefined); // context cleared
  assert.notEqual(reqs[1].sessionId, first); // fresh session id
});

test('slides the context window to maxContextTurns', async () => {
  const { reqs, backend } = spyBackend();
  const driver = new ChatDriver({ backend, renderer: okRenderer(), maxContextTurns: 2 });
  await driver.submit('one');
  await driver.submit('two');
  await driver.submit('three');
  assert.deepEqual(reqs[2].history?.map((h) => h.prompt), ['one', 'two']);
  await driver.submit('four');
  assert.deepEqual(reqs[3].history?.map((h) => h.prompt), ['two', 'three']); // oldest dropped
});

test('maxContextTurns:0 disables context entirely', async () => {
  const { reqs, backend } = spyBackend();
  const driver = new ChatDriver({ backend, renderer: okRenderer(), maxContextTurns: 0 });
  await driver.submit('a');
  await driver.submit('b');
  assert.equal(reqs[1].history, undefined);
});

test('onContextChange reports size (turns since reset) and max', async () => {
  const seen: { size: number; max: number }[] = [];
  const { backend } = spyBackend();
  const driver = new ChatDriver({
    backend,
    renderer: okRenderer(),
    maxContextTurns: 5,
    onContextChange: (i) => seen.push(i),
  });
  await driver.submit('a');
  await driver.submit('b');
  assert.deepEqual(seen.at(-1), { size: 2, max: 5 });
  driver.reset();
  assert.deepEqual(seen.at(-1), { size: 0, max: 5 });
});
