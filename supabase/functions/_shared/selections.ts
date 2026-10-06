// Empty-selection check — does each atom selection in a scene match anything in its structure?
//
// Models often pick a wrong chain, residue number or atom name. Mol* does not treat a selection
// that matches nothing as an error: a component just draws nothing, and a primitive endpoint
// silently becomes (0,0,0), so a distance line is drawn to the origin. So: parse the structure's
// `_atom_site` and resolve every ComponentExpression against it. A primitive with an endpoint that
// matches nothing is removed; an empty component (or colour selector) is left but reported.
//
// Pure (no fetching) and dependency-free, so it unit-tests with the plugin's node test runner.
// Matching follows Mol*'s MVS selections: fields in one expression are AND-ed, a list is OR-ed.
import { pdbIds } from './ground.ts';

type Node = { kind?: unknown; params?: Record<string, unknown>; children?: unknown };
type Expr = Record<string, unknown>;

/** The `_atom_site` columns a ComponentExpression can test (first model only). */
export type Atom = Record<(typeof COLUMNS)[number], string>;
const COLUMNS = [
  'label_entity_id', 'label_asym_id', 'auth_asym_id', 'label_seq_id', 'auth_seq_id', 'pdbx_PDB_ins_code',
  'label_comp_id', 'auth_comp_id', 'label_atom_id', 'auth_atom_id', 'type_symbol',
] as const;

// CIF tokens: a quoted value only ends at a quote followed by whitespace ("O5'" stays one token).
const TOKEN = /'(.*?)'(?=\s|$)|"(.*?)"(?=\s|$)|(\S+)/g;

/** Minimal mmCIF `_atom_site` loop parse. Empty when the file has none (e.g. not mmCIF). */
export function parseAtomSite(cif: string): Atom[] {
  const lines = cif.split(/\r?\n/);
  let i = lines.findIndex((l, j) => l.trim() === 'loop_' && lines[j + 1]?.trim().startsWith('_atom_site.'));
  if (i === -1) return [];
  const cols: string[] = [];
  for (i++; i < lines.length && lines[i].trim().startsWith('_atom_site.'); i++) cols.push(lines[i].trim().slice(11));
  const at = Object.fromEntries([...COLUMNS, 'pdbx_PDB_model_num'].map((c) => [c, cols.indexOf(c)]));
  const atoms: Atom[] = [];
  let row: string[] = [];
  let model: string | undefined;
  for (; i < lines.length; i++) {
    const l = lines[i];
    const t = l.trimStart();
    if (t.startsWith('#') || t.startsWith('_') || t.startsWith('loop_') || t.startsWith('data_')) break;
    for (const m of l.matchAll(TOKEN)) {
      row.push(m[1] ?? m[2] ?? m[3]);
      if (row.length < cols.length) continue;
      const num = at.pdbx_PDB_model_num === -1 ? '' : row[at.pdbx_PDB_model_num];
      model ??= num;
      if (num === model) atoms.push(Object.fromEntries(COLUMNS.map((c) => [c, at[c] === -1 ? '?' : row[at[c]]])) as Atom);
      row = [];
    }
  }
  return atoms;
}

const STR = new Set(['label_entity_id', 'label_asym_id', 'auth_asym_id', 'pdbx_PDB_ins_code', 'label_comp_id', 'auth_comp_id', 'label_atom_id', 'auth_atom_id']);
const NUM = new Set(['label_seq_id', 'auth_seq_id']);
const RANGE: Record<string, [string, 1 | -1]> = {
  beg_label_seq_id: ['label_seq_id', 1], end_label_seq_id: ['label_seq_id', -1],
  beg_auth_seq_id: ['auth_seq_id', 1], end_auth_seq_id: ['auth_seq_id', -1],
};

const isExpr = (v: unknown): v is Expr => !!v && typeof v === 'object' && !Array.isArray(v);

/** Can we judge this expression? Fields we don't parse (atom_id, instance_id…) → assume it matches. */
const checkable = (e: Expr) => Object.keys(e).every((k) => STR.has(k) || NUM.has(k) || k in RANGE || k === 'type_symbol');

function atomMatches(a: Atom, e: Expr): boolean {
  for (const [k, v] of Object.entries(e)) {
    if (v == null) continue;
    if (STR.has(k) && a[k as keyof Atom] !== String(v)) return false;
    if (NUM.has(k) && Number(a[k as keyof Atom]) !== Number(v)) return false;
    if (k === 'type_symbol' && a.type_symbol.toUpperCase() !== String(v).toUpperCase()) return false;
    if (k in RANGE) {
      const [col, sign] = RANGE[k];
      const n = Number(a[col as keyof Atom]); // "." (no label_seq_id) is NaN: never in range
      if (!(sign * (n - Number(v)) >= 0)) return false;
    }
  }
  return true;
}

/** Hosts we will download a structure from. The URL comes from model output, so anything else
 *  (a private address, an arbitrary endpoint) is never fetched. */
const STRUCTURE_HOSTS = new Set(['files.rcsb.org', 'models.rcsb.org', 'www.ebi.ac.uk', 'alphafold.ebi.ac.uk']);

export function isStructureUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && STRUCTURE_HOSTS.has(u.hostname) && !u.username && !u.password && !u.port;
  } catch {
    return false;
  }
}

/** At most this many structures are checked per scene, one at a time (each parse is held in memory),
 *  all within one scene-wide time budget so a stalled host can't stack timeouts. */
const MAX_CHECKED_STRUCTURES = 3;
const SCENE_BUDGET_MS = 8000;

/** True when the expression is known to select no atom. */
export function isEmpty(atoms: Atom[], e: Expr): boolean {
  return checkable(e) && !atoms.some((a) => atomMatches(a, e));
}

/** "chain B residue 57 atom NE2" — the expression in words, for the user. */
export function describe(e: Expr): string {
  const parts: string[] = [];
  if (e.auth_asym_id != null) parts.push(`chain ${e.auth_asym_id}`);
  if (e.label_asym_id != null) parts.push(`chain ${e.label_asym_id} (label)`);
  const comp = e.label_comp_id ?? e.auth_comp_id;
  const seq = e.auth_seq_id ?? e.label_seq_id;
  const beg = e.beg_auth_seq_id ?? e.beg_label_seq_id;
  const end = e.end_auth_seq_id ?? e.end_label_seq_id;
  if (seq != null) parts.push(`${comp ?? 'residue'} ${seq}`);
  else if (beg != null || end != null) parts.push(`residues ${beg ?? '…'}–${end ?? '…'}`);
  else if (comp != null) parts.push(String(comp));
  const atom = e.label_atom_id ?? e.auth_atom_id;
  if (atom != null) parts.push(`atom ${atom}`);
  if (e.type_symbol != null) parts.push(`element ${e.type_symbol}`);
  return parts.join(' ') || 'the selection';
}

// Primitive params that hold a position: [x,y,z], a ComponentExpression, or {expressions: [...]}.
const POSITIONS = ['start', 'end', 'position', 'a', 'b', 'c', 'center', 'major_axis_endpoint', 'minor_axis_endpoint'];

/** The expressions a position resolves through, or null when it can't be checked here. */
function positionExprs(p: unknown): Expr[] | null {
  if (!isExpr(p)) return null; // a coordinate (or absent)
  if (!('expressions' in p)) return [p];
  if (p.structure_ref != null || !Array.isArray(p.expressions)) return null; // another structure's atoms
  return p.expressions.filter(isExpr);
}

const isNode = (v: unknown): v is Node => !!v && typeof v === 'object' && !Array.isArray(v);
const kids = (n: Node): Node[] => (Array.isArray(n.children) ? n.children.filter(isNode) : []);
const short = (v: unknown) => JSON.stringify(v).slice(0, 200);

/**
 * Check the selections under one `download` node against its structure's atoms. Mutates the
 * subtree (drops primitives that would point at the origin); returns notes for the turn record
 * and plain messages for the user. `pdb` names the entry in messages ("4CHA").
 */
export function checkSelections(download: Node, atoms: Atom[], pdb: string): { notes: string[]; messages: string[] } {
  const notes: string[] = [];
  const messages = new Set<string>();
  const missed = (e: Expr) => messages.add(`Couldn't find ${describe(e)} in ${pdb} — that part was skipped.`);

  // `scope` is what a colour selector can reach: Mol* applies it within the enclosing component.
  const walk = (n: Node, scope: Atom[]) => {
    for (const c of kids(n)) {
      const sel = c.params?.selector;
      let inner = scope;
      if ((c.kind === 'component' || c.kind === 'color') && sel != null && typeof sel !== 'string') {
        const exprs = (Array.isArray(sel) ? sel : [sel]).filter(isExpr);
        const empty = exprs.filter((e) => isEmpty(scope, e));
        if (empty.length) {
          notes.push(`empty selection: ${c.kind} ${short(empty.length === 1 ? empty[0] : empty)}`);
          empty.forEach(missed);
        }
        // Narrow to the component's atoms (unless it has a field we can't judge, or matched nothing:
        // an empty component is already reported, so don't report its colours again).
        if (c.kind === 'component' && exprs.every(checkable)) {
          const hit = scope.filter((a) => exprs.some((e) => atomMatches(a, e)));
          if (hit.length) inner = hit;
        }
      }
      if (c.kind === 'primitive') {
        for (const key of POSITIONS) {
          const exprs = positionExprs(c.params?.[key]);
          if (!exprs || !exprs.every((e) => isEmpty(atoms, e))) continue;
          // Every expression is empty: Mol* would put this end at (0,0,0). Drop the primitive.
          n.children = kids(n).filter((x) => x !== c);
          notes.push(`removed primitive ${String(c.params?.kind)}: ${key} ${short(c.params?.[key])} matches no atom`);
          exprs.forEach(missed);
          break;
        }
      }
      walk(c, inner);
    }
    // A primitives group left with no shapes has nothing to draw.
    for (const c of kids(n)) {
      if (c.kind === 'primitives' && Array.isArray(c.children) && kids(c).length === 0) {
        n.children = kids(n).filter((x) => x !== c);
      }
    }
  };
  walk(download, atoms);
  return { notes, messages: [...messages] };
}

/**
 * Check every mmCIF structure in a scene. `load(url)` fetches + parses one structure's atoms, or
 * returns null to skip it (fetch failed, too big…) — the fetch lives at the edge, not here.
 * Mutates `root`; returns what changed (notes) and what to tell the user (messages).
 */
export async function checkScene(
  root: Node,
  load: (url: string, timeoutMs: number) => Promise<Atom[] | null>,
  budgetMs = SCENE_BUDGET_MS,
): Promise<{ notes: string[]; messages: string[] }> {
  // Only text mmCIF from a known host, read as its first model (the parser keeps model 1 only).
  const firstModel = (d: Node) => kids(d).every((p) => kids(p).every((s) => !s.params?.model_index));
  const downloads = kids(root).filter(
    (d) => d.kind === 'download' && typeof d.params?.url === 'string' && isStructureUrl(d.params.url) &&
      kids(d).some((p) => p.kind === 'parse' && p.params?.format === 'mmcif') && firstModel(d),
  ).slice(0, MAX_CHECKED_STRUCTURES);
  const notes: string[] = [];
  const messages: string[] = [];
  const deadline = Date.now() + budgetMs;
  for (const d of downloads) { // one at a time, so only one parsed structure is held at once
    const left = deadline - Date.now();
    if (left <= 0) break; // out of time: leave the rest as the model wrote them
    const atoms = await load(d.params!.url as string, left).catch(() => null);
    if (!atoms?.length) continue; // couldn't check — leave the scene as the model wrote it
    const r = checkSelections(d, atoms, pdbIds(d.params!.url as string)[0] ?? 'the structure');
    notes.push(...r.notes);
    messages.push(...r.messages);
  }
  return { notes, messages };
}
