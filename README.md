# molstar-chat-driver

A **chat interface for [Mol\*](https://molstar.org/)**. Type a natural-language prompt, get a
molecular scene rendered in the viewer — powered by
[MolViewSpec (MVS)](https://molstar.org/mol-view-spec-docs/).

> **Licence:** free for academic, research, and other noncommercial use. Commercial use needs a
> separate licence — see [Licence](#licence) below.

---

## What it does

```
  prompt ──▶ backend ──▶ MVSJ ──▶ Mol* renders
            (your model)  (scene tree)  (3D view)
```

You give it a **backend** (anything that turns a prompt into an MVS scene — usually a small
service that calls an LLM) and a **Mol\* viewer**. It mounts a chat panel beside the viewer and
renders whatever scene each prompt produces. That's the whole job.

## Design in one breath

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

## Try the demo (no backend, no API keys)

```bash
npm install
npm run demo      # → http://localhost:8765
```

The demo's backend is a mock that builds a *real* MVS scene from your prompt using Mol\*'s own
builder, so the whole loop runs locally. Try:

- `show hemoglobin as cartoon coloured blue, with its ligands`
- `lysozyme surface in green`
- `4ins as ball and stick`

## Use it in your app

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

## API surface

| Export | What it is |
|---|---|
| `mountChatDriver(target, config)` | Mounts the chat panel UI; returns `{ driver, destroy }`. |
| `ChatDriver` | Headless core (prompt → backend → render), with an `onTurn` hook. |
| `createHttpBackend(url)` / `createMockBackend(build)` | Backends. |
| `createUmdRenderer(molstar, viewer)` | `MvsRenderer` over the Mol\* UMD viewer. |
| `ChatRequest` / `ChatResponse` / `ChatTurn` / `MvsRenderer` | The types. |

## Licence

[PolyForm Noncommercial License 1.0.0](./LICENSE.md). Free for any noncommercial purpose
(academic, research, education, government, personal). **Commercial use requires a separate
licence** — contact **dan.bolser@outsee.co.uk**.

Mol\* itself is MIT-licensed and is used here as a peer dependency.
