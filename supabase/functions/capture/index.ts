// Edge Function `capture` — records evaluator identity and free-text feedback.
// POST { token, kind: 'register', name } -> set the invited evaluator's name.
// POST { token, kind: 'feedback', comment, rating?, turnId? } -> store feedback.
// Writes use the service role (bypasses RLS), so the browser never touches the DB directly.
// The token must match a pre-issued invite (the `evaluators` allowlist) or the call is rejected.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json } from '../_shared/cors.ts';
import { isInvited } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const token = typeof body.token === 'string' ? body.token : null;
  if (!token) return json({ error: 'missing token' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') as string,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string,
  );

  // Gate everything on a known invite token.
  if (!(await isInvited(supabase, token))) {
    return json({ error: 'invalid evaluator token' }, 403);
  }

  try {
    if (body.kind === 'register') {
      const name = typeof body.name === 'string' ? body.name.slice(0, 200) : null;
      const { error } = await supabase.from('evaluators').update({ name }).eq('token', token);
      if (error) {
        console.error('register failed', error);
        return json({ error: 'register failed' }, 500);
      }
      return json({ ok: true });
    }
    if (body.kind === 'feedback') {
      const { error } = await supabase.from('feedback').insert({
        evaluator_token: token,
        turn_id: typeof body.turnId === 'string' ? body.turnId : null,
        rating: typeof body.rating === 'string' ? body.rating : null,
        comment: typeof body.comment === 'string' ? body.comment.slice(0, 5000) : null,
      });
      if (error) {
        console.error('feedback insert failed', error);
        return json({ error: 'feedback failed' }, 500);
      }
      return json({ ok: true });
    }
    return json({ error: 'unknown kind' }, 400);
  } catch (e) {
    console.error('capture threw', e);
    return json({ error: 'capture failed' }, 500);
  }
});
