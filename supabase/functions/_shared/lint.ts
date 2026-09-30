// Scene lint — deterministic fixes for the small, recurring ways a model's MVS tree fails Mol*'s
// validation. Each fix is a thing we saw in the captured `turns`, not a guess. The tree is edited
// in place and a list of what changed is returned (stored on the turn, so the benchmark can tell a
// first-try scene from a rescued one — same idea as `repaired`).
//
// No dependencies, so it can be unit-tested with the plugin's node test runner.

type Node = { kind?: unknown; params?: Record<string, unknown>; children?: unknown; custom?: Record<string, unknown> };

// Colour *schemes* a model writes where a colour belongs ("spectrum", "secondaryStructure"…).
// MVS has no scheme colours, but Mol* honours `custom.molstar_color_theme_name` on a `color`
// node (its `load-helpers` reads it from the representation's single colour child), so the
// intent survives instead of the whole scene failing.
const THEMES: Record<string, string> = {
  spectrum: 'sequence-id', rainbow: 'sequence-id', sequence: 'sequence-id', sequenceid: 'sequence-id',
  residueindex: 'sequence-id', chainbow: 'sequence-id',
  chain: 'chain-id', chainid: 'chain-id', bychain: 'chain-id',
  secondarystructure: 'secondary-structure', ss: 'secondary-structure',
  element: 'element-symbol', elementsymbol: 'element-symbol', cpk: 'element-symbol', atom: 'element-symbol',
};

// Mol*'s accepted colour names (its `ColorNames` table): CSS names plus a few X11 extras.
const COLOR_NAMES = new Set(
  ('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown ' +
    'burlywood cadetblue chartreuse chocolate coral cornflower cornflowerblue cornsilk crimson cyan darkblue ' +
    'darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange ' +
    'darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise ' +
    'darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia ' +
    'gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory ' +
    'khaki laserlemon lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrod lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon ' +
    'maroon2 maroon3 mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue ' +
    'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite ' +
    'navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred ' +
    'papayawhip peachpuff peru pink plum powderblue purple purple2 purple3 rebeccapurple red rosybrown ' +
    'royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray ' +
    'slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke ' +
    'yellow yellowgreen').split(' '),
);
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

// Where a node may sit, for the misplacements we have actually seen.
const FOCUS_PARENTS = new Set([
  'root', 'component', 'component_from_uri', 'component_from_source',
  'primitives', 'primitives_from_uri', 'volume', 'volume_representation',
]);

const isNode = (v: unknown): v is Node => !!v && typeof v === 'object' && !Array.isArray(v);
const kids = (n: Node): Node[] => (Array.isArray(n.children) ? n.children.filter(isNode) : []);

function findAll(n: Node, kind: string, out: Node[] = []): Node[] {
  if (n.kind === kind) out.push(n);
  for (const c of kids(n)) findAll(c, kind, out);
  return out;
}

/** Fix a colour node in place. Returns a note, or null if nothing changed. */
function fixColor(color: Node, parent: Node): string | null {
  const raw = color.params?.color;
  if (typeof raw !== 'string') return null;
  if (HEX.test(raw) || COLOR_NAMES.has(raw)) return null;
  const squashed = raw.toLowerCase().replace(/[^a-z0-9#]/g, ''); // "Light Blue" → "lightblue"
  const fixed = /^[0-9a-f]{3}$|^[0-9a-f]{6}$/.test(squashed) ? `#${squashed}` : squashed; // "ff0000"
  if (HEX.test(fixed) || COLOR_NAMES.has(fixed)) {
    color.params!.color = fixed;
    return `color "${raw}" → "${fixed}"`;
  }
  const theme = THEMES[squashed.replace(/^(by|colou?r)/, '')];
  if (theme) {
    // Keep the node (Mol* needs a valid `color` param); the theme overrides it.
    color.params!.color = 'gray';
    color.custom = { ...(color.custom ?? {}), molstar_color_theme_name: theme };
    return `color "${raw}" → theme "${theme}"`;
  }
  // Unknown colour: better a default-coloured scene than no scene.
  parent.children = kids(parent).filter((c) => c !== color);
  return `dropped unknown color "${raw}"`;
}

/**
 * Repair the recurring validation failures in a model-produced MVS tree. Mutates `root`;
 * returns one note per change (empty when the tree was already fine).
 */
export function lintScene(root: Node): string[] {
  const notes: string[] = [];
  const structures = findAll(root, 'structure');

  // Colour names / schemes (walk parent+child pairs so a node can be replaced in its parent).
  const walk = (n: Node) => {
    for (const c of kids(n)) {
      if (c.kind === 'color') {
        const note = fixColor(c, n);
        if (note) notes.push(note);
      }
      walk(c);
    }
  };
  walk(root);

  // Nodes hung off the wrong parent. `component` belongs under `structure`; `focus` under a
  // component (the enclosing one, else the parent's only one) or root. Only re-parent when the
  // target is unambiguous. A moved subtree is visited right after the move (it may hold further
  // misplacements) and never twice.
  const visited = new Set<Node>();
  const reparent = (parent: Node, ancestors: Node[]) => {
    if (visited.has(parent)) return;
    visited.add(parent);
    for (const c of kids(parent)) {
      if (c.kind === 'component' && parent.kind !== 'structure' && structures.length === 1) {
        parent.children = kids(parent).filter((x) => x !== c);
        structures[0].children = [...kids(structures[0]), c];
        notes.push(`moved component from "${parent.kind}" to structure`);
      } else if (c.kind === 'focus' && !FOCUS_PARENTS.has(String(parent.kind))) {
        const enclosing = [...ancestors].reverse().find((n) => n.kind === 'component');
        const comps = kids(parent).filter((x) => x.kind === 'component');
        const target = enclosing ?? (comps.length === 1 ? comps[0] : root);
        parent.children = kids(parent).filter((x) => x !== c);
        target.children = [...kids(target), c];
        notes.push(`moved focus from "${parent.kind}" to ${target === root ? 'root' : 'component'}`);
      }
      reparent(c, [...ancestors, parent]);
    }
  };
  reparent(root, []);

  return notes;
}
