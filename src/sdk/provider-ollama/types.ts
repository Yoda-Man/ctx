import type { GenerateOptions, LLMProviderConfig } from '../core/index.js';

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
export interface OllamaProviderConfig extends Omit<LLMProviderConfig, 'apiKey'> {
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
  format?: 'json' | Record<string, unknown>;
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
  /** Top-P nucleus sampling */
  top_p?: number;
  /** Top-K sampling */
  top_k?: number;
  /** Frequency penalty */
  frequency_penalty?: number;
  /** Presence penalty */
  presence_penalty?: number;
  /** Stop sequences */
  stop?: string[];
  /** Maximum tokens to generate */
  num_predict?: number;
  /** Random seed for reproducibility */
  seed?: number;
}

/**
 * Ollama chat response (non-streaming).
 */
export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: 'assistant';
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  done_reason?: 'stop' | 'length' | 'load';
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/**
 * Ollama streaming chunk (NDJSON line).
 */
export interface OllamaStreamChunk {
  model: string;
  created_at: string;
  /** Absent on a line that reports an error instead. */
  message?: {
    role: 'assistant';
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  /** A failure Ollama reports mid-stream, e.g. "EOF"; such a line has no message. */
  error?: string;
  done: boolean;
  done_reason?: 'stop' | 'length' | 'load';
  /** Only present when done=true */
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/**
 * Ollama model information from /api/tags.
 */
export interface OllamaModelInfo {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    parent_model?: string;
    format: string;
    family: string;
    families?: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

/**
 * Response from Ollama /api/tags endpoint.
 */
export interface OllamaTagsResponse {
  models: OllamaModelInfo[];
}

/**
 * Common Ollama model identifiers for convenience.
 */
export const OllamaModels = {
  // Llama 3.2
  LLAMA_3_2_1B: 'llama3.2:1b',
  LLAMA_3_2_3B: 'llama3.2:3b',
  LLAMA_3_2: 'llama3.2',

  // Llama 3.1
  LLAMA_3_1_8B: 'llama3.1:8b',
  LLAMA_3_1_70B: 'llama3.1:70b',

  // Mistral
  MISTRAL: 'mistral',
  MISTRAL_NEMO: 'mistral-nemo',

  // Code models
  CODELLAMA: 'codellama',
  DEEPSEEK_CODER: 'deepseek-coder',
  QWEN_CODER: 'qwen2.5-coder',

  // Small models
  PHI3: 'phi3',
  GEMMA2: 'gemma2',
} as const;

export type OllamaModelId = (typeof OllamaModels)[keyof typeof OllamaModels];
