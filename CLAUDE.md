# CLAUDE.md

Orientation for working in this repo (for agents and contributors). User-facing usage docs live
in [README.md](./README.md).

## What this is

`molstar-chat-driver` — an MIT-licensed chat interface for [Mol\*](https://molstar.org/). One job:
**natural-language prompt → MolViewSpec (MVS) scene → rendered in Mol\***. It is a thin client; the
intelligence (the NL→MVS prompt + grounding) lives in a *backend*, developed in
[MolBench](https://github.com/dbolser/MolBench).

## Architecture — three layers

1. **Plugin (`src/`)** — UI / render / transport, prompt-agnostic, rarely changes. Exports:
   `mountChatDriver` (chat panel), `ChatDriver` (headless core with an `onTurn(turn)` observer
   seam), `createHttpBackend(url, { headers })` / `createMockBackend`, `createUmdRenderer`. It
   holds **no API keys and does no prompting** — those are the backend's job.
2. **Backend** — turns a prompt into a scene. The real one wraps MolBench's prompt + adapters.
3. **Contract** — the only thing between them: `POST {prompt, model} → {mvsj, text?, error?}`
   (plus an optional `GET /models`). `mvsj` is MVSJ **text**, or `null` for "no scene".

## ⚠️ The one gotcha when writing a model-backed backend

A model prompted for MVS typically returns a **bare `{"root": …}` tree with no `metadata`**. Mol\*'s
`MVSData.fromMVSJ` / `sanityChecks` **require a full state with `metadata.version`**, or rendering
fails with *"Loaded MVS does not contain valid version info."* So a backend MUST wrap the model's
tree before returning it:

```json
{ "metadata": { "version": "1", "timestamp": "<ISO-8601>" }, "root": { "kind": "root", "...": "..." } }
```

The reference backend does this with `molbench.mvs.extract_root` (which accepts a full state, a
`{root}` wrapper, or a bare root node).

## Backends in this repo

- **`demo/server.mjs`** — keyword-only dev stub (no keys, no LLM). Started by `npm run demo`; maps
  a few keywords to a hand-authored scene so the UI can be developed offline.
- **`examples/molbench_backend.py`** — the real one: MolBench-as-a-service (its schema-primed
  prompt + provider adapters, the envelope wrap above). Needs `pip install -e <MolBench>` and a
  provider key. See README → "Run a local production setup".

> A hosted preview site (static Pages + Supabase Edge Functions) is being added — once merged it
> lands under `site/` and `supabase/` with its own `site/SETUP.md`.

## Commands (Node ≥ 22)

| command | does |
|---|---|
| `npm run build` | bundle the library → `dist/` (+ `.d.ts`) |
| `npm run demo` | serve the demo page + keyword stub (`:8765` / `:8787`) |
| `npm run build:demo` | bundle the demo page only (serve it yourself, any backend) |
| `npm test` | run the test suite (`node --test` via tsx) |
| `npm run typecheck` | `tsc --noEmit` |

## Layout & conventions

- `src/` library · `demo/` keyword demo + dev server · `examples/` MolBench-powered backend ·
  `test/` tests.
- Mol\* is an **optional peer dependency**: loaded as the UMD bundle from a CDN in the demo, or
  embed it as an ES library and implement `MvsRenderer` yourself (README shows both).
- Keep prompting and API keys **out of the plugin** — they belong in the backend, behind the
  contract.
- `tsconfig` type-checks `src/` only; `demo/` (and other apps) are bundled with esbuild, not
  type-checked by `npm run typecheck`.
- Changes go through PRs; CI (`test`) must pass before merge.
