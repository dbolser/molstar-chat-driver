import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { buildKeywordMvs, pickEntry, handleChat, startChatServer } from '../demo/server.mjs';

test('keyword mode maps a named structure to a valid MVSJ scene', () => {
  const mvsj = buildKeywordMvs('show hemoglobin as cartoon');
  assert.ok(mvsj);
  const scene = JSON.parse(mvsj as string);
  assert.equal(scene.root.kind, 'root');
  assert.match(mvsj as string, /1hho_updated\.cif/); // hemoglobin → 1hho
});

test('keyword mode reflects representation and colour keywords', () => {
  const scene = JSON.parse(buildKeywordMvs('lysozyme surface in green') as string);
  const json = JSON.stringify(scene);
  assert.match(json, /1lyz_updated\.cif/);
  assert.match(json, /"type":"surface"/);
  assert.match(json, /#1A9E1A/); // green
});

test('pickEntry resolves names, PDB ids, and bare display verbs', () => {
  assert.equal(pickEntry('show me lysozyme'), '1lyz');
  assert.equal(pickEntry('load 4ins please'), '4ins');
  assert.equal(pickEntry('just chatting, no structure'), null);
});

test('pickEntry does not mistake a bare number for a PDB id', () => {
  assert.equal(pickEntry('tell me about the year 2024'), null);
  assert.equal(pickEntry('what happened in 1999'), null);
  assert.equal(pickEntry('show me the 2024 cryo-EM model'), '1cbs'); // falls back via "show"
});

test('handleChat returns a scene for a structure and guidance otherwise', () => {
  assert.ok(handleChat('show insulin').mvsj);
  const miss = handleChat('hello there');
  assert.equal(miss.mvsj, null);
  assert.match(miss.text as string, /Keyword mode/);
});

test('the server speaks the contract over HTTP', async () => {
  const server = startChatServer({ port: 0 });
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const base = `http://localhost:${port}`;
  try {
    const models = await (await fetch(`${base}/models`)).json();
    assert.deepEqual(models, { models: ['keyword'], default: 'keyword' });

    const hit = await (
      await fetch(`${base}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'lysozyme surface in green' }),
      })
    ).json();
    assert.ok(hit.mvsj);

    const miss = await (
      await fetch(`${base}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hello there' }),
      })
    ).json();
    assert.equal(miss.mvsj, null);
    assert.ok(miss.text);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
