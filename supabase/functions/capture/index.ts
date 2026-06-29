// Edge Function `capture` — records evaluator identity and free-text feedback.
// POST { token, kind: 'register', name } -> upsert the evaluator's name.
// POST { token, kind: 'feedback', comment, rating?, turnId? } -> store feedback.
// Writes use the service role (bypasses RLS), so the browser never touches the DB directly.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* leave defaults */
  }
  const token = typeof body.token === 'string' ? body.token : null;
  if (!token) return json({ error: 'missing token' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') as string,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string,
  );

  try {
    if (body.kind === 'register') {
      const name = typeof body.name === 'string' ? body.name.slice(0, 200) : null;
      await supabase.from('evaluators').upsert({ token, name }, { onConflict: 'token' });
      return json({ ok: true });
    }
    if (body.kind === 'feedback') {
      await supabase.from('evaluators').upsert({ token }, { onConflict: 'token', ignoreDuplicates: true });
      await supabase.from('feedback').insert({
        evaluator_token: token,
        turn_id: typeof body.turnId === 'string' ? body.turnId : null,
        rating: typeof body.rating === 'string' ? body.rating : null,
        comment: typeof body.comment === 'string' ? body.comment.slice(0, 5000) : null,
      });
      return json({ ok: true });
    }
    return json({ error: 'unknown kind' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
