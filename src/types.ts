/**
 * Shared types for molstar-chat-driver — a chat interface for Mol*.
 *
 * One idea runs through everything: a chat turn produces a **MolViewSpec (MVS) scene tree**,
 * carried as MVSJ text, which Mol* renders natively. Keeping MVSJ as the unit of exchange is
 * what lets the backend, the renderer, and the UI stay independent.
 */

/** One earlier exchange, replayed to the backend so a follow-up prompt can build on it. */
export interface ChatHistoryTurn {
  /** What the user asked. */
  prompt: string;
  /** The MVSJ scene the backend returned (or `null` if that turn produced none). */
  mvsj: string | null;
}

/** A request to turn a prompt into a molecular scene. */
export interface ChatRequest {
  /** The natural-language instruction, e.g. "show hemoglobin as cartoon coloured blue". */
  prompt: string;
  /** Optional model id, for backends that can route to more than one model. */
  model?: string;
  /**
   * Recent prior turns (oldest→newest), so the backend can treat the prompt as a follow-up that
   * edits the current scene. Omitted/empty means "fresh scene". Callers cap the length.
   */
  history?: ChatHistoryTurn[];
  /** Opaque id grouping the turns of one scene conversation; changes when the scene is reset. */
  sessionId?: string;
}

/** The result of a chat turn. */
export interface ChatResponse {
  /** The MVS scene as MVSJ text, or `null` if the prompt produced no scene. */
  mvsj: string | null;
  /** Optional assistant text to show in the chat (e.g. a short explanation). */
  text?: string;
  /** Optional error message, if the backend failed. */
  error?: string;
}

/** Something that turns a {@link ChatRequest} into a {@link ChatResponse}. */
export interface ChatBackend {
  run(req: ChatRequest): Promise<ChatResponse>;
}

/** Something that can render an MVSJ scene tree into a molecular view. */
export interface MvsRenderer {
  /** Load + display an MVSJ scene tree. Rejects if the MVS is invalid or rendering fails. */
  loadMvsj(mvsj: string): Promise<void>;
}

/** A completed exchange: what was asked, what came back, and whether it rendered. */
export interface ChatTurn {
  prompt: string;
  model?: string;
  response: ChatResponse;
  /** `true` only if a scene was produced AND rendered without error. */
  rendered: boolean;
  /** The render error, if rendering was attempted and failed. */
  renderError?: unknown;
  /** ISO-8601 timestamp of when the turn completed. */
  ts: string;
}
