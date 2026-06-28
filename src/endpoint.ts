/**
 * Endpoint clients: how a prompt becomes model output.
 *
 * Production uses {@link createHttpEndpoint} pointed at a server (e.g. a Supabase Edge
 * Function) that holds the model API keys. Local play uses {@link createMockEndpoint}, which
 * needs no backend and no keys at all.
 */
import { EndpointClient, EndpointRequest, EndpointResponse } from './types';

/**
 * HTTP endpoint client. POSTs the {@link EndpointRequest} as JSON and expects an
 * {@link EndpointResponse} back.
 *
 * This is the production path: point `url` at your Supabase Edge Function. The browser never
 * sees a model API key — the function does the model call server-side.
 */
export function createHttpEndpoint(
  url: string,
  init?: { headers?: Record<string, string> },
): EndpointClient {
  return {
    async run(req: EndpointRequest): Promise<EndpointResponse> {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
          body: JSON.stringify(req),
        });
      } catch (e) {
        return { mvsj: null, rawOutput: '', tier0: 'fail', model: req.model, error: `Network error: ${String(e)}` };
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          mvsj: null,
          rawOutput: text,
          tier0: 'fail',
          model: req.model,
          error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        };
      }
      return (await res.json()) as EndpointResponse;
    },
  };
}

/**
 * Mock endpoint for local play with NO backend and NO API keys.
 *
 * You supply a `build` function that maps a prompt to MVSJ text (e.g. via the Mol* MVS
 * builder). Returning `null` produces a Tier-0 `'fail'`, so you can also exercise the
 * "model produced no valid MVS" path that the UI must handle gracefully.
 */
export function createMockEndpoint(
  build: (req: EndpointRequest) => string | null | Promise<string | null>,
  opts?: { latencyMs?: number },
): EndpointClient {
  return {
    async run(req: EndpointRequest): Promise<EndpointResponse> {
      if (opts?.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
      const mvsj = await build(req);
      return {
        mvsj,
        rawOutput: mvsj ?? '(mock endpoint produced no MVS for this prompt)',
        tier0: mvsj ? 'pass' : 'fail',
        model: req.model,
      };
    },
  };
}
