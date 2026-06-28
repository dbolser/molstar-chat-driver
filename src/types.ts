/**
 * Shared types for molstar-chat-driver.
 *
 * The whole system turns on one artifact: a **MolViewSpec (MVS) scene tree**, carried as
 * MVSJ text. A model emits it, Mol* renders it, and (in MolBench) a grader scores it. Keeping
 * MVSJ as the contract is what lets the plugin, the evaluation harness, and the MolBench
 * grader stay decoupled.
 */

/** A grade an evaluator can give a single result. Configurable; see {@link DEFAULT_RATING_SCALE}. */
export interface RatingOption {
  value: string;
  label: string;
}

/** Whether the model produced parseable MVS JSON at all (this is MolBench's "Tier 0"). */
export type Tier0Status = 'pass' | 'fail';

/**
 * Request sent to the LLM endpoint.
 *
 * The endpoint — NOT the browser — holds the model API keys. The browser only ever sends this.
 */
export interface EndpointRequest {
  /** The natural-language instruction from the user/evaluator. */
  prompt: string;
  /** Identifier of the model to run, e.g. `"anthropic:claude-haiku-4-5"`. */
  model: string;
  /** Opaque session id, for correlating capture events server-side. */
  sessionId?: string;
}

/**
 * Response from the LLM endpoint.
 *
 * This is the contract shared verbatim with the Supabase Edge Function (see CONTRACT.md).
 */
export interface EndpointResponse {
  /** The MVS scene tree as MVSJ text, or `null` if the model produced no parseable MVS. */
  mvsj: string | null;
  /** The model's raw, untouched output (useful for free-play capture + debugging). */
  rawOutput: string;
  /** Did the model produce parseable MVS JSON? `'fail'` means there is nothing to render. */
  tier0: Tier0Status;
  /** Echo of the model that produced this, as the server resolved it. */
  model: string;
  /** Optional human-readable error (network, provider, etc.). */
  error?: string;
}

/** Something that can turn a prompt into model output. */
export interface EndpointClient {
  run(req: EndpointRequest): Promise<EndpointResponse>;
}

/** Something that can render an MVSJ scene tree into a molecular view. */
export interface MvsRenderer {
  /** Load + display an MVSJ scene tree. Rejects if the MVS is invalid or rendering fails. */
  loadMvsj(mvsj: string): Promise<void>;
}

/** Kinds of capture event emitted across the evaluation + free-play flows. */
export type CaptureEventType = 'prompt' | 'render' | 'rating' | 'feedback';

/**
 * A single thing worth recording. The {@link CaptureSink} decides where it goes — console in
 * dev, Supabase in production. Capture must be reliable: this is how we harvest real prompts.
 */
export interface CaptureEvent {
  type: CaptureEventType;
  sessionId: string;
  evaluatorId?: string;
  model?: string;
  prompt?: string;
  rawOutput?: string;
  mvsj?: string | null;
  tier0?: Tier0Status;
  renderOk?: boolean;
  rating?: string;
  feedback?: string;
  /** ISO-8601 timestamp, stamped at emit time. */
  ts: string;
}

/** Where capture events go. Return a promise if the sink is async (e.g. network). */
export type CaptureSink = (event: CaptureEvent) => void | Promise<void>;

/** Default rating scale, matching Dan's "failed / OK / could be better" sketch. */
export const DEFAULT_RATING_SCALE: RatingOption[] = [
  { value: 'failed', label: 'Failed' },
  { value: 'could_be_better', label: 'Could be better' },
  { value: 'ok', label: 'OK' },
  { value: 'good', label: 'Good' },
];
