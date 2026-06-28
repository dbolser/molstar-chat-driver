# molstar-chat-driver

A **chat interface for [Mol\*](https://molstar.org/) powered by
[MolViewSpec (MVS)](https://molstar.org/mol-view-spec-docs/)**.

> **Licence:** free for academic, research, and other noncommercial use.

---

## Install and test locally

Mol\* runs in the browser, so there's no separate desktop app to install (unlike PyMOL). This
package is a small JavaScript library you add to a web page — it mounts a chat box next to a
Mol\* viewer and turns what you type into a rendered molecular scene. The fastest way to see it
work is the bundled demo.

### 1. Run the demo (no backend, no API keys)

```bash
npm install
npm run demo      # → http://localhost:8765
```

The demo ships a *mock* backend that builds real MVS scenes from a few keywords using Mol\*'s
own builder, so the whole prompt → scene → render loop runs locally. Try:

- `show hemoglobin as cartoon coloured blue, with its ligands`
- `lysozyme surface in green`
- `4ins as ball and stick`

The mock only understands a handful of patterns — it's there to prove the pipeline, not to chat.
**To actually talk to a model, connect an LLM backend** (next).

### 2. Connect your LLM backend

The plugin never calls an LLM directly — your API key stays on a server you control (browsers
can't keep secrets, and most LLM APIs block direct browser calls anyway). You stand up a small
HTTP endpoint that turns a prompt into an MVS scene, and point the plugin at it:

```ts
backend: createHttpBackend('http://localhost:8787/chat')
```

That endpoint just has to honour the [backend contract](#the-backend-contract): take
`{ prompt, model }`, return `{ mvsj, text?, error? }`. Here is a complete, runnable reference
backend using Claude (Anthropic). Save it as `server.mjs`:

```js
// A minimal LLM backend for molstar-chat-driver.
//   npm install @anthropic-ai/sdk
//   ANTHROPIC_API_KEY=sk-ant-... node server.mjs   →  http://localhost:8787/chat
import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

const SYSTEM = `You turn a user's request into a MolViewSpec (MVS) scene tree.
Reply with ONLY the MVSJ JSON object — no prose, no markdown code fences.
Shape: { "metadata": { "version": "1" }, "root": { "kind": "root", "children": [ ... ] } },
nesting download → parse → structure → component → representation → color nodes.`;

const server = http.createServer(async (req, res) => {
  // Let the browser (a different origin) call this endpoint.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (req.method !== 'POST') return res.writeHead(405).end();

  let body = '';
  for await (const chunk of req) body += chunk;
  const { prompt, model } = JSON.parse(body || '{}');

  try {
    const message = await client.messages.create({
      model: model || 'claude-opus-4-8',
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = message.content.find((b) => b.type === 'text')?.text ?? '';
    // Did the model return parseable MVS JSON?
    let mvsj = null;
    try { JSON.parse(text); mvsj = text; } catch { /* not valid JSON */ }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ mvsj, text: mvsj ? undefined : text }));
  } catch (err) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ mvsj: null, error: String(err) }));
  }
});

server.listen(8787, () => console.log('chat backend → http://localhost:8787/chat'));
```

Run it alongside the demo, then swap the demo's mock backend for the HTTP one — in
`demo/demo.ts`, replace the `createMockBackend(...)` line with:

```ts
backend: createHttpBackend('http://localhost:8787/chat'),
```

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

[PolyForm Noncommercial License 1.0.0](./LICENSE.md). Free for any noncommercial purpose
(academic, research, education, government, personal). **Commercial use requires a separate
licence** — contact **dan.bolser@gmail.com**.

Mol\* itself is MIT-licensed and is used here as a peer dependency.
