# TODO

Remaining items from the code review. Grouped by where they bite.

## Correctness / robustness

- [ ] **PDB-id regex is too eager** — `demo/server.mjs` `pickEntry` (`/\b([0-9][a-z0-9]{3})\b/`).
      Any 4-char token starting with a digit is treated as a PDB id, so "show me the 2024
      cryo-EM model" tries to download `2024_updated.cif` (404) instead of falling back to the
      keyword-mode hint. Tighten the pattern, or only treat it as an id when no named entry or
      display verb matched.

- [ ] **`void main()` can leave a blank demo** — `demo/demo.ts`.
      If the Mol* CDN script is blocked or `Viewer.create` rejects, `main()` throws before the
      chat panel mounts: blank page, error only in the console. Add a `.catch` that renders a
      visible "couldn't start the viewer" message. (`fetchModels` is already guarded; this is the
      `Viewer.create` / mount path.)

## Cleanups

- [ ] **`createMockBackend` is exported but unused** — `src/backend.ts`.
      Either wire it into the demo (e.g. an offline keyword path) or stop exporting it until a
      consumer needs it.

- [ ] **Duplicated colour literal** — `demo/server.mjs`.
      `#FF7F0E` (orange) appears both in `pickColor` and in the hard-coded ligand component.
      Hoist a small named palette and reference it once.

- [ ] **Dead branch in `pickColor`** — `demo/server.mjs`.
      The explicit `blue` case returns the same `#3050F8` the default already returns. Drop the
      `blue` check (or make blue the documented default).

## Nice-to-have

- [ ] Surface the active backend mode (keyword vs LLM, and which model) in the demo UI, not just
      the server banner — right now the browser can't tell which mode it's talking to.
