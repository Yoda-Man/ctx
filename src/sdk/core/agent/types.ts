import type { LLMProvider, ChatMessage } from '../provider/types';
import type { Tool } from '../tool/types';
import type { MemoryProvider } from './memory';
import type { TokenCounter } from './context';
import type { ErrorRecoveryConfig } from './retry-types';

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
 * Agent configuration
 */
export interface AgentConfig {
  /** Agent name for identification */
  name: string;
  /** System prompt defining agent behavior */
  systemPrompt: string;
  /** LLM provider instance */
  llm: LLMProvider;
  /** Available tools */
  tools?: Tool[];
  /** Maximum ReAct iterations (default: 10) */
  maxIterations?: number;
  /** Event callbacks for real-time debugging */
  callbacks?: ReActEventCallbacks;
  /** Optional logger for tracing */
  logger?: Logger;
  /** Memory provider for conversation persistence */
  memory?: MemoryProvider;
  /** Session ID for memory persistence (required if memory is provided) */
  sessionId?: string;
  /** Initial conversation context (messages to pre-populate) */
  context?: ChatMessage[];
  /** Maximum tokens to retain in conversation context */
  maxContextTokens?: number;
  /** Custom token counter for context management */
  tokenCounter?: TokenCounter;
  /** Error recovery configuration for tool execution */
  errorRecovery?: ErrorRecoveryConfig;
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

/**
 * Agent response (non-streaming)
 */
export interface AgentResponse {
  /** Final output text */
  output: string;
  /** Complete reasoning trace */
  trace: ReActTrace;
  /** Whether execution was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Streaming agent response events
 */
export type StreamingAgentEvent =
  | { type: 'thought'; content: string }
  | { type: 'action'; tool: string; input: Record<string, unknown> }
  | { type: 'observation'; result: unknown; success: boolean }
  | { type: 'text'; content: string }
  | { type: 'done'; response: AgentResponse };

/**
 * Streaming agent response
 */
export type StreamingAgentResponse = AsyncGenerator<
  StreamingAgentEvent,
  void,
  unknown
>;

/**
 * Agent options (alias for AgentConfig)
 */
export type AgentOptions = AgentConfig;

// ===== EVENT CALLBACK TYPES =====

/**
 * Event emitted when agent generates a thought (reasoning step)
 */
export interface ThoughtEvent {
  type: 'thought';
  content: string;
  iteration: number;
  timestamp: number;
}

/**
 * Event emitted when agent decides on a tool action
 */
export interface ActionEvent {
  type: 'action';
  tool: string;
  input: Record<string, unknown>;
  iteration: number;
  timestamp: number;
}

/**
 * Event emitted when tool execution completes
 */
export interface ObservationEvent {
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
export interface ToolCallEvent {
  type: 'toolCall';
  tool: string;
  input: Record<string, unknown>;
  iteration: number;
  timestamp: number;
}

/**
 * Union of all ReAct event types
 */
export type ReActEvent =
  | ThoughtEvent
  | ActionEvent
  | ObservationEvent
  | ToolCallEvent;

/**
 * Callback function signatures for each event type
 */
export type OnThoughtCallback = (event: ThoughtEvent) => void | Promise<void>;
export type OnActionCallback = (event: ActionEvent) => void | Promise<void>;
export type OnObservationCallback = (
  event: ObservationEvent
) => void | Promise<void>;
export type OnToolCallCallback = (event: ToolCallEvent) => void | Promise<void>;

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
export interface ReActEventCallbacks {
  onThought?: OnThoughtCallback;
  onAction?: OnActionCallback;
  onObservation?: OnObservationCallback;
  onToolCall?: OnToolCallCallback;
}

// ===== LOGGER INTERFACE =====

/**
 * Log levels for the logger interface
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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

/**
 * Console logger for quick debugging
 */
export const consoleLogger: Logger = {
  debug: (msg, meta) => console.debug(`[DEBUG] ${msg}`, meta ?? ''),
  info: (msg, meta) => console.info(`[INFO] ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta ?? ''),
  error: (msg, meta) => console.error(`[ERROR] ${msg}`, meta ?? ''),
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
