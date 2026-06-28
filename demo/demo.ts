/**
 * Local demo: a Mol* chat interface wired to the bundled chat backend (demo/server.mjs),
 * which `npm run demo` starts on http://localhost:8787.
 *
 * The backend runs in keyword mode by default (no API key needed). Add an ANTHROPIC_API_KEY
 * to a .env file (see .env.example) and it switches to a real model — this page doesn't change.
 *
 * Mol* is loaded as the UMD bundle from a CDN (see index.html), exposed as `window.molstar`.
 */
import { createHttpBackend, createUmdRenderer, mountChatDriver } from '../src/index';

declare global {
  interface Window {
    // The Mol* UMD viewer bundle. Loosely typed; we only touch a few entry points.
    molstar: any;
  }
}

const BACKEND = 'http://localhost:8787';

/** Ask the backend which models to offer — it exposes a selector only when 2+ keys are set. */
async function fetchModels(): Promise<{ models: string[]; default?: string }> {
  try {
    const res = await fetch(`${BACKEND}/models`);
    if (res.ok) return await res.json();
  } catch {
    /* backend not up yet — fall back to no picker */
  }
  return { models: [] };
}

async function main(): Promise<void> {
  const viewer = await window.molstar.Viewer.create('viewer', {
    layoutIsExpanded: false,
    layoutShowControls: false,
    layoutShowLog: false,
    layoutShowLeftPanel: false,
    viewportShowExpand: true,
  });

  const { models, default: defaultModel } = await fetchModels();

  mountChatDriver('chat', {
    backend: createHttpBackend(`${BACKEND}/chat`),
    renderer: createUmdRenderer(window.molstar, viewer),
    models,
    defaultModel,
    placeholder: 'e.g. "show hemoglobin as cartoon coloured blue, with its ligands"',
    welcome: 'Type a request to build a molecular scene. Try “lysozyme surface in green” or “4ins as ball and stick”.',
  });
}

void main();
