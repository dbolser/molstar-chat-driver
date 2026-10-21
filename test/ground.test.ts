import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidatesMessage, checkMessage, loadedText, pdbIds, pinTypedIds, searchPhrase, typedIds } from '../supabase/functions/_shared/ground.ts';

test('pdbIds finds the entries a scene downloads, once each, upper-cased', () => {
  const mvsj = JSON.stringify({ root: { children: [
    { kind: 'download', params: { url: 'https://files.rcsb.org/download/1uj7.cif' } },
    { kind: 'download', params: { url: 'https://files.rcsb.org/download/1UJ7.cif' } },
    { kind: 'download', params: { url: 'https://files.rcsb.org/download/4hhb.bcif' } },
  ] } });
  assert.deepEqual(pdbIds(mvsj), ['1UJ7', '4HHB']);
  assert.deepEqual(pdbIds('{"root":{}}'), []);
});

test('the check message states titles and non-existence plainly', () => {
  const m = checkMessage([{ id: '1UDT', title: 'Human PDE5 with Sildenafil' }, { id: '1UJ7', title: null }]);
  assert.match(m, /PDB 1UDT is titled "Human PDE5 with Sildenafil"\./);
  assert.match(m, /PDB 1UJ7 does not exist \(HTTP 404\)\./);
  assert.match(m, /single word OK/);
});

test('searchPhrase reads OK or a SEARCH: phrase, and gives up on anything else', () => {
  assert.equal(searchPhrase('OK'), null);
  assert.equal(searchPhrase('  ok.\n'), null);
  assert.equal(searchPhrase('SEARCH: nanobody GFP complex'), 'nanobody GFP complex');
  assert.equal(searchPhrase('search: PCSK9\nsome trailing chatter'), 'PCSK9');
  assert.equal(searchPhrase('{"root": {"kind": "root"}}'), null);
});

test('candidates and loaded text are one line per entry', () => {
  const hits = [{ id: '6XZF', title: 'Nanobody in complex with eGFP' }, { id: '3K1K', title: 'GFP bound to enhancer nanobody' }];
  assert.match(candidatesMessage('nanobody GFP', hits), /"nanobody GFP":\n6XZF: Nanobody in complex with eGFP\n3K1K: GFP bound/);
  assert.equal(loadedText([...hits, { id: '1UJ7', title: null }]), 'Loaded 6XZF — Nanobody in complex with eGFP\nLoaded 3K1K — GFP bound to enhancer nanobody');
});

test('typedIds reads PDB ids the user spelled out, not plain numbers or ordinals', () => {
  assert.deepEqual(typedIds('load 1hh0'), ['1HH0']);
  assert.deepEqual(typedIds('Load 1HHO and 4hhb side by side, 1hho on the left'), ['1HHO', '4HHB']);
  assert.deepEqual(typedIds('colour the 20th residue of 1ubq at 10am in 2024'), ['1UBQ']);
  assert.deepEqual(typedIds('show hemoglobin'), []);
});

test('pinTypedIds swaps the one id the model chose for the one the user typed', () => {
  const scene = (id: string) => JSON.stringify({ root: { children: [{ kind: 'download', params: { url: `https://files.rcsb.org/download/${id}.cif` } }] } });
  const r = pinTypedIds(scene('1hho'), ['1HH0'], ['1HHO']);
  assert.equal(r.note, 'kept your id 1HH0 (model wrote 1HHO)');
  assert.deepEqual(pdbIds(r.mvsj), ['1HH0']);
  // Already right: untouched.
  assert.equal(pinTypedIds(scene('1hh0'), ['1HH0'], ['1HH0']).note, null);
  // Ambiguous (two typed, two strays): untouched rather than guessed.
  assert.equal(pinTypedIds(scene('1abc'), ['1HH0', '4HHB'], ['1ABC']).note, null);
  // Nothing typed: untouched.
  assert.equal(pinTypedIds(scene('1hho'), [], ['1HHO']).note, null);
});
