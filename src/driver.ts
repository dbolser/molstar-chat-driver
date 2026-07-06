/**
 * ChatDriver — the headless core: prompt -> backend -> render.
 *
 * Framework-agnostic. The {@link ./panel | panel} drives it, but so could any UI. The optional
 * `onTurn` callback is the single neutral seam for an observer (logging, analytics, a benchmark
 * harness) to watch completed turns — the driver itself has no opinion about what you do with
 * them.
 *
 * The driver keeps a short **scene context**: it replays the last few turns to the backend so a
 * follow-up prompt ("colour the oxygen red") edits the current scene instead of starting blank.
 * The window slides (oldest turns drop); {@link ChatDriver.reset} clears it for a new scene.
 */
import { ChatBackend, ChatHistoryTurn, ChatTurn, MvsRenderer } from './types';

/** Snapshot of the scene context, for a UI counter. `size` = turns since the last reset. */
export interface ChatContextInfo {
  size: number;
  max: number;
}

export interface ChatDriverOptions {
  backend: ChatBackend;
  renderer: MvsRenderer;
  /** Fired after each completed turn (whether or not it rendered). Optional observer hook. */
  onTurn?: (turn: ChatTurn) => void;
  /** How many recent turns to replay as context (sliding window). Default 10; 0 disables it. */
  maxContextTurns?: number;
  /** Fired when the scene context changes (a new turn, or a reset) — for a UI counter. */
  onContextChange?: (info: ChatContextInfo) => void;
}

/** Session id for grouping a scene's turns. Uses crypto when available, else a cheap fallback. */
function newSessionId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class ChatDriver {
  /** Recent turns in the current scene, trimmed to the context window (cleared by {@link reset}). */
  private turns: ChatTurn[] = [];
  /** Total turns since the last reset (for the UI counter; `turns` itself is trimmed). */
  private turnCount = 0;
  private sessionId = newSessionId();

  constructor(private readonly opts: ChatDriverOptions) {}

  private get maxContext(): number {
    return this.opts.maxContextTurns ?? 10;
  }

  /** Snapshot of the current scene's turns (oldest→newest), for suggestion providers and the like.
   *  A copy, so callers can't mutate the driver's internal context window. */
  recentTurns(): ReadonlyArray<ChatTurn> {
    return this.turns.slice();
  }

  /** The recent turns replayed as history for the next prompt (sliding window), or undefined.
   *  Only turns that actually rendered contribute a scene — a scene Mol* rejected never reached
   *  the viewer, so replaying it would ask the model to edit something that isn't on screen. */
  private buildHistory(): ChatHistoryTurn[] | undefined {
    if (this.maxContext <= 0 || this.turns.length === 0) return undefined;
    return this.turns
      .slice(-this.maxContext)
      .map((t) => ({ prompt: t.prompt, mvsj: t.rendered ? t.response?.mvsj ?? null : null }));
  }

  /** Run a prompt (with scene context), render the resulting scene, and return the completed turn. */
  async submit(prompt: string, model?: string): Promise<ChatTurn> {
    const session = this.sessionId; // snapshot: reset() may run before this call resolves
    const response = await this.opts.backend.run({
      prompt,
      model,
      history: this.buildHistory(),
      sessionId: session,
    });

    let rendered = false;
    let renderError: unknown;
    if (response?.mvsj) {
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
    // Only fold this into the scene context if we're still in the same scene — a reset() while the
    // backend call was in flight starts a fresh conversation this late turn must not leak into.
    if (this.sessionId === session) {
      this.turns.push(turn);
      const keep = this.maxContext > 0 ? this.maxContext : 0;
      if (this.turns.length > keep) this.turns.splice(0, this.turns.length - keep);
      this.turnCount += 1;
      this.notifyContext();
    }
    // The observer is a neutral seam: a throwing observer must not corrupt a turn
    // that already ran (and rendered). Isolate it.
    try {
      this.opts.onTurn?.(turn);
    } catch {
      /* observer errors are the observer's problem, not the turn's */
    }
    return turn;
  }

  /** Clear the scene context and start a fresh conversation ("New scene"). */
  reset(): void {
    this.turns = [];
    this.turnCount = 0;
    this.sessionId = newSessionId();
    this.notifyContext();
  }

  private notifyContext(): void {
    try {
      this.opts.onContextChange?.({ size: this.turnCount, max: this.maxContext });
    } catch {
      /* observer errors are the observer's problem */
    }
  }
}
