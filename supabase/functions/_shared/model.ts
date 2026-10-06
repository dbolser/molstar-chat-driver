// Prompt → MVS scene, for the Edge Function. A Deno port of the MolBench-powered backend
// (examples/molbench_backend.py): MolBench's vendored system prompt, the same provider scheme,
// and the same extract + envelope-wrap so the scene actually renders in Mol*.
//
// Keys come from Edge Function secrets (Deno.env): ANTHROPIC_API_KEY / OPENAI_API_KEY /
// GEMINI_API_KEY / OPENROUTER_API_KEY (+ optional OPENAI_BASE_URL).
import { SYSTEM } from './prompt.ts';
// Maintained JSON-repair library (fixes the missing-bracket / trailing-comma output Haiku produces
// on complex multi-component scenes, e.g. "colour by chain"). Not hand-rolled.
import { jsonrepair } from 'https://esm.sh/jsonrepair@3.15.0';
import { lintScene } from './lint.ts';
import { candidatesMessage, checkMessage, loadedText, lookup, pdbIds, search, searchPhrase } from './ground.ts';
import { type Atom, checkScene, parseAtomSite } from './selections.ts';

type Kind = 'anthropic' | 'openai';
interface Provider {
  kind: Kind;
  keyVar: string;
  baseUrl?: string;
  id: string;
}

export function resolveProvider(spec: string): Provider | null {
  const i = spec.indexOf(':');
  const provider = i === -1 ? 'anthropic' : spec.slice(0, i);
  const id = i === -1 ? spec : spec.slice(i + 1);
  switch (provider) {
    case 'anthropic':
      return { kind: 'anthropic', keyVar: 'ANTHROPIC_API_KEY', id };
    case 'openai':
      return { kind: 'openai', keyVar: 'OPENAI_API_KEY', baseUrl: Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1', id };
    case 'openrouter':
      return { kind: 'openai', keyVar: 'OPENROUTER_API_KEY', baseUrl: 'https://openrouter.ai/api/v1', id };
    case 'gemini':
    case 'google':
      return { kind: 'openai', keyVar: 'GEMINI_API_KEY', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', id };
    default:
      return null;
  }
}

// Outbound model calls get a hard timeout so a stalled upstream fails fast instead of hanging
// the Edge Function (and the evaluator's turn) indefinitely.
const REQUEST_TIMEOUT_MS = 60_000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new Error(`upstream timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export interface HistoryTurn {
  prompt: string;
  mvsj: string | null;
}
interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

// Replay prior turns as an alternating user/assistant conversation so a follow-up prompt edits
// the current scene. The assistant's earlier reply is the MVSJ it produced (what it should edit).
function buildMessages(prompt: string, history?: HistoryTurn[]): Msg[] {
  const msgs: Msg[] = [];
  // Only turns that put a scene on screen are replayed. A failed turn used to be replayed as
  // "(no scene produced for that prompt)", and the model learned to answer with exactly that —
  // one failure cascaded into a run of them (seen in the captured turns, 2026-07-08).
  for (const h of history ?? []) {
    if (!h.mvsj) continue;
    msgs.push({ role: 'user', content: h.prompt });
    msgs.push({ role: 'assistant', content: h.mvsj });
  }
  msgs.push({ role: 'user', content: prompt });
  return msgs;
}

async function callAnthropic(key: string, id: string, messages: Msg[]): Promise<string> {
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: id, max_tokens: 16000, system: SYSTEM, messages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return (data.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
}

async function callOpenAiCompat(baseUrl: string, key: string, id: string, convo: Msg[]): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const messages = [{ role: 'system', content: SYSTEM }, ...convo];
  const send = async (tokenField: string) => {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
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
    if (!String((e as Error).message).includes('max_completion_tokens')) throw e;
    return await send('max_completion_tokens');
  }
}

// Accept a full MVS state, a {root: ...} wrapper, or a bare root node (mirrors molbench.mvs).
function extractRoot(obj: unknown): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (o.kind === 'root') return o;
  if (o.root && typeof o.root === 'object') {
    const root = o.root as Record<string, unknown>;
    if (root.kind === 'root') return root; // only a real root node is a renderable scene
  }
  return null;
}

/** Parse the model's reply into an object. If strict JSON fails, fall back to jsonrepair (which
 *  closes missing brackets etc.). `repaired` reports whether that fallback was needed. */
export function extractJsonObject(raw: string): { obj: unknown; repaired: boolean } {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('{');
  if (a === -1) return { obj: null, repaired: false };
  const b = s.lastIndexOf('}');
  // If the reply was truncated (no closing brace after the first `{`, e.g. a max_tokens cutoff),
  // keep everything from `{` onward and let jsonrepair close it, rather than bailing out.
  const candidate = b > a ? s.slice(a, b + 1) : s.slice(a);
  try {
    return { obj: JSON.parse(candidate), repaired: false };
  } catch {
    try {
      return { obj: JSON.parse(jsonrepair(candidate)), repaired: true };
    } catch {
      return { obj: null, repaired: false };
    }
  }
}

// The empty-selection check (selections.ts) downloads the scene's structure file. Best-effort:
// a slow or huge file is skipped, never allowed to hold up or break the turn. Parsing costs ~60 ms
// of CPU per MB (a 25 MB ribosome took 1.5 s), so the cap keeps us well inside the Edge Function
// CPU budget.
const STRUCTURE_TIMEOUT_MS = 8000;
const STRUCTURE_MAX_BYTES = 10_000_000;

async function fetchAtoms(url: string): Promise<Atom[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STRUCTURE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok || !res.body || Number(res.headers.get('content-length') ?? 0) > STRUCTURE_MAX_BYTES) {
      await res.body?.cancel();
      return null;
    }
    // Count bytes as they arrive: a chunked response has no content-length to check up front.
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > STRUCTURE_MAX_BYTES) {
        ctrl.abort();
        return null;
      }
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    return parseAtomSite(new TextDecoder().decode(bytes));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface SceneResult {
  mvsj: string | null;
  text?: string;
  error?: string;
  raw: string;
  tier0: boolean;
  /** True if the scene only parsed after a JSON self-repair retry (for capture/metrics). */
  repaired?: boolean;
  /** What the server changed or checked to get here — lint fixes and grounding steps. */
  lint?: string[];
}

function callModel(prov: Provider, key: string, messages: Msg[]): Promise<string> {
  return prov.kind === 'anthropic'
    ? callAnthropic(key, prov.id, messages)
    : callOpenAiCompat(prov.baseUrl as string, key, prov.id, messages);
}

interface Scene {
  mvsj: string;
  repaired: boolean;
  lint: string[];
}

/** Raw model text → a linted, envelope-wrapped scene, or null when there is no scene in it. */
function toScene(raw: string): Scene | null {
  const { obj, repaired } = extractJsonObject(raw); // jsonrepair fallback for near-valid JSON
  const root = extractRoot(obj);
  if (!root) return null;
  const lint = lintScene(root); // fix the recurring validation failures (recorded on the turn)
  // MolBench's prompt yields a bare {root} tree; Mol* needs a full state with metadata.version.
  const mvsj = JSON.stringify({ metadata: { version: '1', timestamp: new Date().toISOString() }, root });
  return { mvsj, repaired, lint };
}

export async function generateScene(
  spec: string,
  prompt: string,
  history?: HistoryTurn[],
): Promise<SceneResult> {
  const prov = resolveProvider(spec);
  if (!prov) return { mvsj: null, error: `unknown model spec: ${spec}`, raw: '', tier0: false };
  const key = Deno.env.get(prov.keyVar);
  if (!key) return { mvsj: null, error: `server is missing ${prov.keyVar}`, raw: '', tier0: false };

  const messages = buildMessages(prompt, history);
  let raw: string;
  try {
    raw = await callModel(prov, key, messages);
  } catch (e) {
    return { mvsj: null, error: `${(e as Error).name}: ${(e as Error).message}`, raw: '', tier0: false };
  }

  let scene = toScene(raw);
  if (!scene) return { mvsj: null, text: raw, raw, tier0: false }; // no scene — show the raw reply
  const notes = [...scene.lint];
  let text: string | undefined;

  // Grounding (see ground.ts): only for entries this turn introduces — a follow-up that keeps
  // editing the structure already on screen has nothing new to check.
  const known = new Set((history ?? []).flatMap((h) => (h.mvsj ? pdbIds(h.mvsj) : [])));
  const fresh = pdbIds(scene.mvsj).filter((id) => !known.has(id));
  if (fresh.length) {
    try {
      let entries = await lookup(fresh);
      const convo: Msg[] = [...messages, { role: 'assistant', content: raw }, { role: 'user', content: checkMessage(entries) }];
      const verdict = await callModel(prov, key, convo);
      const phrase = searchPhrase(verdict);
      if (phrase) {
        const hits = await search(phrase);
        if (hits.length === 0) {
          notes.push(`grounding: no RCSB hits for "${phrase}"`);
        } else {
          convo.push({ role: 'assistant', content: verdict }, { role: 'user', content: candidatesMessage(phrase, hits) });
          const raw2 = await callModel(prov, key, convo);
          const scene2 = toScene(raw2);
          if (scene2) {
            const ids2 = pdbIds(scene2.mvsj);
            notes.push(`grounding: ${fresh.join(',')} → ${ids2.join(',')} via "${phrase}"`, ...scene2.lint);
            entries = await lookup(ids2.filter((id) => !known.has(id)));
            scene = scene2;
            raw = raw2;
          }
        }
      }
      const missing = entries.filter((e) => !e.title);
      if (missing.length) {
        // Still pointing at a non-existent entry: say so plainly rather than render an empty viewer.
        return {
          mvsj: null, raw, tier0: true, repaired: scene.repaired, lint: notes,
          error: `PDB entry ${missing.map((e) => e.id).join(', ')} does not exist — the model made it up. Try naming a real PDB id.`,
        };
      }
      text = loadedText(entries) || undefined;
    } catch (e) {
      console.error('grounding skipped', e); // RCSB hiccup: the ungrounded scene is still worth showing
    }
  }

  // Selections that match no atom (wrong chain / residue / atom name): drop primitives that would
  // be drawn to the origin, and tell the user what was skipped.
  let mvsj = scene.mvsj;
  try {
    const state = JSON.parse(mvsj);
    const checked = await checkScene(state.root, fetchAtoms);
    if (checked.notes.length) {
      notes.push(...checked.notes);
      mvsj = JSON.stringify(state);
    }
    if (checked.messages.length) text = [text, ...checked.messages].filter(Boolean).join('\n');
  } catch (e) {
    console.error('selection check skipped', e);
  }

  return { mvsj, text, raw, tier0: true, repaired: scene.repaired, lint: notes };
}
