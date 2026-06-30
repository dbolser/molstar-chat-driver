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
// token (and, optionally, the whole preview) can spend per rolling 24h. Prompts are length-capped
// so a single request can't balloon model input + the stored turn.
const MAX_PROMPT_CHARS = Number(Deno.env.get('MCD_MAX_PROMPT_CHARS') || '8000');
const TOKEN_DAILY_CAP = Number(Deno.env.get('MCD_TOKEN_DAILY_CAP') || '50'); // per-token calls / 24h
const GLOBAL_DAILY_CAP = Number(Deno.env.get('MCD_DAILY_CALL_CAP') || '0'); // 0 = no global cap
const DAY_MS = 24 * 60 * 60 * 1000;

/** Count `turns` rows newer than `since`, optionally for one token. Returns null on error. */
async function callsSince(
  supabase: ReturnType<typeof createClient>,
  since: string,
  token?: string,
): Promise<number | null> {
  let q = supabase.from('turns').select('*', { count: 'exact', head: true }).gte('created_at', since);
  if (token) q = q.eq('evaluator_token', token);
  const { count, error } = await q;
  if (error) {
    console.error('rate-limit count failed', error);
    return null;
  }
  return count ?? 0;
}

function resolveModel(requested: unknown): string {
  if (typeof requested === 'string' && requested.trim()) {
    const spec = requested.trim();
    if (spec === DEFAULT_MODEL || ALLOWED_MODELS.has(spec)) return spec;
  }
  return DEFAULT_MODEL;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: { prompt?: unknown; model?: unknown };
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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') as string,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string,
  );

  // Gate on the invite token before spending any model tokens.
  const evaluator = req.headers.get('x-evaluator-token');
  if (!(await isInvited(supabase, evaluator))) {
    return json({ error: 'invalid or missing evaluator token' }, 403);
  }

  // Daily abuse/cost caps (best-effort; a count error fails OPEN so a transient DB blip doesn't
  // lock out a legitimate evaluator — the token gate above is the real security boundary).
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const tokenCalls = await callsSince(supabase, since, evaluator as string);
  if (tokenCalls !== null && tokenCalls >= TOKEN_DAILY_CAP) {
    return json({ error: 'daily limit reached for this invite — please try again tomorrow' }, 429);
  }
  if (GLOBAL_DAILY_CAP > 0) {
    const globalCalls = await callsSince(supabase, since);
    if (globalCalls !== null && globalCalls >= GLOBAL_DAILY_CAP) {
      return json({ error: 'the preview is at capacity right now — please try again later' }, 429);
    }
  }

  const result = await generateScene(model, prompt);

  // Reliable, server-side capture of the prompt + outcome. Must never break the user's turn.
  let turnId: string | null = null;
  try {
    const { data, error } = await supabase
      .from('turns')
      .insert({
        evaluator_token: evaluator,
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
