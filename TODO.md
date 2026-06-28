# TODO

_Nothing open right now._

---

### Done

- [x] PDB-id regex no longer treats bare numbers ("2024", "1999") as structure ids.
- [x] `demo/demo.ts` shows a visible message instead of a blank page when startup fails.
- [x] `createMockBackend` is now exercised by the test suite (kept as documented public API).
- [x] Colour literals hoisted to a shared `COLORS` palette (removed the duplicated orange and the
      dead `blue` branch in `pickColor`).
- [x] Dropped the `dotenv` dependency in favour of the built-in `util.parseEnv` (Node >= 20.12).
- [x] Surface the active backend mode in the demo UI: `keyword` is now a selectable "model"
      (always offered), and each turn is labelled with the model it used — so the browser can tell
      keyword vs LLM without reading the server banner.
