// Edge Function `rate` — the judge-agreement rating page (site/rate.html).
// POST { token, set, items, answer? } -> { next, done }
//   `items`  every item id in the set (from the set's items.json), so nothing needs seeding
//   `answer` { item, label: 'same'|'different'|'unsure', note?, ms? } — saved first (answering an
//            item again replaces the earlier answer)
//   `next`   the item to show next (one this evaluator hasn't rated, least-rated first), or null
//   `done`   how many items of this set the evaluator has rated
// The token must match a pre-issued invite (the `evaluators` allowlist) or the call is rejected.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json } from '../_shared/cors.ts';
import { isInvited } from '../_shared/auth.ts';

const SET_RE = /^[a-z0-9-]{1,40}$/;
const ITEM_RE = /^[0-9a-f]{12}$/;
const LABELS = new Set(['same', 'different', 'unsure']);
const MAX_ITEMS = 2000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (parsed === null || typeof parsed !== 'object') throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const token = typeof body.token === 'string' ? body.token : null;
  const set = typeof body.set === 'string' && SET_RE.test(body.set) ? body.set : null;
  const items = Array.isArray(body.items) && body.items.length <= MAX_ITEMS &&
      body.items.every((i) => typeof i === 'string' && ITEM_RE.test(i))
    ? (body.items as string[])
    : null;
  if (!token || !set || !items) return json({ error: 'needs token, set and items' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') as string,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string,
  );
  if (!(await isInvited(supabase, token))) return json({ error: 'invalid evaluator token' }, 403);

  try {
    const a = body.answer as Record<string, unknown> | undefined;
    if (a !== undefined) {
      if (typeof a !== 'object' || a === null || typeof a.item !== 'string' || !items.includes(a.item) ||
          typeof a.label !== 'string' || !LABELS.has(a.label)) {
        return json({ error: 'answer needs an item from the set and a label' }, 400);
      }
      const { error } = await supabase.from('ratings').upsert({
        evaluator_token: token,
        set_id: set,
        item: a.item,
        label: a.label,
        note: typeof a.note === 'string' && a.note.trim() ? a.note.slice(0, 2000) : null,
        ms: typeof a.ms === 'number' && Number.isFinite(a.ms) ? Math.min(Math.max(0, Math.round(a.ms)), 2_000_000_000) : null,
        client: req.headers.get('x-mcd-client')?.slice(0, 80) ?? null,
        created_at: new Date().toISOString(),
      }, { onConflict: 'evaluator_token,set_id,item' });
      if (error) {
        console.error('rating upsert failed', error);
        return json({ error: 'saving the rating failed' }, 500);
      }
    }
    const [next, done] = await Promise.all([
      supabase.rpc('next_rating_item', { p_token: token, p_set: set, p_items: items }),
      supabase.from('ratings').select('item', { count: 'exact', head: true })
        .eq('evaluator_token', token).eq('set_id', set),
    ]);
    if (next.error || done.error) {
      console.error('rate lookup failed', next.error ?? done.error);
      return json({ error: 'rate lookup failed' }, 500);
    }
    return json({ next: next.data ?? null, done: done.count ?? 0 });
  } catch (e) {
    console.error('rate threw', e);
    return json({ error: 'rate failed' }, 500);
  }
});
