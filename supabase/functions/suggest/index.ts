// Edge Function `suggest` — prompt suggestions for the site's chip row.
// POST { recent?: string[] } (+ x-evaluator-token header) -> { suggestions: string[] }.
// `recent` empty ⇒ starter prompts (seed + corpus); otherwise ⇒ next-step predictions grounded in
// the evaluator's recent prompts. Token-gated like `chat`. The LLM-backed next-step path is
// separately rate-capped (scope `sg:<token>`) so suggestions can't quietly balloon model spend;
// over the cap it degrades to deterministic follow-ups. Never hard-fails — worst case, [].
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json } from '../_shared/cors.ts';
import { isInvited } from '../_shared/auth.ts';
import { nextSuggestions, starterSuggestions } from '../_shared/suggest.ts';

const COUNT = 3; // chips to return
const MAX_RECENT = 12; // cap replayed prompts (bounds token cost of the next-step call)

// Per-token daily cap on the LLM-backed next-step calls. Generous (suggestions are cheap Haiku),
// but bounded so a leaked invite can't run up the bill via the chip row. 0 disables the model path.
function suggestCap(): number {
  const raw = Deno.env.get('MCD_SUGGEST_DAILY_CAP');
  if (raw == null || raw.trim() === '') return 300;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 2147483647) : 300;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: { recent?: unknown };
  try {
    // A literal `null` (or an array/primitive) is valid JSON but not a usable body — reject it
    // here so the later `body.recent` access can't throw outside the guarantee below.
    const parsed = await req.json();
    if (parsed === null || typeof parsed !== 'object') throw new Error('not an object');
    body = parsed as { recent?: unknown };
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') as string,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string,
  );

  const token = req.headers.get('x-evaluator-token');
  if (!(await isInvited(supabase, token))) {
    return json({ error: 'invalid or missing evaluator token' }, 403);
  }

  const recent = Array.isArray(body.recent)
    ? body.recent.filter((s): s is string => typeof s === 'string').map((s) => s.trim().slice(0, 400)).filter(Boolean).slice(-MAX_RECENT)
    : [];

  try {
    if (recent.length === 0) {
      return json({ suggestions: await starterSuggestions(supabase, COUNT) });
    }
    // Reserve a slot for the model-backed path; over cap (or on DB error → false) we still answer,
    // just with deterministic follow-ups instead of a model call.
    const cap = suggestCap();
    let allowModel = cap > 0;
    if (allowModel) {
      const { data, error } = await supabase.rpc('rate_take', {
        p_token: `sg:${token}`,
        p_token_cap: cap,
        p_global_cap: 0,
      });
      if (error) console.error('suggest rate_take failed (allowing)', error);
      else if (data === false) allowModel = false;
    }
    return json({ suggestions: await nextSuggestions(recent, COUNT, allowModel) });
  } catch (e) {
    console.error('suggest threw', e);
    return json({ suggestions: [] }); // never break the composer over a suggestion failure
  }
});
