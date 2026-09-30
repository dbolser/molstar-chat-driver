import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintScene } from '../supabase/functions/_shared/lint.ts';

// Shapes copied from real failures in the captured `turns` (see the 2026-09-30 debugging pass).
const color = (c: string) => ({ kind: 'color', params: { color: c } });
const rep = (children: unknown[] = [], extra = {}) => ({ kind: 'representation', params: { type: 'cartoon' }, children, ...extra });
const scene = (structureChildren: unknown[], extraStructureSiblings: unknown[] = [], rootExtra: unknown[] = []) => ({
  kind: 'root',
  children: [
    {
      kind: 'download',
      params: { url: 'https://files.rcsb.org/download/1ubq.cif' },
      children: [
        {
          kind: 'parse',
          params: { format: 'mmcif' },
          children: [{ kind: 'structure', params: { type: 'model' }, children: structureChildren }, ...extraStructureSiblings],
        },
      ],
    },
    ...rootExtra,
  ],
});
const firstRep = (root: any) => root.children[0].children[0].children[0].children[0].children[0];

test('a valid scene is left untouched', () => {
  const root = scene([{ kind: 'component', params: { selector: 'polymer' }, children: [rep([color('red')])] }]);
  const before = JSON.stringify(root);
  assert.deepEqual(lintScene(root), []);
  assert.equal(JSON.stringify(root), before);
});

// Mol* reads `molstar_color_theme_name` from the representation's single colour child (its
// `load-helpers`), so the colour node must survive with a valid placeholder colour.
test('"spectrum" becomes the sequence-id theme on the colour node', () => {
  const root = scene([{ kind: 'component', params: { selector: 'polymer' }, children: [rep([color('spectrum')])] }]);
  const notes = lintScene(root);
  assert.equal(notes.length, 1);
  const r = firstRep(root);
  assert.equal(r.custom, undefined);
  assert.equal(r.children.length, 1);
  assert.equal(r.children[0].custom.molstar_color_theme_name, 'sequence-id');
  assert.equal(r.children[0].params.color, 'gray');
});

test('camelCase scheme names map to their Mol* themes', () => {
  for (const [name, theme] of [['secondaryStructure', 'secondary-structure'], ['elementSymbol', 'element-symbol'], ['byChain', 'chain-id']]) {
    const root = scene([{ kind: 'component', params: { selector: 'polymer' }, children: [rep([color(name)])] }]);
    lintScene(root);
    assert.equal(firstRep(root).children[0].custom.molstar_color_theme_name, theme, name);
  }
});

test('colour names are normalised to what Mol* accepts', () => {
  for (const [given, want] of [['Light Blue', 'lightblue'], ['ff0000', '#ff0000'], ['#ABC', '#ABC']]) {
    const root = scene([{ kind: 'component', params: { selector: 'polymer' }, children: [rep([color(given)])] }]);
    lintScene(root);
    assert.equal(firstRep(root).children[0].params.color, want, given);
  }
});

test('an unknown colour is dropped rather than failing the scene', () => {
  const root = scene([{ kind: 'component', params: { selector: 'polymer' }, children: [rep([color('sort of mauve')])] }]);
  const notes = lintScene(root);
  assert.match(notes[0], /dropped/);
  assert.deepEqual(firstRep(root).children, []);
});

test('focus under structure moves to the only component', () => {
  const comp = { kind: 'component', params: { selector: 'ligand' }, children: [rep()] };
  const root = scene([comp, { kind: 'focus' }]);
  const notes = lintScene(root);
  assert.equal(notes.length, 1);
  const structure = root.children[0].children[0].children[0];
  assert.deepEqual(structure.children.map((c: any) => c.kind), ['component']);
  assert.equal(comp.children.at(-1)?.kind, 'focus');
});

test('focus under structure with several components moves to root', () => {
  const c = () => ({ kind: 'component', params: { selector: 'polymer' }, children: [rep()] });
  const root = scene([c(), c(), { kind: 'focus' }]);
  lintScene(root);
  assert.equal(root.children.at(-1)?.kind, 'focus');
});

test('focus under a valid non-component parent is left alone', () => {
  for (const kind of ['root', 'primitives', 'volume', 'volume_representation', 'primitives_from_uri']) {
    const root = { kind: 'root', children: [kind === 'root' ? { kind: 'focus' } : { kind, children: [{ kind: 'focus' }] }] };
    const before = JSON.stringify(root);
    assert.deepEqual(lintScene(root), [], kind);
    assert.equal(JSON.stringify(root), before, kind);
  }
});

test('a moved component is itself linted (structure listed before the stray component)', () => {
  const stray = { kind: 'component', params: { selector: 'ligand' }, children: [rep([color('spectrum'), { kind: 'focus' }])] };
  const root = scene([], [stray]);
  const notes = lintScene(root);
  assert.equal(notes.length, 3, notes.join('; '));
  const structure = root.children[0].children[0].children[0];
  assert.equal(structure.children[0], stray);
  const r = stray.children[0] as any;
  assert.deepEqual(r.children.map((c: any) => c.kind), ['color']); // focus moved off the representation…
  assert.equal(stray.children.at(-1)?.kind, 'focus'); // …onto its component
});

test('a component under parse or root moves under the single structure', () => {
  const stray = { kind: 'component', params: { selector: 'polymer' }, children: [rep()] };
  const root = scene([], [stray]);
  lintScene(root);
  const parse = root.children[0].children[0];
  assert.deepEqual(parse.children.map((c: any) => c.kind), ['structure']);
  assert.equal(parse.children[0].children[0], stray);

  const stray2 = { kind: 'component', params: { selector: 'ligand' }, children: [rep()] };
  const root2 = scene([], [], [stray2]);
  lintScene(root2);
  assert.deepEqual(root2.children.map((c: any) => c.kind), ['download']);
  assert.equal(root2.children[0].children[0].children[0].children[0], stray2);
});
