// The demo's chat backend — one /chat endpoint honouring the molstar-chat-driver
// backend contract: take { prompt, model }, return { mvsj, text?, error? }.
//
// Two modes, chosen by whether ANTHROPIC_API_KEY is set (see .env / .env.example):
//   • no key  → keyword mode: maps a few keywords to a hand-authored MVS scene. No
//               network model call, no API key. Good enough to exercise the pipeline.
//   • key set → LLM mode: relays the prompt to Claude and returns whatever MVS it emits.
//
// Started automatically by `npm run demo`; can also be run directly: `node demo/server.mjs`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8787;

// --- tiny .env loader (Node 18 has no built-in --env-file) ---------------------------
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = raw.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let [, key, val] = m;
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv();

// --- keyword mode: hand-authored MVS (valid MVSJ, no Mol* dependency) -----------------
const NAMED_ENTRIES = {
  hemoglobin: '1hho',
  haemoglobin: '1hho',
  lysozyme: '1lyz',
  insulin: '4ins',
  myoglobin: '1mbn',
  p53: '1tup',
  retinol: '1cbs',
};

function pickEntry(prompt) {
  const p = prompt.toLowerCase();
  for (const [name, id] of Object.entries(NAMED_ENTRIES)) {
    if (p.includes(name)) return id;
  }
  const m = p.match(/\b([0-9][a-z0-9]{3})\b/); // crude PDB-id detector
  if (m) return m[1];
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

function pickColor(prompt) {
  const p = prompt.toLowerCase();
  if (p.includes('red')) return '#E8000B';
  if (p.includes('green')) return '#1A9E1A';
  if (p.includes('orange')) return '#FF7F0E';
  if (p.includes('blue')) return '#3050F8';
  return '#3050F8';
}

function component(selector, type, color) {
  return {
    kind: 'component',
    params: { selector },
    children: [
      {
        kind: 'representation',
        params: { type },
        children: [{ kind: 'color', params: { color } }],
      },
    ],
  };
}

function buildKeywordMvs(prompt) {
  const entry = pickEntry(prompt);
  if (!entry) return null;

  const url = `https://www.ebi.ac.uk/pdbe/entry-files/download/${entry}_updated.cif`;
  const components = [component('polymer', pickRepresentation(prompt), pickColor(prompt))];
  if (/ligand|drug|heme|haem|bound|cofactor/i.test(prompt)) {
    components.push(component('ligand', 'ball_and_stick', '#FF7F0E'));
  }

  const mvs = {
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
  };
  return JSON.stringify(mvs);
}

// --- LLM mode: relay the prompt to Claude --------------------------------------------
const SYSTEM = `You turn a user's request into a MolViewSpec (MVS) scene tree.
Reply with ONLY the MVSJ JSON object — no prose, no markdown code fences.
Shape: { "metadata": { "version": "1" }, "root": { "kind": "root", "children": [ ... ] } },
nesting download -> parse -> structure -> component -> representation -> color nodes.`;

let anthropic; // created lazily on first LLM request
async function buildLlmMvs(prompt, model) {
  if (!anthropic) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
  }
  const message = await anthropic.messages.create({
    model: model || process.env.MODEL || 'claude-opus-4-8',
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = message.content.find((b) => b.type === 'text')?.text ?? '';
  let mvsj = null;
  try {
    JSON.parse(text); // Tier 0: did the model return parseable JSON?
    mvsj = text;
  } catch {
    /* not valid MVS JSON */
  }
  return { mvsj, text: mvsj ? undefined : text };
}

// --- server --------------------------------------------------------------------------
export function startChatServer({ port = PORT } = {}) {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  const modelName = process.env.MODEL || 'claude-opus-4-8';

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // let the browser demo call us
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    if (req.method !== 'POST') return void res.writeHead(405).end();

    let body = '';
    for await (const chunk of req) body += chunk;
    let prompt = '';
    let model;
    try {
      ({ prompt = '', model } = JSON.parse(body || '{}'));
    } catch {
      /* leave defaults */
    }

    try {
      const result = hasKey
        ? await buildLlmMvs(prompt, model)
        : { mvsj: buildKeywordMvs(prompt) };
      if (!hasKey && !result.mvsj) {
        result.text =
          'Keyword mode: name a structure like “lysozyme”, “hemoglobin”, or a PDB id (e.g. 4ins). ' +
          'Set ANTHROPIC_API_KEY in .env to chat with a real model.';
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ mvsj: null, error: String(err) }));
    }
  });

  server.listen(port, () => {
    const mode = hasKey ? `LLM mode (${modelName})` : 'keyword mode — no ANTHROPIC_API_KEY set';
    console.log(`  chat backend → http://localhost:${port}/chat  [${mode}]`);
  });
  return server;
}

// Run standalone: `node demo/server.mjs`
if (process.argv[1] === fileURLToPath(import.meta.url)) startChatServer();
