// Structure grounding — is the PDB entry the model chose the one the user asked for?
//
// Models know protein names far better than PDB ids: probing Haiku on 12 named-protein prompts
// (2026-09-30) gave 0 non-existent ids but 3 *wrong* structures (a SARS-CoV-2 RBD for "nanobody
// bound to GFP"…), and a real evaluator hit a 404 for a made-up id. Shown the entry's title, the
// model spots a wrong pick every time, but its second guess is still wrong — it needs real
// candidates. So: look the entry up at RCSB, let the model say OK or name a search phrase, run
// that phrase through RCSB search, and hand back the hits (with titles) to pick from. One extra
// short call when the pick is fine (~1s); a search + one more call when it is not (~3-5s).
//
// Pure helpers here (no model calls); `generateScene` drives the loop. Every RCSB call is
// best-effort with a short timeout: grounding must never break a turn.

export interface Entry {
  id: string;
  /** RCSB title, or null when the entry does not exist. */
  title: string | null;
}

const RCSB_TIMEOUT_MS = 6000;
const ID_RE = /files\.rcsb\.org\/download\/([0-9][a-z0-9]{3})\.(?:cif|bcif|pdb)/gi;

async function rcsb(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RCSB_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** PDB ids downloaded by a scene (upper-cased, deduped, in order of appearance). */
export function pdbIds(mvsj: string): string[] {
  return [...new Set([...mvsj.matchAll(ID_RE)].map((m) => m[1].toUpperCase()))];
}

// An id the user typed is authoritative. Left to itself the model "corrects" a typed id to a
// better-known neighbour (Haiku turned `1hh0` into 1HHO, haemoglobin, 2026-10-20) and the
// check/search loop above then searches a correctly-copied id away because its title does not
// match the rest of the request (1HH0 → 3O7Q for "indicate the transmembrane region"). So typed
// ids are pinned into the scene and never put through the loop.
const TYPED_RE = /\b([1-9][a-z0-9]{3})\b/gi;
const NOT_AN_ID = /^\d+(st|nd|rd|th|am|pm)$/i; // "20th", "10am"

/** PDB ids the user spelled out in the prompt (upper-cased, deduped). */
export function typedIds(prompt: string): string[] {
  const ids = [...prompt.matchAll(TYPED_RE)].map((m) => m[1].toUpperCase());
  return [...new Set(ids.filter((id) => /[A-Z]/.test(id) && !NOT_AN_ID.test(id)))];
}

/**
 * Swap the one id the model chose for the one the user typed, when exactly one of each is
 * unaccounted for. `typed` = typed ids known to exist; `fresh` = ids the scene introduces.
 * Returns the rewritten MVSJ and a note, or the input unchanged and null.
 */
export function pinTypedIds(mvsj: string, typed: string[], fresh: string[]): { mvsj: string; note: string | null } {
  const have = new Set(pdbIds(mvsj));
  const wanted = typed.filter((id) => !have.has(id));
  const stray = fresh.filter((id) => !typed.includes(id));
  if (wanted.length !== 1 || stray.length !== 1) return { mvsj, note: null };
  const re = new RegExp(`(files\\.rcsb\\.org/download/)${stray[0]}(\\.(?:cif|bcif|pdb))`, 'gi');
  return { mvsj: mvsj.replace(re, `$1${wanted[0].toLowerCase()}$2`), note: `kept your id ${wanted[0]} (model wrote ${stray[0]})` };
}

/** Title lookup via the RCSB Data API. A 404 means the entry does not exist. Throws on other failures. */
export async function lookup(ids: string[]): Promise<Entry[]> {
  return Promise.all(
    ids.map(async (id) => {
      const res = await rcsb(`https://data.rcsb.org/rest/v1/core/entry/${id}`);
      if (res.status === 404) return { id, title: null };
      if (!res.ok) throw new Error(`RCSB data API HTTP ${res.status}`);
      const data = await res.json();
      return { id, title: String(data?.struct?.title ?? '(untitled)') };
    }),
  );
}

/** Full-text RCSB search → top entries with titles. Empty when nothing matches. */
export async function search(phrase: string, n = 6): Promise<Entry[]> {
  const body = {
    query: { type: 'terminal', service: 'full_text', parameters: { value: phrase } },
    return_type: 'entry',
    request_options: { paginate: { start: 0, rows: n } },
  };
  const res = await rcsb('https://search.rcsb.org/rcsbsearch/v2/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 204) return []; // RCSB's "no results"
  if (!res.ok) throw new Error(`RCSB search HTTP ${res.status}`);
  const hits = ((await res.json())?.result_set ?? []).map((h: { identifier: string }) => h.identifier);
  return lookup(hits);
}

/** The check the model answers with `OK` or `SEARCH: <phrase>`. */
export function checkMessage(entries: Entry[]): string {
  const facts = entries.map((e) => (e.title ? `PDB ${e.id} is titled "${e.title}".` : `PDB ${e.id} does not exist (HTTP 404).`));
  return (
    `Check: ${facts.join(' ')} If the entry fits the request, reply with the single word OK. ` +
    'If it does not (or does not exist), reply with SEARCH: followed by a short RCSB search phrase ' +
    '(the protein or complex name, 1-4 words) — nothing else.'
  );
}

/** Parse the model's answer to {@link checkMessage}: `null` = OK, else the search phrase. */
export function searchPhrase(reply: string): string | null {
  const s = reply.trim();
  if (/^ok\b/i.test(s)) return null;
  const m = s.match(/SEARCH:\s*(.+)/i);
  return m ? m[1].split('\n')[0].trim().slice(0, 100) : null; // anything else: don't second-guess it
}

/** The follow-up handing the model real candidates to pick from. */
export function candidatesMessage(phrase: string, hits: Entry[]): string {
  const list = hits.map((h) => `${h.id}: ${h.title}`).join('\n');
  return `RCSB search results for "${phrase}":\n${list}\n\nReturn the corrected scene using the best-matching entry from this list.`;
}

/** One line per entry for the user: what actually got loaded. */
export function loadedText(entries: Entry[]): string {
  return entries.filter((e) => e.title).map((e) => `Loaded ${e.id} — ${e.title}`).join('\n');
}
