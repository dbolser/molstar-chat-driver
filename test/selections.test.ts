import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkScene, checkSelections, describe, isEmpty, parseAtomSite } from '../supabase/functions/_shared/selections.ts';

// A trimmed 1A6M-style `_atom_site` loop: chain A His64 + a bound O2 (OXY), a second model (NMR
// style) that must be ignored, and quoted atom names (O5') that must stay one token.
const CIF = `data_TEST
#
_entry.id TEST
#
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_entity_id
_atom_site.label_seq_id
_atom_site.pdbx_PDB_ins_code
_atom_site.Cartn_x
_atom_site.auth_seq_id
_atom_site.auth_comp_id
_atom_site.auth_asym_id
_atom_site.auth_atom_id
_atom_site.pdbx_PDB_model_num
ATOM   1 N N   HIS A 1 64 ? 1.0 64  HIS A N   1
ATOM   2 N NE2 HIS A 1 64 ? 2.0 64  HIS A NE2 1
ATOM   3 C CA  GLY A 1 65 ? 3.0 65  GLY A CA  1
HETATM 4 O O2  OXY C 3 .  ? 4.0 155 OXY A O2  1
HETATM 5 C "C5'" DA B 2 1 ? 5.0 1 DA B "C5'" 1
ATOM   6 N NE2 HIS A 1 64 ? 2.0 64  HIS Z NE2 2
#
loop_
_struct_conn.id
covale1
#
`;
const atoms = parseAtomSite(CIF);

test('parseAtomSite reads the first model, with quoted tokens kept whole', () => {
  assert.equal(atoms.length, 5);
  assert.deepEqual(
    { ...atoms[3] },
    {
      label_entity_id: '3', label_asym_id: 'C', auth_asym_id: 'A', label_seq_id: '.', auth_seq_id: '155', pdbx_PDB_ins_code: '?',
      label_comp_id: 'OXY', auth_comp_id: 'OXY', label_atom_id: 'O2', auth_atom_id: 'O2', type_symbol: 'O',
    },
  );
  assert.equal(atoms[4].label_atom_id, "C5'");
  assert.equal(atoms.some((a) => a.auth_asym_id === 'Z'), false); // model 2 dropped
  assert.deepEqual(parseAtomSite('data_X\n_entry.id X\n'), []);
});

test('isEmpty follows Mol*: fields AND-ed, ranges inclusive, element case-insensitive', () => {
  assert.equal(isEmpty(atoms, { auth_asym_id: 'A', auth_seq_id: 64, label_atom_id: 'NE2' }), false);
  assert.equal(isEmpty(atoms, { auth_asym_id: 'A', label_comp_id: 'OXY', label_atom_id: 'O2' }), false);
  assert.equal(isEmpty(atoms, { auth_asym_id: 'A', beg_auth_seq_id: 65, end_auth_seq_id: 70 }), false);
  assert.equal(isEmpty(atoms, { type_symbol: 'o' }), false);
  assert.equal(isEmpty(atoms, {}), false);
  assert.equal(isEmpty(atoms, { auth_asym_id: 'B', auth_seq_id: 64 }), true); // wrong chain
  assert.equal(isEmpty(atoms, { auth_asym_id: 'A', auth_seq_id: 64, label_atom_id: 'ne2' }), true); // atom names are exact
  assert.equal(isEmpty(atoms, { beg_label_seq_id: 100 }), true); // OXY's "." is in no range
  assert.equal(isEmpty(atoms, { auth_asym_id: 'Z' }), true); // only in model 2
  assert.equal(isEmpty(atoms, { auth_asym_id: 'Q', atom_id: 7 }), false); // unparsed field: can't judge, assume fine
});

test('describe puts an expression in words', () => {
  assert.equal(describe({ auth_asym_id: 'B', auth_seq_id: 57 }), 'chain B residue 57');
  assert.equal(describe({ auth_asym_id: 'A', label_comp_id: 'HIS', auth_seq_id: 64, label_atom_id: 'NE2' }), 'chain A HIS 64 atom NE2');
  assert.equal(describe({ beg_auth_seq_id: 10, end_auth_seq_id: 20 }), 'residues 10–20');
  assert.equal(describe({ label_comp_id: 'HEM' }), 'HEM');
});

const dist = (start: unknown, end: unknown) => ({ kind: 'primitive', params: { kind: 'distance_measurement', start, end } });
const download = (structureChildren: unknown[], url = 'https://files.rcsb.org/download/1a6m.cif', format = 'mmcif') => ({
  kind: 'download',
  params: { url },
  children: [{ kind: 'parse', params: { format }, children: [{ kind: 'structure', params: { type: 'model' }, children: structureChildren }] }],
});
const structureOf = (d: any) => d.children[0].children[0];

test('a primitive with an endpoint that matches nothing is removed (no line to the origin)', () => {
  const good = dist({ auth_asym_id: 'A', auth_seq_id: 64, label_atom_id: 'NE2' }, { auth_asym_id: 'A', label_comp_id: 'OXY', label_atom_id: 'O2' });
  const bad = dist({ auth_asym_id: 'A', auth_seq_id: 64, label_atom_id: 'NE2' }, { auth_asym_id: 'B', auth_seq_id: 57 });
  const coords = { kind: 'primitive', params: { kind: 'tube', start: [0, 0, 0], end: [1, 1, 1] } };
  const d = download([{ kind: 'primitives', children: [good, bad, coords] }]);
  const r = checkSelections(d, atoms, '1A6M');
  assert.deepEqual(structureOf(d).children[0].children, [good, coords]);
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0], /removed primitive distance_measurement: end/);
  assert.deepEqual(r.messages, ["Couldn't find chain B residue 57 in 1A6M — that part was skipped."]);
});

test('a primitive is kept while any of its {expressions} matches; a group left empty goes', () => {
  const partly = dist({ expressions: [{ auth_asym_id: 'B' }, { auth_asym_id: 'A', auth_seq_id: 65 }] }, [0, 0, 0]);
  const other = dist({ structure_ref: 'other', expressions: [{ auth_asym_id: 'Q' }] }, [0, 0, 0]); // not this structure
  const d = download([
    { kind: 'primitives', children: [partly, other] },
    { kind: 'primitives', children: [{ kind: 'primitive', params: { kind: 'label', position: { auth_asym_id: 'X' }, text: 'x' } }] },
  ]);
  const r = checkSelections(d, atoms, '1A6M');
  assert.deepEqual(structureOf(d).children.map((c: any) => c.children.length), [2]);
  assert.equal(r.notes.length, 1);
});

test('an empty component (or colour selector) is left in place but reported', () => {
  const comp = {
    kind: 'component', params: { selector: [{ auth_asym_id: 'A', auth_seq_id: 64 }, { auth_asym_id: 'C', auth_seq_id: 9 }] },
    children: [{ kind: 'representation', params: { type: 'cartoon' }, children: [{ kind: 'color', params: { color: 'red', selector: { label_comp_id: 'TRP' } } }] }],
  };
  const d = download([comp, { kind: 'component', params: { selector: 'polymer' } }]);
  const before = JSON.stringify(d);
  const r = checkSelections(d, atoms, '1A6M');
  assert.equal(JSON.stringify(d), before);
  assert.deepEqual(r.notes, ['empty selection: component {"auth_asym_id":"C","auth_seq_id":9}', 'empty selection: color {"label_comp_id":"TRP"}']);
  assert.deepEqual(r.messages, [
    "Couldn't find chain C residue 9 in 1A6M — that part was skipped.",
    "Couldn't find TRP in 1A6M — that part was skipped.",
  ]);
});

test('checkScene loads each mmCIF download and skips what it cannot check', async () => {
  const bad = () => dist({ auth_asym_id: 'B', auth_seq_id: 57 }, [0, 0, 0]);
  const root = {
    kind: 'root',
    children: [
      download([{ kind: 'primitives', children: [bad()] }]),
      download([{ kind: 'primitives', children: [bad()] }], 'https://files.rcsb.org/download/4cha.cif'), // load fails
      download([{ kind: 'primitives', children: [bad()] }], 'https://files.rcsb.org/download/1abc.bcif', 'bcif'), // not text mmCIF
    ],
  };
  const asked: string[] = [];
  const r = await checkScene(root, async (url) => {
    asked.push(url);
    if (url.includes('4cha')) throw new Error('timeout');
    return atoms;
  });
  assert.deepEqual(asked, ['https://files.rcsb.org/download/1a6m.cif', 'https://files.rcsb.org/download/4cha.cif']);
  assert.deepEqual(root.children.map((d) => structureOf(d).children.length), [0, 1, 1]);
  assert.deepEqual(r.messages, ["Couldn't find chain B residue 57 in 1A6M — that part was skipped."]);
});
