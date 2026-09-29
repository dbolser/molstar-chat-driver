// Prompt suggestions for the site's chip row. Two shapes:
//   • starters  — for a fresh session (no history). A curated seed list mixed with real openers
//                 harvested from the `turns` corpus, shuffled. This is the "give me a random idea
//                 so I don't have to think" button's fuel.
//   • next-step — for an in-progress scene. A tiny Haiku call predicts what the evaluator might
//                 want to ask next, grounded in their recent prompts; if no key / it fails, a
//                 deterministic fallback list stands in so the row is never empty.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Hand-authored openers — always available, and known to render well. Deliberately varied so the
// dice feels fresh. Kept short and imperative to match how the chips read.
export const SEED_STARTERS: string[] = [
  'Show me hen egg white lysozyme',
  'Load haemoglobin (1HHO) and colour it by chain',
  'Display insulin as a cartoon',
  'Show the DNA double helix',
  'Show green fluorescent protein and focus on the chromophore',
  'Load myoglobin with its heme group as ball-and-stick',
  'Show the SARS-CoV-2 spike protein',
  'Display a zinc-finger and highlight the zinc ion',
  'Show ubiquitin as a rainbow-coloured cartoon',
  'Load the ribosome and colour the two subunits differently',
];

// Deterministic follow-ups, used when the model call is unavailable. Generic on purpose — they
// apply to almost any single-structure scene.
const FALLBACK_NEXT: string[] = [
  'Colour it by chain',
  'Show the ligands as ball-and-stick',
  'Focus on the active site',
  'Show the surface, semi-transparent',
  'Colour by secondary structure',
  'Hide the waters',
  'Label the ligand',
];

/** Fisher–Yates, returning the first `n` of a shuffled copy (never mutates the input). */
function sample<T>(arr: T[], n: number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/** Dedupe by trimmed, lower-cased text while preserving the first spelling seen. */
function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of items) {
    const t = s.trim();
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** Starter prompts: curated seed + real openers pulled from the corpus, shuffled to `n`. */
export async function starterSuggestions(supabase: SupabaseClient, n: number): Promise<string[]> {
  let corpus: string[] = [];
  try {
    // Only the FIRST prompt of a session is a real opener. Later tier0 turns (e.g. "Colour it by
    // chain") are mid-scene refinements that assume a molecule already on screen — served as a
    // blank-session starter they'd reference nothing and fail. So pull tier0 turns oldest-first
    // and keep just the earliest prompt per session.
    const { data, error } = await supabase
      .from('turns')
      .select('session_id, prompt')
      .eq('tier0', true)
      .order('created_at', { ascending: true })
      .limit(1000);
    if (!error && Array.isArray(data)) {
      const openerBySession = new Map<string, string>();
      const standalone: string[] = []; // legacy rows without a session_id: each is its own opener
      for (const row of data as { session_id?: string | null; prompt?: unknown }[]) {
        const p = typeof row.prompt === 'string' ? row.prompt.trim() : '';
        if (!p) continue;
        if (row.session_id == null) standalone.push(p);
        else if (!openerBySession.has(row.session_id)) openerBySession.set(row.session_id, p);
      }
      corpus = [...openerBySession.values(), ...standalone].filter(
        (p) => p.length >= 10 && p.length <= 120 && /\b(show|load|display|render|view|colou?r)\b/i.test(p),
      );
    }
  } catch (e) {
    console.error('starter corpus fetch failed (using seed only)', e);
  }
  // Seed always in the pool so quality never depends on there being corpus data yet.
  return sample(dedupe([...SEED_STARTERS, ...corpus]), n);
}

const SUGGEST_SYSTEM =
  'You suggest what a user of a molecular-structure viewer might want to ask NEXT. Given their ' +
  'recent natural-language prompts, propose short imperative follow-up prompts that refine or ' +
  'extend the current 3D scene (e.g. "Colour it by chain", "Show ligands as ball-and-stick", ' +
  '"Focus on the active site"). Each must be at most 8 words, specific to the conversation, and ' +
  'must NOT repeat something already asked. Reply with ONLY a JSON array of strings.';

/** Pull a JSON array of short strings out of a model reply (tolerates prose around it). */
function parseList(raw: string, n: number): string[] {
  const a = raw.indexOf('[');
  const b = raw.lastIndexOf(']');
  if (a === -1 || b <= a) return [];
  try {
    const arr = JSON.parse(raw.slice(a, b + 1));
    if (!Array.isArray(arr)) return [];
    return dedupe(arr.filter((s): s is string => typeof s === 'string').map((s) => s.slice(0, 80))).slice(0, n);
  } catch {
    return [];
  }
}

/** Next-step prompts for an in-progress scene. LLM-backed (Haiku); falls back deterministically.
 *  `allowModel=false` (e.g. a per-token cap reached) skips the model call and returns the fallback. */
export async function nextSuggestions(recent: string[], n: number, allowModel = true): Promise<string[]> {
  const already = new Set(recent.map((p) => p.trim().toLowerCase()));
  const fallback = sample(FALLBACK_NEXT.filter((p) => !already.has(p.toLowerCase())), n);

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!allowModel || !key || recent.length === 0) return fallback;
  const model = Deno.env.get('MCD_SUGGEST_MODEL') || 'claude-haiku-4-5';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000); // keep the chip row snappy; don't hang the UI
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        system: SUGGEST_SYSTEM,
        messages: [{ role: 'user', content: `Recent prompts (oldest first):\n${recent.join('\n')}` }],
      }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    const text = (data?.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('');
    const out = parseList(text, n).filter((p) => !already.has(p.toLowerCase()));
    return out.length ? out : fallback;
  } catch (e) {
    console.error('next-step suggestion failed (using fallback)', e);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
