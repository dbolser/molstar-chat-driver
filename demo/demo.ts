/**
 * Local demo: a fully playable Mol* chat interface with NO backend and NO API keys.
 *
 * The backend here is a mock that maps your prompt to a real MVS scene built with Mol*'s own
 * builder, so the whole prompt -> scene -> render loop works locally. To use a real model,
 * swap `createMockBackend` for `createHttpBackend('https://your-service/...')` — nothing else
 * changes.
 *
 * Mol* is loaded as the UMD bundle from a CDN (see index.html), exposed as `window.molstar`.
 */
import {
  ChatRequest,
  createMockBackend,
  createUmdRenderer,
  mountChatDriver,
} from '../src/index';

declare global {
  interface Window {
    // The Mol* UMD viewer bundle. Loosely typed; we only touch a few entry points.
    molstar: any;
  }
}

/** A few well-known structures keyed by words you might type. */
const NAMED_ENTRIES: Record<string, string> = {
  hemoglobin: '1hho',
  haemoglobin: '1hho',
  lysozyme: '1lyz',
  insulin: '4ins',
  myoglobin: '1mbn',
  p53: '1tup',
  retinol: '1cbs',
};

function pickEntry(prompt: string): string | null {
  const p = prompt.toLowerCase();
  for (const [name, id] of Object.entries(NAMED_ENTRIES)) {
    if (p.includes(name)) return id;
  }
  // crude 4-character PDB-id detector: a digit followed by three alphanumerics.
  const m = p.match(/\b([0-9][a-z0-9]{3})\b/);
  if (m) return m[1];
  // No structure mentioned, but a clear "show me something" intent -> default to retinol.
  if (/\b(show|render|display|view|load|draw)\b/.test(p)) return '1cbs';
  return null;
}

function pickRepresentation(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes('surface')) return 'surface';
  if (p.includes('spacefill') || p.includes('sphere')) return 'spacefill';
  if (p.includes('ball') || p.includes('stick') || p.includes('atoms')) return 'ball_and_stick';
  return 'cartoon';
}

function pickColor(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes('red')) return '#E8000B';
  if (p.includes('green')) return '#1A9E1A';
  if (p.includes('orange')) return '#FF7F0E';
  if (p.includes('blue')) return '#3050F8';
  return '#3050F8';
}

/** Build a valid MVSJ scene from a prompt using Mol*'s builder, or null if no structure is implied. */
function buildMockMvs(req: ChatRequest): string | null {
  const entry = pickEntry(req.prompt);
  if (!entry) return null;

  const mvs = window.molstar.PluginExtensions.mvs;
  const url = `https://www.ebi.ac.uk/pdbe/entry-files/download/${entry}_updated.cif`;

  const builder = mvs.MVSData.createBuilder();
  builder.canvas({ background_color: 'white' });
  const structure = builder.download({ url }).parse({ format: 'mmcif' }).modelStructure();

  structure
    .component({ selector: 'polymer' })
    .representation({ type: pickRepresentation(req.prompt) })
    .color({ color: pickColor(req.prompt) });

  if (/ligand|drug|heme|haem|bound|cofactor/i.test(req.prompt)) {
    structure
      .component({ selector: 'ligand' })
      .representation({ type: 'ball_and_stick' })
      .color({ color: '#FF7F0E' });
  }

  const state = builder.getState();
  return typeof mvs.MVSData.toMVSJ === 'function' ? mvs.MVSData.toMVSJ(state) : JSON.stringify(state);
}

async function main(): Promise<void> {
  const viewer = await window.molstar.Viewer.create('viewer', {
    layoutIsExpanded: false,
    layoutShowControls: false,
    layoutShowLog: false,
    layoutShowLeftPanel: false,
    viewportShowExpand: true,
  });

  mountChatDriver('chat', {
    backend: createMockBackend(buildMockMvs, {
      latencyMs: 350,
      text: (req) => (pickEntry(req.prompt) ? undefined : 'I could not tell which structure you meant — try naming one, e.g. "lysozyme".'),
    }),
    renderer: createUmdRenderer(window.molstar, viewer),
    onTurn: (t) => console.log('[turn]', t.prompt, '→', t.rendered ? 'rendered' : t.response.mvsj ? 'render failed' : 'no scene'),
    placeholder: 'e.g. "show hemoglobin as cartoon coloured blue, with its ligands"',
    welcome: 'Type a request to build a molecular scene. Try “lysozyme surface in green” or “4ins as ball and stick”.',
  });
}

void main();
