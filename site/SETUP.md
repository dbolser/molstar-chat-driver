# Evaluator preview site — setup

A private free-play site: evaluators chat to a real model, scenes render in Mol\*, and every
prompt + feedback is captured. Static frontend on **GitHub Pages**, key-holding backend +
capture on **Supabase** (Edge Functions + Postgres).

```text
browser (Pages)  ──POST /chat──▶  Supabase Edge Function ──▶ model (key as secret)
   plugin + UI                         │ inserts turn (service role)
   ──POST /capture──▶  Edge Function ──┘ inserts evaluator / feedback
                                        ▼
                                   Postgres (you inspect via the dashboard)
```

Every request carries a per-evaluator **invite token** (`?e=<token>`). The Edge Functions reject
any token that isn't in the `evaluators` allowlist, so even though the Pages URL is public it
can't be used to burn model quota or pollute the capture tables.

## 1. Database
In the Supabase **SQL editor**, run [`../supabase/schema.sql`](../supabase/schema.sql). It
creates `evaluators`, `turns`, `feedback`, and `waitlist` with RLS on and **no public policies** —
only the Edge Functions (service role) can touch the data; you read it via the dashboard.
(`waitlist` collects emails from visitors who arrive without an invite token — see §8.) It also
creates the private `shots` storage bucket for feedback screenshots. Safe to re-run after an
upgrade: every column and the bucket are added `if not exists`. From a terminal (after
`npx supabase login`): `node scripts/apply-schema.mjs --project-ref <ref>`.

## 2. Edge Function secrets
Set at least one model key (Project Settings → Edge Functions → Secrets, or the CLI):
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
# optional, to offer/route other providers:
# supabase secrets set OPENAI_API_KEY=...  GEMINI_API_KEY=...  OPENROUTER_API_KEY=...
# optional, change the default model (default anthropic:claude-haiku-4-5):
# supabase secrets set MCD_MODEL=anthropic:claude-haiku-4-5
# optional abuse/cost caps (defaults shown): per-invite calls / 24h, max prompt chars,
# and an optional whole-preview ceiling (0 = off):
# supabase secrets set MCD_TOKEN_DAILY_CAP=50 MCD_MAX_PROMPT_CHARS=8000 MCD_DAILY_CALL_CAP=0
# optional: the chip-row "next step" suggestions (see §9) — model + its own daily per-invite cap
# (0 disables the model path, leaving deterministic fallbacks); default claude-haiku-4-5 / 300:
# supabase secrets set MCD_SUGGEST_MODEL=claude-haiku-4-5 MCD_SUGGEST_DAILY_CAP=300
```
A leaked invite link is a bearer credential, so `chat` caps calls per token per 24h and rejects
over-long prompts; revoke a link instantly with `update evaluators set revoked = true where
token = '…';`.
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into functions automatically — don't set them.

## 3. Deploy the functions
```bash
npm i -g supabase           # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy chat
supabase functions deploy capture
supabase functions deploy waitlist   # public email signup for §8
supabase functions deploy suggest    # prompt-suggestion chips for §9
```
(The shared code in `supabase/functions/_shared/` — including the vendored MolBench prompt — is
bundled automatically.)

## 4. Point the site at your project
Edit [`config.js`](./config.js) with your project's **Functions URL** and **anon key**
(Project Settings → API). Both are public — fine to commit.
```js
window.MCD_CONFIG = {
  functionsUrl: 'https://<project-ref>.supabase.co/functions/v1',
  anonKey: '<anon key>',
};
```

## 5. Publish to GitHub Pages
Repo **Settings → Pages → Source: GitHub Actions**. Merging to `main` runs
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml), which builds `site/` and
deploys it. Your site lands at `https://<user>.github.io/molstar-chat-driver/`.

> To build locally: `npm run build:site` → open `site/index.html` (it needs `config.js` filled in).

## 6. Mint invite links
Each evaluator gets a unique, unguessable token. `scripts/mint-invites.mjs` generates UUIDv4
tokens (122 bits of entropy — not guessable), seeds them into the `evaluators` allowlist, and
prints the secret links. Only seeded tokens work, so this is a real lock, not just discretion.
```bash
export SUPABASE_URL=https://<project-ref>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service-role key>   # Project Settings → API (keep secret!)
export SITE_URL=https://<user>.github.io/molstar-chat-driver

npm run mint:invites -- "Ada Lovelace" "Rosalind Franklin"   # one link per name
# or anonymous: npm run mint:invites -- --count 5
# preview without writing:  npm run mint:invites -- --dry-run --count 3
```
Email each person their `?e=<token>` line and ask them to keep it private. To revoke someone,
delete their row from the `evaluators` table.

## 7. See the data
Supabase dashboard → **Table editor** → `turns` (every prompt + scene, with `tier0` / `repaired` /
`lint` for what the server did, `rendered` / `render_error` for what Mol* did, and `client` /
`server` for which build did it), `feedback` (their comments; `screenshot` is a path in the
`shots` bucket — Storage → shots — showing what they were looking at), and `waitlist` (emails from
would-be evaluators). A turn's rating is the *latest* feedback row for it. The `turns` prompts are the
harvested corpus that will seed the standardised eval and MolBench — and also fuel the starter
suggestions in §9.

## 8. Waitlist (open the front door)
A visitor who opens the bare site **without** an `?e=` token no longer hits a dead end — they get
a small form to leave their email, which the token-free `waitlist` Edge Function stores (validated,
deduped on email). Review `waitlist` in the dashboard, then mint invites (§6) for the people you
want and email them their link. This endpoint is intentionally un-gated (it's the sign-up door),
so it only accepts a well-formed email + optional name and does nothing else.

## 9. Prompt suggestions (the chip row)
Above the composer the site shows tappable prompt chips with a 🎲 to reshuffle, served by the
`suggest` Edge Function:
- **Fresh session** → *starter* ideas: a curated seed list mixed with real openers harvested from
  the `turns` corpus (so a first-time evaluator can start with one tap, no typing).
- **In-progress scene** → *next-step* predictions: a small Haiku call proposes what to ask next,
  grounded in the evaluator's recent prompts. It's gated by its own per-invite daily cap
  (`MCD_SUGGEST_DAILY_CAP`); over the cap — or with no model key — it degrades to a deterministic
  fallback list, so the row is never empty.
