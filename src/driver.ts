/**
 * ChatDriver — the headless core: prompt -> backend -> render.
 *
 * Framework-agnostic. The {@link ./panel | panel} drives it, but so could any UI. The optional
 * `onTurn` callback is the single neutral seam for an observer (logging, analytics, a benchmark
 * harness) to watch completed turns — the driver itself has no opinion about what you do with
 * them.
 */
import { ChatBackend, ChatTurn, MvsRenderer } from './types';

export interface ChatDriverOptions {
  backend: ChatBackend;
  renderer: MvsRenderer;
  /** Fired after each completed turn (whether or not it rendered). Optional observer hook. */
  onTurn?: (turn: ChatTurn) => void;
}

export class ChatDriver {
  constructor(private readonly opts: ChatDriverOptions) {}

  /** Run a prompt, render the resulting scene if there is one, and return the completed turn. */
  async submit(prompt: string, model?: string): Promise<ChatTurn> {
    const response = await this.opts.backend.run({ prompt, model });

    let rendered = false;
    let renderError: unknown;
    if (response.mvsj) {
      try {
        await this.opts.renderer.loadMvsj(response.mvsj);
        rendered = true;
      } catch (e) {
        renderError = e;
      }
    }

    const turn: ChatTurn = {
      prompt,
      model,
      response,
      rendered,
      renderError,
      ts: new Date().toISOString(),
    };
    this.opts.onTurn?.(turn);
    return turn;
  }
}
