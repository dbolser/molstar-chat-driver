import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatDriver } from '../src/driver';
import { ChatBackend, ChatResponse, MvsRenderer, ChatTurn } from '../src/types';

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
