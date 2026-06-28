/**
 * Local demo: a fully playable chat-driver with NO backend and NO API keys.
 *
 * The "model" here is a mock endpoint that maps your prompt to a real MVS scene built with
 * Mol*'s own builder — so the entire prompt -> MVS -> render -> rate -> capture loop works
 * exactly as it will in production. Swap `createMockEndpoint` for `createHttpEndpoint(<url>)`
 * (pointing at a Supabase function) and nothing else changes.
 *
 * Mol* itself is loaded as the UMD bundle from a CDN (see index.html), exposed as
 * `window.molstar`.
 */
import {
  consoleCaptureSink,
  createMockEndpoint,
  createUmdRenderer,
  EndpointRequest,
  mountChatDriver,
} from '../src/index';

declare global {
  interface Window {
    // The Mol* UMD viewer bundle. Loosely typed; we only touch a few entry points.
    molstar: any;
  }
}

/** A few well-known structures keyed by words an evaluator might type. */
const NAMED_ENTRIES: Record<string, string> = {
  hemoglobin: '1hho',
  haemoglobin: '1hho',
  lysozyme: '1lyz',
  insulin: '4ins',
  myoglobin: '1mbn',
  p53: '1tup',
  retinol: '1cbs',
};

function pickEntry(prompt: string): string {
  const p = prompt.toLowerCase();
  for (const [name, id] of Object.entries(NAMED_ENTRIES)) {
    if (p.includes(name)) return id;
  }
  // crude 4-character PDB-id detector: a digit followed by three alphanumerics.
  const m = p.match(/\b([0-9][a-z0-9]{3})\b/);
  return m ? m[1] : '1cbs';
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

/** Build a valid MVSJ scene from a prompt using Mol*'s builder. Returns null to simulate a Tier-0 fail. */
function buildMockMvs(req: EndpointRequest): string | null {
  if (/\b(break|fail|gibberish|nonsense)\b/i.test(req.prompt)) return null;

  const mvs = window.molstar.PluginExtensions.mvs;
  const entry = pickEntry(req.prompt);
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
    endpoint: createMockEndpoint(buildMockMvs, { latencyMs: 350 }),
    renderer: createUmdRenderer(window.molstar, viewer),
    capture: consoleCaptureSink,
    sessionId: 'demo-session',
    evaluatorId: 'demo-user',
    models: ['mock:claude-haiku-4-5', 'mock:gpt-5', 'mock:gemini-2.5'],
    recordingNotice: true,
    collectFeedback: true,
    placeholder: 'e.g. "show hemoglobin as cartoon coloured blue, with its ligands"',
  });
}

void main();
