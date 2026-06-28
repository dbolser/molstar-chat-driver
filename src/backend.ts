/**
 * Chat backends: how a prompt becomes a molecular scene.
 *
 * A backend is just "prompt in, MVS scene out". In production that is usually an HTTP service
 * that calls an LLM (see {@link createHttpBackend}); for local development you can build scenes
 * directly with {@link createMockBackend} — no server, no API keys.
 */
import { ChatBackend, ChatRequest, ChatResponse } from './types';

/**
 * HTTP backend. POSTs the {@link ChatRequest} as JSON and expects a {@link ChatResponse} back.
 *
 * Point `url` at a small service of your own that turns the prompt into an MVS scene (typically
 * by prompting an LLM). Keep any API keys on that service — the browser only sends the prompt.
 */
export function createHttpBackend(
  url: string,
  init?: { headers?: Record<string, string> },
): ChatBackend {
  return {
    async run(req: ChatRequest): Promise<ChatResponse> {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
          body: JSON.stringify(req),
        });
      } catch (e) {
        return { mvsj: null, error: `Network error: ${String(e)}` };
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { mvsj: null, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
      }
      let data: unknown;
      try {
        data = await res.json();
      } catch (e) {
        return { mvsj: null, error: `Invalid JSON from backend: ${String(e)}` };
      }
      if (typeof data !== 'object' || data === null || !('mvsj' in data)) {
        return { mvsj: null, error: 'Malformed backend response: expected { mvsj, text?, error? }' };
      }
      return data as ChatResponse;
    },
  };
}

/**
 * Mock backend for local development — no server, no API keys.
 *
 * You supply a `build` function that maps a prompt to MVSJ text (e.g. via the Mol* MVS
 * builder). Return `null` to represent "no scene for this prompt", so the UI's empty-result
 * path is exercised too.
 */
export function createMockBackend(
  build: (req: ChatRequest) => string | null | Promise<string | null>,
  opts?: { latencyMs?: number; text?: (req: ChatRequest) => string | undefined },
): ChatBackend {
  return {
    async run(req: ChatRequest): Promise<ChatResponse> {
      if (opts?.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
      const mvsj = await build(req);
      return { mvsj, text: opts?.text?.(req) };
    },
  };
}
