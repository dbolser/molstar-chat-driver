// Edge Function `chat` — the key-holding backend the plugin talks to.
// Honours the molstar-chat-driver contract: POST { prompt, model } -> { mvsj, text?, error? }.
// It ALSO captures the prompt + outcome server-side (reliable — the browser can't drop it),
// and returns a `turnId` the site uses to attach feedback. The evaluator's token comes in via
// the `x-evaluator-token` header (set by the site when it mounts the plugin).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json } from '../_shared/cors.ts';
import { generateScene } from '../_shared/model.ts';

const DEFAULT_MODEL = Deno.env.get('MCD_MODEL') || 'anthropic:claude-haiku-4-5';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: { prompt?: unknown; model?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* leave defaults */
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const model = (typeof body.model === 'string' && body.model) || DEFAULT_MODEL;
  const evaluator = req.headers.get('x-evaluator-token');

  const result = await generateScene(model, prompt);

  // Reliable, server-side capture of the prompt + outcome. Must never break the user's turn.
  let turnId: string | null = null;
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') as string,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string,
    );
    const { data } = await supabase
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
    turnId = data?.id ?? null;
  } catch (_) {
    /* capture failure must not fail the response */
  }

  // mvsj/text/error are the plugin contract; turnId is an extra field the site reads.
  return json({ mvsj: result.mvsj, text: result.text, error: result.error, turnId });
});
