// Prompt → MVS scene, for the Edge Function. A Deno port of the MolBench-powered backend
// (examples/molbench_backend.py): MolBench's vendored system prompt, the same provider scheme,
// and the same extract + envelope-wrap so the scene actually renders in Mol*.
//
// Keys come from Edge Function secrets (Deno.env): ANTHROPIC_API_KEY / OPENAI_API_KEY /
// GEMINI_API_KEY / OPENROUTER_API_KEY (+ optional OPENAI_BASE_URL).
import { SYSTEM } from './prompt.ts';
// Maintained JSON-repair library (fixes the missing-bracket / trailing-comma output Haiku produces
// on complex multi-component scenes, e.g. "colour by chain"). Not hand-rolled.
import { jsonrepair } from 'https://esm.sh/jsonrepair@3.13.0';

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
  for (const h of history ?? []) {
    msgs.push({ role: 'user', content: h.prompt });
    msgs.push({ role: 'assistant', content: h.mvsj ?? '(no scene produced for that prompt)' });
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
  const b = s.lastIndexOf('}');
  if (a === -1 || b <= a) return { obj: null, repaired: false };
  const candidate = s.slice(a, b + 1);
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

export interface SceneResult {
  mvsj: string | null;
  text?: string;
  error?: string;
  raw: string;
  tier0: boolean;
  /** True if the scene only parsed after a JSON self-repair retry (for capture/metrics). */
  repaired?: boolean;
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
    raw = prov.kind === 'anthropic'
      ? await callAnthropic(key, prov.id, messages)
      : await callOpenAiCompat(prov.baseUrl as string, key, prov.id, messages);
  } catch (e) {
    return { mvsj: null, error: `${(e as Error).name}: ${(e as Error).message}`, raw: '', tier0: false };
  }

  const { obj, repaired } = extractJsonObject(raw); // jsonrepair fallback for near-valid JSON
  const root = extractRoot(obj);
  if (!root) return { mvsj: null, text: raw, raw, tier0: false, repaired }; // no scene — show the raw reply
  // MolBench's prompt yields a bare {root} tree; Mol* needs a full state with metadata.version.
  const mvsj = JSON.stringify({ metadata: { version: '1', timestamp: new Date().toISOString() }, root });
  return { mvsj, raw, tier0: true, repaired };
}
