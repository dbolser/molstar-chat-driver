import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toResult, buildKeywordMvs, pickEntry } from '../demo/server.mjs';

test('toResult accepts bare MVSJ', () => {
  const r = toResult('{"root":{"kind":"root"}}');
  assert.equal(r.mvsj, '{"root":{"kind":"root"}}');
  assert.equal(r.text, undefined);
});

test('toResult unwraps a ```json fenced reply', () => {
  const r = toResult('```json\n{"root":{"kind":"root"}}\n```');
  assert.ok(r.mvsj);
  assert.deepEqual(JSON.parse(r.mvsj as string), { root: { kind: 'root' } });
});

test('toResult unwraps a bare ``` fenced reply', () => {
  const r = toResult('```\n{"a":1}\n```');
  assert.ok(r.mvsj);
  assert.deepEqual(JSON.parse(r.mvsj as string), { a: 1 });
});

test('toResult recovers JSON wrapped in prose', () => {
  const r = toResult('Here is the scene you asked for: {"a":1} — enjoy!');
  assert.ok(r.mvsj);
  assert.deepEqual(JSON.parse(r.mvsj as string), { a: 1 });
});

test('toResult falls back to chat text when there is no JSON', () => {
  const r = toResult('I could not build a scene for that.');
  assert.equal(r.mvsj, null);
  assert.equal(r.text, 'I could not build a scene for that.');
});

test('keyword mode maps a named structure to a valid MVSJ scene', () => {
  const mvsj = buildKeywordMvs('show hemoglobin as cartoon');
  assert.ok(mvsj);
  const scene = JSON.parse(mvsj as string);
  assert.equal(scene.root.kind, 'root');
  assert.match(mvsj as string, /1hho_updated\.cif/); // hemoglobin → 1hho
});

test('pickEntry resolves names, PDB ids, and bare display verbs', () => {
  assert.equal(pickEntry('show me lysozyme'), '1lyz');
  assert.equal(pickEntry('load 4ins please'), '4ins');
  assert.equal(pickEntry('just chatting, no structure'), null);
});
