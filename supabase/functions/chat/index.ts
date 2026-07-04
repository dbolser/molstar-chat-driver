// Edge Function `chat` — the key-holding backend the plugin talks to.
// Honours the molstar-chat-driver contract: POST { prompt, model } -> { mvsj, text?, error? }.
// It ALSO captures the prompt + outcome server-side (reliable — the browser can't drop it),
// and returns a `turnId` the site uses to attach feedback. The evaluator's token comes in via
// the `x-evaluator-token` header (set by the site when it mounts the plugin) and must match a
// pre-issued invite, so the public Pages URL can't be used to burn model quota.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json } from '../_shared/cors.ts';
import { isInvited } from '../_shared/auth.ts';
import { generateScene } from '../_shared/model.ts';

const DEFAULT_MODEL = Deno.env.get('MCD_MODEL') || 'anthropic:claude-haiku-4-5';
// Optional allowlist of client-selectable model specs (comma-separated). The default model is
// always allowed; any other spec from the request body is honoured only if listed here.
const ALLOWED_MODELS = new Set(
  (Deno.env.get('MCD_ALLOWED_MODELS') || '').split(',').map((s) => s.trim()).filter(Boolean),
);

// Abuse / cost guards. A leaked invite token is a bearer credential, so cap how much any single
// token (and, optionally, the whole preview) can spend per day. Prompts are length-capped so a
// single request can't balloon model input + the stored turn. Caps come from env; a malformed
// value falls back to the safe default rather than silently disabling the limit.
const INT4_MAX = 2147483647; // caps are passed to int4 RPC params — clamp so they can't overflow
// Read a non-negative int from env, clamped to [min, INT4_MAX]; unset/blank/invalid → default.
// `min` differs per setting: prompt length and per-token cap must be ≥1 (0 would block everyone),
// while the global cap keeps 0 as its documented "disabled" value.
function intEnv(name: string, def: number, min: number): number {
  const raw = Deno.env.get(name);
  if (raw == null || raw.trim() === '') return def;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) return def;
  return Math.min(Math.max(Math.floor(v), min), INT4_MAX);
}
const MAX_PROMPT_CHARS = intEnv('MCD_MAX_PROMPT_CHARS', 8000, 1);
const TOKEN_DAILY_CAP = intEnv('MCD_TOKEN_DAILY_CAP', 50, 1); // per-token model calls / UTC day
const GLOBAL_DAILY_CAP = intEnv('MCD_DAILY_CALL_CAP', 0, 0); // 0 = no global cap

function resolveModel(requested: unknown): string {
  if (typeof requested === 'string' && requested.trim()) {
    const spec = requested.trim();
    if (spec === DEFAULT_MODEL || ALLOWED_MODELS.has(spec)) return spec;
  }
  return DEFAULT_MODEL;
}

const MAX_HISTORY_TURNS = intEnv('MCD_MAX_HISTORY_TURNS', 12, 0); // server cap on replayed context
const MAX_MVSJ_CHARS = intEnv('MCD_MAX_MVSJ_CHARS', 40000, 1); // cap each replayed scene's size

/** Validate + cap the client-supplied scene history (untrusted; both fields bound token cost). */
function sanitizeHistory(raw: unknown): { prompt: string; mvsj: string | null }[] {
  if (!Array.isArray(raw)) return [];
  const out: { prompt: string; mvsj: string | null }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const p = typeof o.prompt === 'string' ? o.prompt.slice(0, MAX_PROMPT_CHARS) : '';
    if (!p) continue;
    out.push({ prompt: p, mvsj: typeof o.mvsj === 'string' ? o.mvsj.slice(0, MAX_MVSJ_CHARS) : null });
  }
  return out.slice(-MAX_HISTORY_TURNS);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: { prompt?: unknown; model?: unknown; history?: unknown; sessionId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return json({ error: 'prompt is required' }, 400);
  if (prompt.length > MAX_PROMPT_CHARS) {
    return json({ error: `prompt too long (max ${MAX_PROMPT_CHARS} characters)` }, 400);
  }
  const model = resolveModel(body.model);
  const history = sanitizeHistory(body.history);
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.slice(0, 64) : null;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') as string,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string,
  );

  // Gate on the invite token before spending any model tokens.
  const evaluator = req.headers.get('x-evaluator-token');
  if (!(await isInvited(supabase, evaluator))) {
    return json({ error: 'invalid or missing evaluator token' }, 403);
  }

  // Daily abuse/cost caps via an ATOMIC reservation (rate_take RPC) so concurrent requests can't
  // overshoot the cap. Reserve a slot BEFORE spending model tokens. A DB error fails OPEN — a
  // transient blip shouldn't lock out a legit evaluator; the token gate above is the real boundary.
  const { data: allowed, error: rateErr } = await supabase.rpc('rate_take', {
    p_token: evaluator,
    p_token_cap: TOKEN_DAILY_CAP,
    p_global_cap: GLOBAL_DAILY_CAP,
  });
  if (rateErr) {
    console.error('rate_take failed (allowing)', rateErr);
  } else if (allowed === false) {
    return json({ error: 'daily limit reached — please try again tomorrow' }, 429);
  }

  const result = await generateScene(model, prompt, history);

  // Reliable, server-side capture of the prompt + outcome. Must never break the user's turn.
  let turnId: string | null = null;
  try {
    const { data, error } = await supabase
      .from('turns')
      .insert({
        evaluator_token: evaluator,
        session_id: sessionId,
        prompt,
        model,
        mvsj: result.mvsj,
        raw: result.raw,
        tier0: result.tier0,
      })
      .select('id')
      .single();
    if (error) console.error('turn capture failed', error);
    else turnId = data?.id ?? null;
  } catch (e) {
    console.error('turn capture threw', e); // capture failure must not fail the response
  }

  // mvsj/text/error are the plugin contract; turnId is an extra field the site reads.
  return json({ mvsj: result.mvsj, text: result.text, error: result.error, turnId });
});
