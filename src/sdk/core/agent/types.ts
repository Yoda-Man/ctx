import type { ChatMessage } from '../provider/types';

/**
 * ReAct step: Thought
 * The agent's reasoning about what to do next
 */
export interface Thought {
  type: 'thought';
  content: string;
  timestamp: number;
}

/**
 * ReAct step: Action
 * The agent's decision to use a tool
 */
export interface Action {
  type: 'action';
  tool: string;
  input: Record<string, unknown>;
  timestamp: number;
}

/**
 * ReAct step: Observation
 * The result of executing a tool
 */
export interface Observation {
  type: 'observation';
  result: unknown;
  success: boolean;
  timestamp: number;
}

/**
 * Union type for all ReAct steps
 */
export type ReActStep = Thought | Action | Observation;

/**
 * Complete ReAct trace for debugging
 */
export interface ReActTrace {
  /** All steps in the reasoning chain */
  steps: ReActStep[];
  /** Number of ReAct iterations */
  iterations: number;
  /** Total tokens used */
  totalTokens: number;
  /** Total duration in milliseconds */
  durationMs: number;
}

/**
 * Runtime options for agent.run()
 */
export interface AgentRunOptions {
  /** Override max iterations */
  maxIterations?: number;
  /** Additional context messages */
  context?: ChatMessage[];
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Override callbacks at runtime (merges with constructor callbacks) */
  callbacks?: ReActEventCallbacks;
}

// ===== EVENT CALLBACK TYPES =====

/**
 * Event emitted when agent generates a thought (reasoning step)
 */
interface ThoughtEvent {
  type: 'thought';
  content: string;
  iteration: number;
  timestamp: number;
}

/**
 * Event emitted when agent decides on a tool action
 */
interface ActionEvent {
  type: 'action';
  tool: string;
  input: Record<string, unknown>;
  iteration: number;
  timestamp: number;
}

/**
 * Event emitted when tool execution completes
 */
interface ObservationEvent {
  type: 'observation';
  tool: string;
  result: unknown;
  success: boolean;
  durationMs: number;
  iteration: number;
  timestamp: number;
}

/**
 * Event emitted when tool is about to be invoked (before execution)
 */
interface ToolCallEvent {
  type: 'toolCall';
  tool: string;
  input: Record<string, unknown>;
  iteration: number;
  timestamp: number;
}

/**
 * Callback function signatures for each event type
 */
type OnThoughtCallback = (event: ThoughtEvent) => void | Promise<void>;
type OnActionCallback = (event: ActionEvent) => void | Promise<void>;
type OnObservationCallback = (
  event: ObservationEvent
) => void | Promise<void>;
type OnToolCallCallback = (event: ToolCallEvent) => void | Promise<void>;

/**
 * Event callbacks configuration for real-time debugging
 *
 * @example
 * ```typescript
 * const agent = new Agent({
 *   // ...
 *   callbacks: {
 *     onThought: (e) => console.log('Thinking:', e.content),
 *     onAction: (e) => console.log('Using tool:', e.tool),
 *     onObservation: (e) => console.log('Result:', e.result),
 *   },
 * });
 * ```
 */
interface ReActEventCallbacks {
  onThought?: OnThoughtCallback;
  onAction?: OnActionCallback;
  onObservation?: OnObservationCallback;
  onToolCall?: OnToolCallCallback;
}

/**
 * Logger interface - plug in any logging implementation
 *
 * Follows common logging library patterns (pino, winston, console)
 *
 * @example
 * ```typescript
 * const agent = new Agent({
 *   // ...
 *   logger: {
 *     debug: (msg, meta) => console.debug(msg, meta),
 *     info: (msg, meta) => console.info(msg, meta),
 *     warn: (msg, meta) => console.warn(msg, meta),
 *     error: (msg, meta) => console.error(msg, meta),
 *   },
 * });
 * ```
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * No-op logger for when logging is disabled (default)
 */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ===== STREAMING GENERATOR EVENT =====

/**
 * Event yielded by executeStream() generator
 */
export type StreamEvent =
  | ThoughtEvent
  | ActionEvent
  | ObservationEvent
  | ToolCallEvent
  | {
      type: 'thought_delta';
      content: string;
      iteration: number;
      timestamp: number;
    }
  | { type: 'output_delta'; content: string; timestamp: number }
  | { type: 'error'; error: string; code?: string; timestamp: number }
  | { type: 'done'; output: string; trace: ReActTrace };
