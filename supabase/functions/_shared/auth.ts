// Evaluator-token gate. The `evaluators` table is the invite allowlist: a token only works if
// it was minted ahead of time (scripts/mint-invites.mjs). This is what makes the public Pages
// URL safe — unknown tokens can't spend model quota or write capture rows.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/** True only if `token` is a known, pre-provisioned evaluator. Fails closed on any DB error. */
export async function isInvited(supabase: SupabaseClient, token: string | null): Promise<boolean> {
  if (!token) return false;
  const { data, error } = await supabase
    .from('evaluators')
    .select('token')
    .eq('token', token)
    .maybeSingle();
  if (error) {
    console.error('evaluator lookup failed', error);
    return false;
  }
  return Boolean(data);
}
