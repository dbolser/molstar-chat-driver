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

async function main(): Promise<void> {
  const viewer = await window.molstar.Viewer.create('viewer', {
    layoutIsExpanded: false,
    layoutShowControls: false,
    layoutShowLog: false,
    layoutShowLeftPanel: false,
    viewportShowExpand: true,
  });

  mountChatDriver('chat', {
    backend: createHttpBackend('http://localhost:8787/chat'),
    renderer: createUmdRenderer(window.molstar, viewer),
    placeholder: 'e.g. "show hemoglobin as cartoon coloured blue, with its ligands"',
    welcome: 'Type a request to build a molecular scene. Try “lysozyme surface in green” or “4ins as ball and stick”.',
  });
}

void main();
