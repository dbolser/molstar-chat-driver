/**
 * Capture sinks: where recorded events go.
 *
 * Capture is the whole point of free-play — it is how we harvest real prompts and feedback —
 * so it must be reliable and must never break the evaluator's session.
 */
import { CaptureEvent, CaptureSink } from './types';

/** Logs every event to the console. Handy default for local development. */
export const consoleCaptureSink: CaptureSink = (event: CaptureEvent) => {
  console.log(`[capture:${event.type}]`, event);
};

/**
 * Send capture events to a collector URL.
 *
 * Uses `fetch` with `keepalive: true` so events still flush if the tab is closing. Point this
 * at your Supabase function (or PostgREST endpoint). Failures are swallowed — capture must
 * never throw into the UI — but are surfaced via the optional `onError` hook.
 */
export function createHttpCaptureSink(
  url: string,
  init?: { headers?: Record<string, string>; onError?: (e: unknown) => void },
): CaptureSink {
  return (event: CaptureEvent) => {
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      body: JSON.stringify(event),
      keepalive: true,
    }).catch((e) => init?.onError?.(e));
  };
}

/** Fan one event out to several sinks (e.g. console + http). */
export function combineSinks(...sinks: CaptureSink[]): CaptureSink {
  return (event: CaptureEvent) => {
    for (const sink of sinks) void sink(event);
  };
}
