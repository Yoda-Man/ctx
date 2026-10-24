import type { GenerateOptions } from '../core/index.js';

/**
 * Configuration for the Ollama local LLM provider.
 *
 * @example
 * ```typescript
 * const provider = new OllamaProvider({
 *   model: 'llama3.2',
 *   host: 'http://localhost:11434',
 * });
 * ```
 */
export interface OllamaProviderConfig {
  /**
   * Model identifier (e.g., 'llama3.2', 'mistral', 'codellama').
   * Run `ollama list` to see available models.
   */
  model: string;

  /**
   * Ollama server host URL.
   * @default 'http://localhost:11434'
   */
  host?: string;

  /**
   * Default generation options applied to all requests.
   * Can be overridden per-request.
   */
  defaultOptions?: Partial<GenerateOptions>;

  /**
   * Request timeout in milliseconds.
   * @default 120000 (2 minutes - local models can be slow)
   */
  timeout?: number;

  /**
   * Custom headers to include in all requests.
   */
  headers?: Record<string, string>;

  /**
   * Keep model loaded in memory between requests.
   * Set to '0' to unload immediately, or a duration like '5m'.
   * @default undefined (uses Ollama's default)
   */
  keepAlive?: string;
}

/**
 * Ollama API message format.
 * Similar to OpenAI but with some differences.
 */
export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Tool call results (for role: 'tool') */
  tool_call_id?: string;
  /** Images as base64 strings (for multimodal models) */
  images?: string[];
}

/**
 * Ollama tool definition format.
 * Compatible with OpenAI function calling format.
 */
export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Ollama tool call from the model.
 */
export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

/**
 * Ollama chat request body.
 */
export interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  options?: OllamaModelOptions;
  tools?: OllamaTool[];
  keep_alive?: string;
}

/**
 * Model-specific options for Ollama.
 */
export interface OllamaModelOptions {
  /** Sampling temperature (0-2) */
  temperature?: number;
  /** Maximum tokens to generate */
  num_predict?: number;
}

/**
 * Ollama chat response (non-streaming): the fields ctx reads.
 */
export interface OllamaChatResponse {
  model: string;
  message: {
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done_reason?: 'stop' | 'length' | 'load';
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Ollama streaming chunk (NDJSON line): the fields ctx reads.
 */
export interface OllamaStreamChunk {
  model: string;
  /** Absent on a line that reports an error instead. */
  message?: {
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  /** A failure Ollama reports mid-stream, e.g. "EOF"; such a line has no message. */
  error?: string;
  done: boolean;
  /** Only present when done=true */
  total_duration?: number;
}

/**
 * Response from Ollama /api/tags endpoint: the installed models' names.
 */
export interface OllamaTagsResponse {
  models: Array<{ name: string }>;
}
