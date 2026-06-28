# TODO

## Nice-to-have

- [ ] Surface the active backend mode (keyword vs LLM, and which model) in the demo UI, not just
      the server banner — right now the browser can't tell which mode it's talking to.

---

### Done

- [x] PDB-id regex no longer treats bare numbers ("2024", "1999") as structure ids.
- [x] `demo/demo.ts` shows a visible message instead of a blank page when startup fails.
- [x] `createMockBackend` is now exercised by the test suite (kept as documented public API).
- [x] Colour literals hoisted to a shared `COLORS` palette (removed the duplicated orange and the
      dead `blue` branch in `pickColor`).
- [x] Dropped the `dotenv` dependency in favour of the built-in `util.parseEnv` (Node >= 20.12).
