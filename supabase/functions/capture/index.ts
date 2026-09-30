// Edge Function `capture` — records evaluator identity and free-text feedback.
// POST { token, kind: 'register', name } -> set the invited evaluator's name.
// POST { token, kind: 'feedback', comment?, rating?, turnId?, screenshot? } -> store feedback
//      (`screenshot` is a small JPEG/PNG data URL of the viewer; saved to the `shots` bucket).
// POST { token, kind: 'render', turnId, rendered, error? } -> record whether Mol* rendered a turn.
// Writes use the service role (bypasses RLS), so the browser never touches the DB directly.
// The token must match a pre-issued invite (the `evaluators` allowlist) or the call is rejected.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json } from '../_shared/cors.ts';
import { isInvited } from '../_shared/auth.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Screenshots go to the private `shots` storage bucket (see schema.sql), one file per feedback
// row, and the row keeps the path. Capped at 1 MB; anything odd is dropped, never a failure —
// the words matter more than the picture.
const SHOT_MAX_BYTES = 1_000_000;
const DATA_URL_RE = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/;

async function saveScreenshot(supabase: SupabaseClient, token: string, shot: unknown): Promise<string | null> {
  if (typeof shot !== 'string') return null;
  const m = shot.match(DATA_URL_RE);
  if (!m) return null;
  const [, ext, b64] = m;
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); // atob throws on bad base64
    if (bytes.byteLength > SHOT_MAX_BYTES) return null;
    const path = `${token.slice(0, 8)}/${crypto.randomUUID()}.${ext === 'jpeg' ? 'jpg' : 'png'}`;
    const { error } = await supabase.storage.from('shots').upload(path, bytes, { contentType: `image/${ext}` });
    if (error) throw new Error(error.message);
    return path;
  } catch (e) {
    console.error('screenshot dropped', { message: (e as Error).message });
    return null;
  }
}

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
        screenshot: await saveScreenshot(supabase, token, body.screenshot),
      });
      if (error) {
        console.error('feedback insert failed', error);
        return json({ error: 'feedback failed' }, 500);
      }
      return json({ ok: true });
    }
    if (body.kind === 'render') {
      // The server sees whether a scene parsed; only the browser knows whether Mol* drew it.
      // Scoped to the evaluator's own turn so a token can't rewrite someone else's row.
      if (typeof body.turnId !== 'string' || !UUID_RE.test(body.turnId) || typeof body.rendered !== 'boolean') {
        return json({ error: 'render needs a turnId (uuid) + rendered (boolean)' }, 400);
      }
      const { error } = await supabase
        .from('turns')
        .update({
          rendered: body.rendered,
          render_error: typeof body.error === 'string' ? body.error.slice(0, 2000) : null,
        })
        .eq('id', body.turnId)
        .eq('evaluator_token', token);
      if (error) {
        console.error('render capture failed', error);
        return json({ error: 'render capture failed' }, 500);
      }
      return json({ ok: true });
    }
    return json({ error: 'unknown kind' }, 400);
  } catch (e) {
    console.error('capture threw', e);
    return json({ error: 'capture failed' }, 500);
  }
});
