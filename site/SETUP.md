# Evaluator preview site — setup

A private free-play site: evaluators chat to a real model, scenes render in Mol\*, and every
prompt + feedback is captured. Static frontend on **GitHub Pages**, key-holding backend +
capture on **Supabase** (Edge Functions + Postgres).

```
browser (Pages)  ──POST /chat──▶  Supabase Edge Function ──▶ model (key as secret)
   plugin + UI                         │ inserts turn (service role)
   ──POST /capture──▶  Edge Function ──┘ inserts evaluator / feedback
                                        ▼
                                   Postgres (you inspect via the dashboard)
```

## 1. Database
In the Supabase **SQL editor**, run [`../supabase/schema.sql`](../supabase/schema.sql). It
creates `evaluators`, `turns`, `feedback` with RLS on and **no public policies** — only the
Edge Functions (service role) can touch the data; you read it via the dashboard.

## 2. Edge Function secrets
Set at least one model key (Project Settings → Edge Functions → Secrets, or the CLI):
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
# optional, to offer/route other providers:
# supabase secrets set OPENAI_API_KEY=...  GEMINI_API_KEY=...  OPENROUTER_API_KEY=...
# optional, change the default model (default anthropic:claude-haiku-4-5):
# supabase secrets set MCD_MODEL=anthropic:claude-haiku-4-5
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into functions automatically — don't set them.

## 3. Deploy the functions
```bash
npm i -g supabase           # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy chat
supabase functions deploy capture
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

## 6. Invite evaluators
Give each person a link with a unique, unguessable token so their captures are tagged to them:
```
https://<user>.github.io/molstar-chat-driver/?e=$(uuidgen)
```
Generate one per evaluator (any random string works). Ask them to keep it private — Pages is
public, so the token + discretion are the "soft lock".

## 7. See the data
Supabase dashboard → **Table editor** → `turns` (every prompt + scene + tier0) and `feedback`
(their comments). These are the harvested prompts that will seed the standardised eval and the
MolBench corpus.
