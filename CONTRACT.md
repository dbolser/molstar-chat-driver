# The endpoint contract

This is the single interface that both halves of the system agree on. The browser plugin
POSTs an `EndpointRequest`; the server (a Supabase Edge Function, or any HTTP endpoint that
holds the model API keys) returns an `EndpointResponse`. Nail this down once and the plugin,
the evaluation harness, and the server can all evolve independently.

> The browser **never** holds a model API key. It only ever sends the request below.

## Request (browser → server)

```jsonc
{
  "prompt": "show hemoglobin as cartoon coloured by chain, with its ligands",
  "model": "anthropic:claude-haiku-4-5",   // server resolves this to a provider call
  "sessionId": "f3c1…"                       // opaque; correlates capture events
}
```

## Response (server → browser)

```jsonc
{
  "mvsj": "{\"root\":{…}}",   // MVS scene tree as MVSJ text, or null
  "rawOutput": "…",            // the model's raw, untouched output
  "tier0": "pass",             // "pass" if mvsj is parseable MVS JSON, else "fail"
  "model": "anthropic:claude-haiku-4-5",
  "error": null                 // optional human-readable error
}
```

### Field rules

- **`tier0`** is computed *server-side* (it is MolBench's first gate). When `tier0 = "fail"`,
  `mvsj` MUST be `null` — there is nothing valid to render.
- **`mvsj`** is *text*, not a parsed object. The renderer calls `MVSData.fromMVSJ(mvsj)`.
- **`rawOutput`** is always returned, even on failure, because free-play wants to capture what
  the model actually said, and failures are interesting data.

## Why the server computes `tier0`

The standardised evaluation harness should only ever show evaluators results where
`tier0 = "pass"` (a malformed-JSON result is a waste of a human's time — it is already
machine-gradeable). Pre-filtering happens when the harness builds each evaluator's queue, so
the server's `tier0` flag is what the harness keys off.

## Capture events (browser → collector)

Separately from the model call, the plugin emits `CaptureEvent`s (see `src/types.ts`) to a
capture sink — in production, an HTTP sink pointed at Supabase. One row per event:

| `type`     | when                              | key fields                                |
|------------|-----------------------------------|-------------------------------------------|
| `prompt`   | a prompt is submitted             | `prompt`, `model`                         |
| `render`   | after the model responds          | `mvsj`, `rawOutput`, `tier0`, `renderOk`  |
| `rating`   | evaluator clicks a rating         | `rating`, `prompt`, `model`               |
| `feedback` | evaluator submits free-text (play)| `feedback`, `prompt`, `model`             |

All events carry `sessionId`, optional `evaluatorId`, and an ISO-8601 `ts`.
