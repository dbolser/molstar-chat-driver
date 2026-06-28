import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toResult, buildKeywordMvs, pickEntry, availableModels } from '../demo/server.mjs';

/** Build a fake env lookup from a plain object, mirroring server.mjs's env() shape. */
const lookupFrom = (vars: Record<string, string>) => (name: string) => vars[name];

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

test('pickEntry does not mistake a bare number for a PDB id', () => {
  assert.equal(pickEntry('tell me about the year 2024'), null); // not a structure id
  assert.equal(pickEntry('what happened in 1999'), null);
  assert.equal(pickEntry('show me the 2024 cryo-EM model'), '1cbs'); // falls back via "show"
});

test('availableModels lists one model per configured non-OpenRouter key', () => {
  const models = availableModels(lookupFrom({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' }));
  assert.deepEqual(models, ['anthropic:claude-haiku-4-5', 'gemini:gemini-2.5-flash']);
});

test('availableModels expands an explicit OpenRouter allow-list', () => {
  const models = availableModels(
    lookupFrom({ OPENROUTER_API_KEY: 'k', OPENROUTER_ALLOWED_MODELS: 'a/b, c/d' }),
  );
  assert.deepEqual(models, ['openrouter:a/b', 'openrouter:c/d']);
});

test('availableModels falls back to default open models for OpenRouter', () => {
  const models = availableModels(lookupFrom({ OPENROUTER_API_KEY: 'k' }));
  assert.ok(models.length >= 2);
  assert.ok(models.every((m) => m.startsWith('openrouter:')));
});

test('availableModels is empty when no keys are configured', () => {
  assert.deepEqual(availableModels(() => undefined), []);
});
