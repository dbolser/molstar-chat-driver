# TODO

### Preview site

- [ ] **Structured outputs experiment (MolBench).** Constrained decoding
      (`response_format: json_schema`, `strict`) with a trimmed MVS schema would make invalid
      trees impossible by construction. Compare validation failures + F1 against the prompt-only
      path on cheap models.
- [ ] Port the colour-scheme prompt guidance (`custom.molstar_color_theme_name` on the colour
      child) back to MolBench's prompt; the site's `_shared/prompt.ts` has drifted.


---

### Done

- [x] 0.2.1: version stamp on captured data (`turns.client` / `turns.server`); feedback taps
      debounced to the settled choice, with a viewer screenshot; RCSB grounding of PDB entries;
      failed downloads no longer report "rendered"; text replies shown as messages.

- [x] PDB-id regex no longer treats bare numbers ("2024", "1999") as structure ids.
- [x] `demo/demo.ts` shows a visible message instead of a blank page when startup fails.
- [x] `createMockBackend` is now exercised by the test suite (kept as documented public API).
- [x] Colour literals hoisted to a shared `COLORS` palette (removed the duplicated orange and the
      dead `blue` branch in `pickColor`).
- [x] Dropped the `dotenv` dependency in favour of the built-in `util.parseEnv` (Node >= 20.12).
- [x] Surface the active backend mode in the demo UI: `keyword` is now a selectable "model"
      (always offered), and each turn is labelled with the model it used — so the browser can tell
      keyword vs LLM without reading the server banner.
