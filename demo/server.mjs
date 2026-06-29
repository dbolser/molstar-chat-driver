// The demo's chat backend — a keyword-only dev stub.
//
// It honours the molstar-chat-driver backend contract (POST /chat with
// { prompt, model } -> { mvsj, text?, error? }) but makes NO model calls: it maps a
// few keywords to a hand-authored MVS scene. No API keys, no network model, no .env.
// That keeps `npm run demo` a zero-setup way to develop the UI/UX offline.
//
// For real natural-language → MVS, run a model-backed server that speaks the same
// contract — see examples/molbench_backend.py and the README's "Local production"
// section. The plugin doesn't care which backend it talks to.
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const PORT = 8787;
const KEYWORD_MODEL = 'keyword';

// --- keyword → hand-authored MVS (valid MVSJ, no Mol* dependency) ---------------------
const NAMED_ENTRIES = {
  hemoglobin: '1hho',
  haemoglobin: '1hho',
  lysozyme: '1lyz',
  insulin: '4ins',
  myoglobin: '1mbn',
  p53: '1tup',
  retinol: '1cbs',
};

export function pickEntry(prompt) {
  const p = prompt.toLowerCase();
  for (const [name, id] of Object.entries(NAMED_ENTRIES)) {
    if (p.includes(name)) return id;
  }
  // Crude PDB-id detector: 4 chars starting 1-9 and containing at least one letter, so plain
  // numbers ("2024") aren't mistaken for structure ids and sent to a 404.
  const m = p.match(/\b([1-9][a-z0-9]{3})\b/);
  if (m && /[a-z]/.test(m[1])) return m[1];
  if (/\b(show|render|display|view|load|draw)\b/.test(p)) return '1cbs';
  return null;
}

function pickRepresentation(prompt) {
  const p = prompt.toLowerCase();
  if (p.includes('surface')) return 'surface';
  if (p.includes('spacefill') || p.includes('sphere')) return 'spacefill';
  if (p.includes('ball') || p.includes('stick') || p.includes('atoms')) return 'ball_and_stick';
  return 'cartoon';
}

const COLORS = { red: '#E8000B', green: '#1A9E1A', orange: '#FF7F0E', blue: '#3050F8' };

function pickColor(prompt) {
  const p = prompt.toLowerCase();
  for (const [name, hex] of Object.entries(COLORS)) {
    if (p.includes(name)) return hex;
  }
  return COLORS.blue;
}

function component(selector, type, color) {
  return {
    kind: 'component',
    params: { selector },
    children: [
      { kind: 'representation', params: { type }, children: [{ kind: 'color', params: { color } }] },
    ],
  };
}

export function buildKeywordMvs(prompt) {
  const entry = pickEntry(prompt);
  if (!entry) return null;

  const url = `https://www.ebi.ac.uk/pdbe/entry-files/download/${entry}_updated.cif`;
  const components = [component('polymer', pickRepresentation(prompt), pickColor(prompt))];
  if (/ligand|drug|heme|haem|bound|cofactor/i.test(prompt)) {
    components.push(component('ligand', 'ball_and_stick', COLORS.orange));
  }

  return JSON.stringify({
    metadata: { version: '1', timestamp: new Date().toISOString() },
    root: {
      kind: 'root',
      children: [
        { kind: 'canvas', params: { background_color: 'white' } },
        {
          kind: 'download',
          params: { url },
          children: [
            {
              kind: 'parse',
              params: { format: 'mmcif' },
              children: [{ kind: 'structure', params: { type: 'model' }, children: components }],
            },
          ],
        },
      ],
    },
  });
}

/** Map a chat request to a contract response. Pure, so it's trivially testable. */
export function handleChat(prompt) {
  const mvsj = buildKeywordMvs(prompt);
  if (mvsj) return { mvsj };
  return {
    mvsj: null,
    text:
      'Keyword mode: name a structure like “lysozyme”, “hemoglobin”, or a PDB id (e.g. 4ins). ' +
      'For free-form prompts, run a model-backed backend (see the README → Local production).',
  };
}

// --- server --------------------------------------------------------------------------
export function startChatServer({ port = PORT } = {}) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // let the browser demo call us
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();

    // The demo asks which models to offer; this stub only ever offers keyword mode.
    if (req.method === 'GET' && (req.url === '/models' || req.url.startsWith('/models?'))) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return void res.end(JSON.stringify({ models: [KEYWORD_MODEL], default: KEYWORD_MODEL }));
    }
    if (req.method !== 'POST') return void res.writeHead(405).end();

    let body = '';
    for await (const chunk of req) body += chunk;
    let prompt = '';
    try {
      ({ prompt = '' } = JSON.parse(body || '{}'));
    } catch {
      /* leave default */
    }

    try {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(handleChat(prompt)));
    } catch (err) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ mvsj: null, error: String(err) }));
    }
  });

  server.listen(port, () => {
    console.log(`  chat backend (keyword-only dev stub) → http://localhost:${port}/chat`);
  });
  return server;
}

// Run standalone: `node demo/server.mjs`
if (process.argv[1] === fileURLToPath(import.meta.url)) startChatServer();
