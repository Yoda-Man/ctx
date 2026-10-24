/**
 * Chat message role
 */
type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Text content part for multimodal messages
 */
export interface TextContentPart {
  type: 'text';
  text: string;
}

/**
 * Image content part for vision models (Ollama takes images as base64)
 */
export interface ImageContentPart {
  type: 'image';
  /** Base64-encoded image data */
  base64?: string;
}

/**
 * Union of all content part types
 */
export type ContentPart = TextContentPart | ImageContentPart;

/**
 * Message content - can be simple string or array of content parts
 */
type MessageContent = string | ContentPart[];

/**
 * Chat message structure
 */
export interface ChatMessage {
  role: MessageRole;
  content: MessageContent;
  name?: string;
  toolCallId?: string;
}

/**
 * Tool call request from LLM
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Response metadata for debugging and observability
 */
interface ResponseMetadata {
  /** Model identifier used */
  modelId?: string;
  /** Response latency in milliseconds */
  latencyMs?: number;
}

/**
 * Token usage information
 */
export interface TokenUsage {
  /** Tokens in the prompt/input */
  promptTokens: number;
  /** Tokens in the completion/output */
  completionTokens: number;
  /** Total tokens used */
  totalTokens: number;
}

/**
 * LLM response structure
 */
export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error' | 'content_filter';
  /** Token usage statistics */
  usage?: TokenUsage;
  /** Response metadata for debugging/observability */
  metadata?: ResponseMetadata;
}

/**
 * Streaming chunk from LLM
 */
export interface StreamChunk {
  type: 'text' | 'tool_call' | 'usage' | 'done' | 'thinking';
  content?: string;
  toolCall?: {
    id?: string;
    name?: string;
    /** Arguments as JSON string fragment (streaming) or parsed object */
    arguments?: string | Record<string, unknown>;
  };
  /** Token usage (typically sent with 'usage' or 'done' chunk) */
  usage?: TokenUsage;
  /** Response metadata (typically sent with 'done' chunk) */
  metadata?: ResponseMetadata;
  /** Error information (for error chunks or partial failures) */
  error?: {
    message: string;
    code?: string;
  };
}

/**
 * Options for generate/chat calls
 */
export interface GenerateOptions {
  /** Sampling temperature (0-2, lower = more deterministic) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Tools available for the model to call */
  tools?: ToolDefinition[];
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Tool definition for LLM (JSON Schema format)
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * LLM Provider interface - implement this for each provider
 *
 * @example
 * ```typescript
 * class OllamaProvider implements LLMProvider {
 *   readonly name = 'ollama';
 *   readonly model: string;
 *
 *   constructor(config: OllamaProviderConfig) {
 *     this.model = config.model;
 *   }
 *
 *   async chat(messages, options) {
 *     // Implementation
 *   }
 *
 *   async *streamChat(messages, options) {
 *     // Implementation
 *   }
 *
 *   async isAvailable() {
 *     return true;
 *   }
 * }
 * ```
 */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;

  /**
   * Generate a chat completion
   */
  chat(
    messages: ChatMessage[],
    options?: GenerateOptions
  ): Promise<ChatResponse>;

  /**
   * Stream a chat completion
   */
  streamChat(
    messages: ChatMessage[],
    options?: GenerateOptions
  ): AsyncGenerator<StreamChunk, void, unknown>;

  /**
   * Check if provider is configured and available
   */
  isAvailable(): Promise<boolean>;
}
