# molstar-chat-driver

A LLM backed **chat interface for [Mol\*](https://molstar.org/)** powered by
[MolViewSpec (MVS)](https://molstar.org/mol-view-spec-docs/).

For context, you should see [the Mol\* viewer](https://molstar.org/viewer/).

> **Licence:** free for academic, research, and other noncommercial use.

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


### 2. Connect your LLM backend

The plugin does not call an LLM *directly*, this is to protect the underlying
API key (and additionally, most LLM APIs block direct browser calls anyway).
Instead, we call an HTTP endpoint (chat backend) that relays the user prompt to
the configured LLM provider and returns the generated MVS scene tree JSON to
Mol\*.

The demo automatically starts a chat backend with `npm run demo` (see
[`demo/server.mjs`](./demo/server.mjs)), however, any backend that supports the
backend contract ([defined below](#the-backend-contract)) can be used.

To switch from keyword mode to a real model, copy the example env file and add
your API key:

```bash
cp .env.example .env
# then edit .env:  ANTHROPIC_API_KEY=sk-ant-...
```

Restart `npm run demo` and the same page now talks to the model — nothing else to change. Set
`MODEL=` in `.env` to pick a different one (default `claude-opus-4-8`). The bundled server is
also a minimal template for your own backend: swap the Claude call for any provider, keep the
contract, and keep the key on the server.

**Picking a model.** Any provider works — the backend is yours; just return MVSJ. The hard part
is getting the model to emit *valid* MVS reliably, and that varies a lot by model. For a
data-driven view of which models are good at natural-language → MVS (and how they compare), see
**[MolBench](https://github.com/dbolser/MolBench)**, the open benchmark this plugin grew out of.


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

[PolyForm Noncommercial License 1.0.0](./LICENSE.md).
- Free for any noncommercial purpose(academic, research, education, government, personal).
- **Commercial use requires a separate licence** — contact **dan.bolser@gmail.com**.

Mol\* is MIT-licensed and is used here as a peer dependency.
