# molstar-chat-driver

A LLM backed **chat interface for [Mol\*](https://molstar.org/)** powered by
[MolViewSpec (MVS)](https://molstar.org/mol-view-spec-docs/).

For context, you should see [the Mol\* viewer](https://molstar.org/viewer/).

> **Licence:** [MIT](./LICENSE.md) — free and open for any use, including commercial.

---

## Try `molstar-chat` locally

Mol\* is browser native, so there's no separate app to install. For testing,
this package combines the `molstar-chat-driver` plugin within the Mol\* browser
application via a small JavaScript library that simply loads the plugin's chat
box next to the Mol\* viewer.

The fastest way to see it in action is to simply run the bundled demo (below).


### 1. Run the minimal demo (no API key needed)

```bash
npm install
npm run demo # → http://localhost:8765
```

With no API key, the demo runs in *keyword mode*, mapping a very few keywords to
a hand-authored MVS scene. Try:

- `show hemoglobin as cartoon coloured blue, with its ligands`
- `lysozyme surface green`
- `please load 4ins as ball and stick`

This mock backend only understands a handful of patterns for testing layout.
**To test the plugin properly configure an LLM backend** (below).


### 2. Connect a real model

The plugin never calls an LLM *directly* — your API key stays on a server you
control (browsers can't keep secrets, and most LLM APIs block direct browser
calls). The chat panel just POSTs the prompt to an HTTP backend and renders the
MVS scene it returns.

The demo's bundled backend ([`demo/server.mjs`](./demo/server.mjs), started by
`npm run demo`) is therefore **keyword-only** — great for developing the UI
offline, but it doesn't understand free-form language. For real
natural-language → MVS, run a **model-backed backend** that speaks the same
[contract](#the-backend-contract). This repo ships one —
[`examples/molbench_backend.py`](./examples/molbench_backend.py), powered by
[MolBench](https://github.com/dbolser/MolBench) — see
[Run a local "production" setup](#run-a-local-production-setup) below.

**Picking a model.** The backend is where the smarts live. Getting a model to
emit *valid, correct* MVS reliably — priming it with the schema, grounding
residue numbers in real structures, optimising the prompt — is the real work,
and it varies a lot by model. MolBench is the open benchmark where we develop
and measure that across providers; a production backend can build on it
directly, so its improvements reach the chat box with no change here.


## Run a local "production" setup

A realistic setup is three small pieces: the **plugin** (built), a
**model-backed backend**, and a **host page** wiring them together.

**1. Build a host page.** The demo page doubles as one:
```bash
npm install
npm run build:demo        # bundles demo/dist/demo.js (no server started)
```

**2. Start a model-backed backend.** The bundled reference backend is built on
MolBench — its schema-primed prompt plus provider adapters:
```bash
pip install -e /path/to/MolBench          # makes `molbench` importable
export ANTHROPIC_API_KEY=sk-ant-...        # or OPENAI_/GEMINI_/OPENROUTER_API_KEY
python examples/molbench_backend.py        # → http://localhost:8787/chat
```
Choose the model with `MCD_MODEL` (default `anthropic:claude-haiku-4-5` — small,
cheap, and strong on MVS per MolBench). Because it honours the
[contract](#the-backend-contract), every prompt/grounding/optimisation
improvement in MolBench flows through with no change to the plugin.

**3. Serve the host page** (any static server) — it talks to the backend on
`localhost:8787`:
```bash
python -m http.server --directory demo 8765   # → http://localhost:8765
```

> Use this three-step flow for real models — not `npm run demo`, which starts the
> keyword stub on the same port. Point at a remote backend by setting the
> `BACKEND` constant in `demo/demo.ts` (or your own host page) and rebuilding.


## Add molstar-chat-driver

For developers embedding the chat driver in their own page.

```ts
import { createHttpBackend, createUmdRenderer, mountChatDriver } from 'molstar-chat-driver';

// 1. A Mol* viewer (UMD bundle shown here; an ES-library viewer also works — see below).
const viewer = await window.molstar.Viewer.create('viewer', { layoutShowControls: false });

// 2. Mount the chat panel, wired to your backend.
mountChatDriver('chat', {
  backend: createHttpBackend('https://your-service.example/chat'),
  renderer: createUmdRenderer(window.molstar, viewer),
  placeholder: 'Ask for a molecular view…',
});
```


### The backend contract

Your backend receives a `ChatRequest` and returns a `ChatResponse`:

```jsonc
// POST body  (ChatRequest)
{ "prompt": "show hemoglobin as cartoon coloured by chain", "model": "optional-model-id" }

// response   (ChatResponse)
{
  "mvsj": "{\"root\":{…}}",  // the MVS scene as MVSJ text, or null if no scene
  "text": "optional assistant text to show in the chat",
  "error": null               // optional error message
}
```

That's the only thing your service must implement. Keep any API keys on the service — the
browser only ever sends the prompt.


### Rendering with the Mol\* ES library (instead of the UMD bundle)

If you embed Mol\* as an ES module rather than the UMD bundle, implement `MvsRenderer`
yourself — it is two calls:

```ts
import { loadMVS } from 'molstar/lib/extensions/mvs/load';
import { MVSData } from 'molstar/lib/extensions/mvs/mvs-data';
import type { MvsRenderer } from 'molstar-chat-driver';

const renderer: MvsRenderer = {
  async loadMvsj(mvsj) {
    await loadMVS(plugin, MVSData.fromMVSJ(mvsj), { sanityChecks: true });
  },
};
```

Make sure your plugin spec registers MVS support via `MolViewSpecBehavior`
(`molstar/lib/extensions/mvs/behavior`).


### Add it to an existing Mol\* app (e.g. an RCSB-style site)

If you already run Mol\* on your site, adding the chat box is small: give it a
container element, build an `MvsRenderer` over your existing plugin, and point it
at your backend.

```ts
import { createHttpBackend, mountChatDriver, type MvsRenderer } from 'molstar-chat-driver';
import { loadMVS } from 'molstar/lib/extensions/mvs/load';
import { MVSData } from 'molstar/lib/extensions/mvs/mvs-data';

// `plugin` is your app's existing Mol* PluginUIContext.
const renderer: MvsRenderer = {
  loadMvsj: (mvsj) => loadMVS(plugin, MVSData.fromMVSJ(mvsj), { sanityChecks: true }),
};

mountChatDriver(document.getElementById('chat')!, {
  backend: createHttpBackend('https://mvs.your-org.example/chat'),
  renderer,
  placeholder: 'Ask for a view…',
});
```

Two things to check:
- Your Mol\* plugin spec registers MVS support (`MolViewSpecBehavior` from
  `molstar/lib/extensions/mvs/behavior`) — most viewer builds already do.
- Your backend allows the site's origin (CORS) — the browser calls it directly.

Being MIT-licensed, it drops into an MIT Mol\* deployment with no licensing
friction (the reason we chose MIT).


## What it does

```
     prompt   ──▶  backend ──▶ MVSJ ──▶ Mol* renders
  (your model)  (scene tree)  (3D view)
```

You give it a **backend** (anything that turns a prompt into an MVS scene — usually a small
service that calls an LLM) and a **Mol\* viewer**. It mounts a chat panel beside the viewer and
renders whatever scene each prompt produces. That's the whole job.

The unit of exchange is **MVSJ text**, which keeps the pieces independent:

- **Rendering is free** — Mol\* loads MVS natively (`MVSData.fromMVSJ` → `loadMVS`). This package
  writes no rendering code.
- **No build-time dependency on Mol\*** — Mol\* is an *optional peer dependency*. You pass your
  Mol\* instance in; we touch it through a tiny local interface, so the package stays small and
  version-flexible.
- **The backend is an injected seam** — the chat panel doesn't know or care how prompts become
  scenes. Mock it locally, or point it at your own service.
- **One neutral observer hook** — an optional `onTurn(turn)` callback lets you log or record
  completed turns, without the plugin needing any opinion about it.


## API surface

| Export | What it is |
|---|---|
| `mountChatDriver(target, config)` | Mounts the chat panel UI; returns `{ driver, destroy }`. |
| `ChatDriver` | Headless core (prompt → backend → render), with an `onTurn` hook. |
| `createHttpBackend(url)` / `createMockBackend(build)` | Backends. |
| `createUmdRenderer(molstar, viewer)` | `MvsRenderer` over the Mol\* UMD viewer. |
| `ChatRequest` / `ChatResponse` / `ChatTurn` / `MvsRenderer` | The types. |


## Licence

[MIT](./LICENSE.md) — free and open for any use, commercial or non-commercial; just keep the
copyright notice. Chosen so it drops cleanly into any Mol\* deployment (Mol\* is MIT too).
