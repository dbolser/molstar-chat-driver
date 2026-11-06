// Edge Function `health` — liveness check that is also the keep-alive.
// GET -> { ok: true } after one real database read. Supabase pauses a Free-plan project that gets
// too little *database* activity in a week, and an idle preview site gets none, so a scheduled
// GitHub Actions job (.github/workflows/keepalive.yml) calls this once a day. Public on purpose:
// it reads a row count with the service role and returns nothing but ok/not-ok.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET') return json({ error: 'GET only' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') as string,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string,
  );
  // `head: true` runs `select count(*)` without returning rows; the count itself is not exposed.
  const { error } = await supabase.from('evaluators').select('token', { count: 'exact', head: true });
  if (error) {
    console.error('health db read failed', { code: error.code });
    return json({ ok: false }, 503);
  }
  return json({ ok: true });
});
