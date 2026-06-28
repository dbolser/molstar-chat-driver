# molstar-chat-driver

Turn natural-language prompts into [MolViewSpec (MVS)](https://molstar.org/mol-view-spec-docs/)
scenes, render them in [Mol\*](https://molstar.org/), and reliably capture prompts, ratings,
and feedback.

Built for the [MolBench](https://github.com/dbolser/MolBench) human-evaluation effort — but it
works standalone wherever you want a "chat → molecular view" loop.

> **Licence:** free for academic, research, and other noncommercial use.

---

## What it does

```
  prompt ──▶ endpoint ──▶ MVSJ ──▶ Mol* renders ──▶ evaluator rates ──▶ capture
            (your LLM)   (scene     (3D view)        (failed/OK/…)     (Supabase)
             server)      tree)
```

A model emits an **MVS scene tree** (as MVSJ text), Mol\* renders it natively, and every
prompt + result + rating is captured. The same driver powers two modes:

- **Standardised evaluation** — fixed prompts × models, rate each one.
- **Free-play** — prompt anything; we record it (and your feedback) to grow the benchmark.

## Design in one breath

The contract between everything is **MVSJ text**. That keeps the pieces decoupled:

- **Rendering is free** — Mol\* loads MVS natively (`MVSData.fromMVSJ` → `loadMVS`). We write
  no rendering code.
- **No build-time dependency on Mol\*** — Mol\* is an *optional peer dependency*. You pass your
  Mol\* instance in; we touch it through a tiny local interface. The package stays tiny.
- **The LLM call is an injected seam** — the browser POSTs to an endpoint URL and never holds a
  key. See [CONTRACT.md](./CONTRACT.md).
- **Capture is a pluggable sink** — console in dev, HTTP (Supabase) in production.

## Try the demo (no backend, no API keys)

```bash
npm install
npm run demo      # → http://localhost:8765
```

The demo's "model" is a mock that builds a *real* MVS scene from your prompt using Mol\*'s own
builder, so the whole loop runs locally. Try:

- `show hemoglobin as cartoon coloured blue, with its ligands`
- `lysozyme surface in green`
- `4ins as ball and stick`
- `break` — to see how a Tier-0 (no-valid-MVS) failure is handled.

Open the browser console to watch the `[capture:…]` events stream.

## Use it in your app

```ts
import {
  createHttpEndpoint,
  createUmdRenderer,
  createHttpCaptureSink,
  mountChatDriver,
} from 'molstar-chat-driver';

// 1. A Mol* viewer (UMD bundle shown here; an ES-library viewer also works — see below).
const viewer = await window.molstar.Viewer.create('viewer', { layoutShowControls: false });

// 2. Wire the driver to your endpoint + capture collector.
mountChatDriver('chat', {
  endpoint: createHttpEndpoint('https://<project>.supabase.co/functions/v1/run-model'),
  renderer: createUmdRenderer(window.molstar, viewer),
  capture:  createHttpCaptureSink('https://<project>.supabase.co/functions/v1/capture'),
  sessionId: '<unguessable token from the invite link>',
  evaluatorId: '<name the evaluator entered>',
  models: ['anthropic:claude-haiku-4-5', 'openai:gpt-5', 'gemini:gemini-2.5'],
});
```

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
| `ChatDriver` | Headless orchestration (prompt → endpoint → render → capture). |
| `createHttpEndpoint(url)` / `createMockEndpoint(build)` | Endpoint clients. |
| `createUmdRenderer(molstar, viewer)` | `MvsRenderer` over the Mol\* UMD viewer. |
| `consoleCaptureSink` / `createHttpCaptureSink(url)` / `combineSinks(...)` | Capture sinks. |
| `EndpointRequest` / `EndpointResponse` / `CaptureEvent` / … | The shared types. |

See [CONTRACT.md](./CONTRACT.md) for the request/response and capture-event schemas.

## Relationship to MolBench

This plugin and [MolBench](https://github.com/dbolser/MolBench) are **siblings, not
dependencies**. They share one contract — the **MVS scene tree** — and nothing else:

- MolBench grades MVS scene trees.
- This plugin produces MVS (from prompts) and renders it.
- The optional MolBench grading overlay rides along in MVS `node.custom.*` fields, via Mol\*'s
  [custom load extensions](https://molstar.org/mol-view-spec-docs/mvs-molstar-extension/load-extensions/)
  — rendered if present, ignored if absent.

MolBench is fully open (MIT/Apache). This plugin is source-available under a noncommercial
licence; keeping it in its own repo keeps that boundary clean.

## Licence

[PolyForm Noncommercial License 1.0.0](./LICENSE.md). Free for any noncommercial purpose
(academic, research, education, government, personal). **Commercial use requires a separate
licence** — contact **dan.bolser@outsee.co.uk**.

Mol\* itself is MIT-licensed and is used here as a peer dependency.
