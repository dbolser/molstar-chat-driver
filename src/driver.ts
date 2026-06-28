/**
 * ChatDriver — orchestrates one turn: prompt -> endpoint -> render -> capture.
 *
 * Framework-agnostic on purpose. The {@link ./panel | panel} drives it, but so could any UI.
 * The same driver powers both standardised evaluation and free-play; only the endpoint, the
 * capture sink, and the surrounding UI differ.
 */
import {
  CaptureEvent,
  CaptureSink,
  EndpointClient,
  EndpointResponse,
  MvsRenderer,
  Tier0Status,
} from './types';

export interface ChatDriverOptions {
  endpoint: EndpointClient;
  renderer: MvsRenderer;
  capture?: CaptureSink;
  sessionId: string;
  evaluatorId?: string;
}

export interface SubmitResult {
  response: EndpointResponse;
  tier0: Tier0Status;
  /** `true` only if MVS was present AND rendered without error. */
  renderOk: boolean;
  /** The render error, if rendering was attempted and failed. */
  renderError?: unknown;
}

export class ChatDriver {
  constructor(private readonly opts: ChatDriverOptions) {}

  private emit(event: Omit<CaptureEvent, 'ts' | 'sessionId' | 'evaluatorId'>): void {
    const full: CaptureEvent = {
      ...event,
      sessionId: this.opts.sessionId,
      evaluatorId: this.opts.evaluatorId,
      ts: new Date().toISOString(),
    };
    void this.opts.capture?.(full);
  }

  /** Run a prompt against a model, render the result if valid, and capture the whole turn. */
  async submit(prompt: string, model: string): Promise<SubmitResult> {
    this.emit({ type: 'prompt', prompt, model });

    const response = await this.opts.endpoint.run({ prompt, model, sessionId: this.opts.sessionId });

    let renderOk = false;
    let renderError: unknown;
    if (response.tier0 === 'pass' && response.mvsj) {
      try {
        await this.opts.renderer.loadMvsj(response.mvsj);
        renderOk = true;
      } catch (e) {
        renderError = e;
      }
    }

    this.emit({
      type: 'render',
      prompt,
      model: response.model,
      rawOutput: response.rawOutput,
      mvsj: response.mvsj,
      tier0: response.tier0,
      renderOk,
    });

    return { response, tier0: response.tier0, renderOk, renderError };
  }

  /** Record an evaluator's rating of a result. */
  rate(rating: string, context?: { prompt?: string; model?: string }): void {
    this.emit({ type: 'rating', rating, prompt: context?.prompt, model: context?.model });
  }

  /** Record free-text feedback (used in free-play). */
  feedback(feedback: string, context?: { prompt?: string; model?: string }): void {
    this.emit({ type: 'feedback', feedback, prompt: context?.prompt, model: context?.model });
  }
}
