/**
 * Ollama Local LLM Provider
 *
 * Implements the LLMProvider interface for Ollama local models.
 * Supports Llama, Mistral, CodeLlama, and other models via Ollama.
 *
 * KEY FEATURES:
 * - No API key required (local inference)
 * - Native fetch (no SDK dependency)
 * - NDJSON streaming
 * - Tool calling (Ollama 0.1.44+)
 * - Multimodal support (LLaVA, etc.)
 *
 * @example
 * ```typescript
 * import { OllamaProvider } from '@contextaisdk/provider-ollama';
 *
 * const provider = new OllamaProvider({
 *   model: 'llama3.2',
 *   host: 'http://localhost:11434',
 * });
 *
 * // Non-streaming
 * const response = await provider.chat([
 *   { role: 'user', content: 'Hello!' }
 * ]);
 *
 * // Streaming
 * for await (const chunk of provider.streamChat(messages)) {
 *   if (chunk.type === 'text') {
 *     process.stdout.write(chunk.content!);
 *   }
 * }
 * ```
 */

import type {
  LLMProvider,
  ChatMessage,
  ChatResponse,
  StreamChunk,
  GenerateOptions,
  ModelInfo,
} from '../core/index.js';

import type { OllamaProviderConfig, OllamaTagsResponse } from './types.js';
import { OllamaProviderError, mapOllamaError, createErrorFromResponse } from './errors.js';
import { buildRequestBody } from './message-mapper.js';
import {
  mapResponse,
  mapStreamChunk,
  createStreamingState,
  parseNDJSONStream,
} from './response-mapper.js';

/** Default Ollama server host */
const DEFAULT_HOST = 'http://localhost:11434';

/** Default request timeout (2 minutes - local models can be slow on first load) */
const DEFAULT_TIMEOUT = 120000;

/**
 * Ollama Local LLM Provider.
 *
 * Provides chat completions using locally running Ollama models with support for:
 * - Streaming and non-streaming responses
 * - Tool/function calling (Ollama 0.1.44+)
 * - Multimodal inputs (images for LLaVA, etc.)
 * - Model listing and availability checks
 */
export class OllamaProvider implements LLMProvider {
  /** Provider identifier */
  readonly name = 'ollama';

  /** Model being used (e.g., 'llama3.2', 'mistral') */
  readonly model: string;

  /** Ollama server base URL */
  private readonly host: string;

  /** Default generation options */
  private readonly defaultOptions: Partial<GenerateOptions>;

  /** Request timeout in milliseconds */
  private readonly timeout: number;

  /** Custom headers for requests */
  private readonly headers: Record<string, string>;

  /** Keep model loaded between requests */
  private readonly keepAlive?: string;

  /**
   * Creates a new Ollama provider instance.
   *
   * @param config - Provider configuration
   * @throws {OllamaProviderError} If configuration is invalid
   */
  constructor(config: OllamaProviderConfig) {
    if (!config.model) {
      throw new OllamaProviderError(
        'Model is required',
        'OLLAMA_INVALID_REQUEST'
      );
    }

    this.model = config.model;
    this.host = (config.host || config.baseURL || DEFAULT_HOST).replace(
      /\/$/,
      ''
    );
    this.defaultOptions = config.defaultOptions || {};
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.headers = {
      'Content-Type': 'application/json',
      ...config.headers,
    };
    this.keepAlive = config.keepAlive;
  }

  // ==========================================================================
  // LLMProvider Interface: chat()
  // ==========================================================================

  /**
   * Sends a chat completion request (non-streaming).
   *
   * @param messages - Conversation messages
   * @param options - Generation options (temperature, tools, etc.)
   * @returns Chat response with content, tool calls, and usage
   *
   * @example
   * ```typescript
   * const response = await provider.chat([
   *   { role: 'system', content: 'You are helpful.' },
   *   { role: 'user', content: 'What is 2+2?' }
   * ], { temperature: 0 });
   *
   * console.log(response.content); // "4"
   * ```
   */
  chat = async (
    messages: ChatMessage[],
    options?: GenerateOptions
  ): Promise<ChatResponse> => {
    const mergedOptions = { ...this.defaultOptions, ...options };

    try {
      // Build request body
      const body = buildRequestBody(this.model, messages, mergedOptions, {
        stream: false,
        keepAlive: this.keepAlive,
      });

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      // Also respect user-provided signal
      if (options?.signal) {
        options.signal.addEventListener('abort', () => controller.abort());
      }

      try {
        const response = await fetch(`${this.host}/api/chat`, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => undefined);
          throw await createErrorFromResponse(response, errorBody);
        }

        const data = (await response.json()) as import('./types.js').OllamaChatResponse;
        return mapResponse(data);
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      throw mapOllamaError(error);
    }
  };

  // ==========================================================================
  // LLMProvider Interface: streamChat()
  // ==========================================================================

  /**
   * Sends a streaming chat completion request.
   *
   * Yields chunks as they arrive:
   * - `{ type: 'text', content: '...' }` - Incremental text
   * - `{ type: 'tool_call', toolCall: {...} }` - Tool invocation
   * - `{ type: 'usage', usage: {...} }` - Token counts
   * - `{ type: 'done', metadata: {...} }` - Stream complete
   *
   * @param messages - Conversation messages
   * @param options - Generation options
   * @yields StreamChunk objects
   *
   * @example
   * ```typescript
   * for await (const chunk of provider.streamChat(messages)) {
   *   switch (chunk.type) {
   *     case 'text':
   *       process.stdout.write(chunk.content ?? '');
   *       break;
   *     case 'tool_call':
   *       console.log('Tool:', chunk.toolCall);
   *       break;
   *   }
   * }
   * ```
   *
   * @remarks
   * This is an async generator method, not an arrow function, because
   * JavaScript doesn't support arrow function generators (`async *() =>`).
   * Avoid passing this method as a callback without binding.
   */
  async *streamChat(
    messages: ChatMessage[],
    options?: GenerateOptions
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const mergedOptions = { ...this.defaultOptions, ...options };

    try {
      // Build request body with streaming enabled
      const body = buildRequestBody(this.model, messages, mergedOptions, {
        stream: true,
        keepAlive: this.keepAlive,
      });

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      // Also respect user-provided signal
      if (options?.signal) {
        options.signal.addEventListener('abort', () => controller.abort());
      }

      try {
        const response = await fetch(`${this.host}/api/chat`, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => undefined);
          throw await createErrorFromResponse(response, errorBody);
        }

        if (!response.body) {
          throw new OllamaProviderError(
            'Response body is null',
            'OLLAMA_INVALID_RESPONSE'
          );
        }

        // Create streaming state
        const state = createStreamingState();

        // Parse NDJSON stream
        for await (const chunk of parseNDJSONStream(response.body)) {
          const mapped = mapStreamChunk(chunk, state);

          if (mapped) {
            yield mapped;
          }
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      // Yield error information before throwing
      const mappedError = mapOllamaError(error);
      yield {
        type: 'text',
        error: {
          message: mappedError.message,
          code: mappedError.code,
        },
      };
      throw mappedError;
    }
  }

  // ==========================================================================
  // LLMProvider Interface: isAvailable()
  // ==========================================================================

  /**
   * Checks if the Ollama server is running and the model is available.
   *
   * Makes a request to the /api/tags endpoint to verify connectivity.
   * Optionally checks if the configured model is in the list.
   *
   * @returns true if available, false otherwise
   *
   * @example
   * ```typescript
   * if (await provider.isAvailable()) {
   *   // Safe to make requests
   * } else {
   *   console.error('Ollama not available. Run: ollama serve');
   * }
   * ```
   */
  isAvailable = async (): Promise<boolean> => {
    try {
      // Create abort controller with short timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(`${this.host}/api/tags`, {
          method: 'GET',
          headers: this.headers,
          signal: controller.signal,
        });

        if (!response.ok) {
          return false;
        }

        // Optionally verify the model is available
        const data = (await response.json()) as OllamaTagsResponse;
        const modelNames = data.models.map((m) => m.name);

        // Check if our model is available (handle tag suffix like :latest)
        const modelBase = this.model.split(':')[0];
        return modelNames.some(
          (name) => name === this.model || name.startsWith(`${modelBase}:`)
        );
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      return false;
    }
  };

  // ==========================================================================
  // LLMProvider Interface: listModels() (Optional)
  // ==========================================================================

  /**
   * Lists all models available on the Ollama server.
   *
   * @returns Array of model information
   *
   * @example
   * ```typescript
   * const models = await provider.listModels();
   * console.log('Available models:', models.map(m => m.id));
   * ```
   */
  listModels = async (): Promise<ModelInfo[]> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(`${this.host}/api/tags`, {
          method: 'GET',
          headers: this.headers,
          signal: controller.signal,
        });

        if (!response.ok) {
          throw await createErrorFromResponse(response);
        }

        const data = (await response.json()) as OllamaTagsResponse;

        return data.models.map((model) => ({
          id: model.name,
          name: model.model,
          contextLength: undefined, // Ollama doesn't report this in /api/tags
        }));
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      throw mapOllamaError(error);
    }
  };
}
