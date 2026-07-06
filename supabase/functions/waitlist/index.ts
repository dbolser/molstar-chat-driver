// Edge Function `waitlist` — the public front door for people WITHOUT an invite token.
// POST { email, name?, note? } -> record a request for access. Unlike `chat`/`capture` this is
// deliberately NOT token-gated (the whole point is to let strangers in the door), so it validates
// and length-caps its input and dedupes on email. Writes use the service role.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json } from '../_shared/cors.ts';

// Pragmatic email check: one @, no spaces, a dotted domain. Not RFC-perfect on purpose — it only
// needs to reject obvious junk; a real address is confirmed out-of-band when access is granted.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clip = (v: unknown, n: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const email = clip(body.email, 320)?.toLowerCase() ?? '';
  if (!EMAIL_RE.test(email)) return json({ error: 'please enter a valid email address' }, 400);
  const name = clip(body.name, 200);
  const note = clip(body.note, 2000);
  const source = clip(req.headers.get('referer'), 500);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') as string,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string,
  );

  // ON CONFLICT (email) DO NOTHING — a repeat signup is a success, not an error or a dupe row.
  const { error } = await supabase
    .from('waitlist')
    .upsert({ email, name, note, source }, { onConflict: 'email', ignoreDuplicates: true });
  if (error) {
    console.error('waitlist insert failed', error);
    return json({ error: 'could not save — please try again' }, 500);
  }
  return json({ ok: true });
});
