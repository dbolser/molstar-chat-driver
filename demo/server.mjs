// The demo's chat backend — one /chat endpoint honouring the molstar-chat-driver
// backend contract: take { prompt, model }, return { mvsj, text?, error? }.
//
// Modes, chosen by what's in .env (see .env.example):
//   • no key for the active model → keyword mode: maps a few keywords to a
//     hand-authored MVS scene. No model call, no key.
//   • key present                 → relays the prompt to that provider.
//
// Providers follow MolBench's `provider:model-id` spec — anthropic / openai /
// gemini / openrouter (the last three share the OpenAI-compatible wire format).
//
// `npm run demo` starts this and watches .env, so editing the file takes effect
// without a restart. Can also be run directly: `node demo/server.mjs`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const PORT = 8787;
const DEFAULT_MODEL = 'anthropic:claude-haiku-4-5'; // small + cheap, plenty good for MVS

// One representative model per non-OpenRouter provider, offered in the demo's picker when that
// provider's key is set. (OpenRouter is handled separately — it has hundreds of models, so the
// operator lists which to offer via OPENROUTER_ALLOWED_MODELS.)
const PROVIDER_DEFAULT_MODEL = {
  anthropic: 'anthropic:claude-haiku-4-5',
  openai: 'openai:gpt-4o-mini',
  gemini: 'gemini:gemini-2.5-flash',
};

// OpenRouter picks when OPENROUTER_ALLOWED_MODELS is unset: a few recent open-weight models.
// Slugs verified against https://openrouter.ai/api/v1/models — keep them exact.
const DEFAULT_OPENROUTER_MODELS = [
  'deepseek/deepseek-v4-flash',
  'qwen/qwen3.6-27b',
  'mistralai/mistral-small-2603',
];

// --- config: .env file, hot-reloaded -------------------------------------------------
function readEnvFile() {
  const p = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(p)) return {};
  // dotenv.parse → plain object; it does NOT mutate process.env, so the shell-vars-win
  // precedence in env() below is preserved (and it handles quotes/escapes/multiline for us).
  return dotenv.parse(fs.readFileSync(p));
}

let envFile = readEnvFile();

// Already-exported shell vars win (matching MolBench); else the .env file; empty = unset.
function env(name) {
  const shell = process.env[name];
  if (shell !== undefined && shell !== '') return shell;
  const file = envFile[name];
  return file === undefined || file === '' ? undefined : file;
}

// --- provider resolution (MolBench's provider:model-id spec) --------------------------
function resolveProvider(spec) {
  const idx = spec.indexOf(':');
  const provider = idx === -1 ? 'anthropic' : spec.slice(0, idx);
  const id = idx === -1 ? spec : spec.slice(idx + 1);
  switch (provider) {
    case 'anthropic':
      return { kind: 'anthropic', keyVar: 'ANTHROPIC_API_KEY', id };
    case 'openai':
      return { kind: 'openai', keyVar: 'OPENAI_API_KEY', baseUrl: env('OPENAI_BASE_URL') || 'https://api.openai.com/v1', id };
    case 'openrouter':
      return { kind: 'openai', keyVar: 'OPENROUTER_API_KEY', baseUrl: 'https://openrouter.ai/api/v1', id };
    case 'gemini':
    case 'google':
      return { kind: 'openai', keyVar: 'GEMINI_API_KEY', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', id };
    default:
      return null;
  }
}

// Which models to offer in the demo's picker, built from whichever provider keys are present.
// The UI shows a selector only when this yields 2+ entries (i.e. multiple keys configured).
// `lookup` is injected so the logic is testable without touching the real environment.
export function availableModels(lookup = env) {
  const models = [];
  for (const spec of Object.values(PROVIDER_DEFAULT_MODEL)) {
    const prov = resolveProvider(spec);
    if (prov && lookup(prov.keyVar)) models.push(spec);
  }
  if (lookup('OPENROUTER_API_KEY')) {
    const raw = lookup('OPENROUTER_ALLOWED_MODELS');
    const ids = (raw ? raw.split(',') : DEFAULT_OPENROUTER_MODELS).map((s) => s.trim()).filter(Boolean);
    for (const id of ids) models.push(`openrouter:${id}`);
  }
  return models;
}

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

export function pickEntry(prompt) {
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
    components.push(component('ligand', 'ball_and_stick', '#FF7F0E'));
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

// --- LLM modes -----------------------------------------------------------------------
const SYSTEM = `You turn a user's request into a MolViewSpec (MVS) scene tree.
Reply with ONLY the MVSJ JSON object — no prose, no markdown code fences.
Shape: { "metadata": { "version": "1" }, "root": { "kind": "root", "children": [ ... ] } },
nesting download -> parse -> structure -> component -> representation -> color nodes.`;

async function callAnthropic(key, id, prompt) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: key });
  const message = await client.messages.create({
    model: id,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  return message.content.find((b) => b.type === 'text')?.text ?? '';
}

// OpenAI-compatible: OpenAI, Gemini (compat layer), OpenRouter, local hosts.
async function callOpenAiCompat(baseUrl, key, id, prompt) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: prompt },
  ];
  const send = async (tokenField) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: id, messages, [tokenField]: 16000 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    return data.choices?.[0]?.message?.content ?? '';
  };
  // gpt-5 / o-series want max_completion_tokens; older + most compat hosts want max_tokens.
  try {
    return await send('max_tokens');
  } catch (e) {
    if (!String(e.message).includes('max_completion_tokens')) throw e;
    return await send('max_completion_tokens');
  }
}

// Models are asked for bare MVSJ, but routinely wrap it in ```json fences or a line
// of prose. Peel those off before validating so a correct scene isn't thrown away.
function unwrapJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  const inner = (fenced ? fenced[1] : trimmed).trim();
  // Fallback: grab the outermost {...} if there's leading/trailing prose.
  const open = inner.indexOf('{');
  const close = inner.lastIndexOf('}');
  const sliced = open !== -1 && close > open ? inner.slice(open, close + 1) : '';
  const candidates = [inner];
  if (sliced && sliced !== inner) candidates.push(sliced);
  return candidates;
}

export function toResult(text) {
  for (const candidate of unwrapJson(text)) {
    try {
      JSON.parse(candidate); // parseable JSON wins; first match is the scene
      return { mvsj: candidate };
    } catch {
      /* try the next candidate */
    }
  }
  return { mvsj: null, text }; // nothing parsed — show the raw reply as chat text
}

// --- server --------------------------------------------------------------------------
function describeMode() {
  const spec = env('MODEL') || DEFAULT_MODEL;
  const prov = resolveProvider(spec);
  if (prov && env(prov.keyVar)) return `LLM mode → ${spec}`;
  return `keyword mode — no key for ${spec} (set ${prov ? prov.keyVar : 'a key'} in .env)`;
}

export function startChatServer({ port = PORT } = {}) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // let the browser demo call us
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    // The demo asks which models to offer (it can't see the keys, which stay server-side).
    if (req.method === 'GET' && (req.url === '/models' || req.url.startsWith('/models?'))) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return void res.end(JSON.stringify({ models: availableModels(), default: env('MODEL') || DEFAULT_MODEL }));
    }
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
      const spec = model || env('MODEL') || DEFAULT_MODEL;
      const prov = resolveProvider(spec);
      const key = prov && env(prov.keyVar);

      let result;
      if (!prov || !key) {
        // Keyword mode — no usable key for the active model.
        result = { mvsj: buildKeywordMvs(prompt) };
        if (!result.mvsj) {
          result.text =
            `Keyword mode (no ${prov ? prov.keyVar : 'API key'} set): name a structure like ` +
            `“lysozyme”, “hemoglobin”, or a PDB id (e.g. 4ins). Add a key to .env to chat with ${spec}.`;
        }
      } else if (prov.kind === 'anthropic') {
        result = toResult(await callAnthropic(key, prov.id, prompt));
      } else {
        result = toResult(await callOpenAiCompat(prov.baseUrl, key, prov.id, prompt));
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ mvsj: null, error: String(err) }));
    }
  });

  // Hot-reload .env so editing it (e.g. pasting a key) takes effect without a restart.
  try {
    let timer;
    fs.watch(process.cwd(), (_event, filename) => {
      if (filename && filename !== '.env') return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        envFile = readEnvFile();
        console.log(`  .env reloaded → [${describeMode()}]`);
      }, 150);
    });
  } catch {
    /* fs.watch unsupported here — keys still load at startup */
  }

  server.listen(port, () => {
    console.log(`  chat backend → http://localhost:${port}/chat  [${describeMode()}]`);
  });
  return server;
}

// Run standalone: `node demo/server.mjs`
if (process.argv[1] === fileURLToPath(import.meta.url)) startChatServer();
