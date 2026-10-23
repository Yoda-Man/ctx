import type {
  ChatMessage,
  ChatResponse,
  GenerateOptions,
  LLMProvider,
  RateLimitInfo,
  StreamChunk,
} from '../core/index.js';
import OpenAI from 'openai';
import type { OpenAIProviderConfig, RateLimitState } from './types.js';
import { mapOpenAIError } from './errors.js';
import { buildRequestParams } from './message-mapper.js';
import {
  mapResponse,
  mapStreamChunk,
  finalizeToolCalls,
  type StreamingToolCallState,
} from './response-mapper.js';

/**
 * OpenAI LLM provider for ContextAI SDK.
 *
 * Supports GPT-4o, GPT-4 Turbo, GPT-3.5 Turbo, and other OpenAI models.
 * Also compatible with OpenAI-compatible APIs like OpenRouter.
 *
 * @example
 * ```typescript
 * import { OpenAIProvider } from '@contextaisdk/provider-openai';
 *
 * const provider = new OpenAIProvider({
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   model: 'gpt-4o',
 * });
 *
 * // Non-streaming
 * const response = await provider.chat([
 *   { role: 'user', content: 'Hello!' }
 * ]);
 *
 * // Streaming
 * for await (const chunk of provider.streamChat([
 *   { role: 'user', content: 'Tell me a story' }
 * ])) {
 *   if (chunk.type === 'text') {
 *     process.stdout.write(chunk.content!);
 *   }
 * }
 * ```
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  readonly model: string;

  private readonly client: OpenAI;
  private readonly defaultOptions: Partial<GenerateOptions>;
  private rateLimitState: RateLimitState = {
    requestsRemaining: null,
    requestsLimit: null,
    tokensRemaining: null,
    tokensLimit: null,
    resetAt: null,
  };

  constructor(config: OpenAIProviderConfig) {
    this.model = config.model;
    this.defaultOptions = config.defaultOptions || {};

    // Initialize OpenAI client
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      organization: config.organization,
      timeout: config.timeout ?? 60000,
      maxRetries: config.maxRetries ?? 2,
      defaultHeaders: config.headers,
    });
  }

  /**
   * Send a chat completion request (non-streaming).
   */
  chat = async (
    messages: ChatMessage[],
    options?: GenerateOptions
  ): Promise<ChatResponse> => {
    const mergedOptions = { ...this.defaultOptions, ...options };

    try {
      const params = buildRequestParams(this.model, messages, mergedOptions);

      // Explicitly type as non-streaming response
      const response = await this.client.chat.completions.create({
        ...params,
        stream: false,
      }, {
        signal: options?.signal,
      }) as OpenAI.Chat.Completions.ChatCompletion;

      // Update rate limit state from headers (if available)
      this.updateRateLimitsFromResponse(response);

      return mapResponse(response);
    } catch (error) {
      throw mapOpenAIError(error);
    }
  };

  /**
   * Send a streaming chat completion request.
   *
   * Note: This is a regular async generator method, not an arrow function,
   * because TypeScript doesn't support arrow function generators.
   * Do not pass this method as a callback without binding.
   */
  async *streamChat(
    messages: ChatMessage[],
    options?: GenerateOptions
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const mergedOptions = { ...this.defaultOptions, ...options };

    try {
      const params = buildRequestParams(this.model, messages, mergedOptions);

      const stream = await this.client.chat.completions.create(
        {
          ...params,
          stream: true,
          stream_options: { include_usage: true },
        },
        {
          signal: options?.signal,
        }
      );

      // State for accumulating tool calls across chunks
      const toolCallState = new Map<number, StreamingToolCallState>();
      let lastContent = '';

      for await (const chunk of stream) {
        const mapped = mapStreamChunk(chunk, toolCallState);

        if (mapped) {
          // Track content for final response
          if (mapped.type === 'text' && mapped.content) {
            lastContent += mapped.content;
          }

          yield mapped;
        }
      }

      // If we accumulated tool calls, emit them as final
      if (toolCallState.size > 0) {
        const toolCalls = finalizeToolCalls(toolCallState);
        for (const tc of toolCalls) {
          yield {
            type: 'tool_call',
            toolCall: {
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
            },
          };
        }
      }
    } catch (error) {
      // Yield error chunk before throwing
      const mappedError = mapOpenAIError(error);
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

  /**
   * Check if the provider is available (API key is set).
   */
  isAvailable = async (): Promise<boolean> => {
    try {
      // Make a minimal request to check availability
      // Using models.list as it's a lightweight endpoint
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Get current rate limit information.
   * Returns cached values from the most recent API response.
   */
  getRateLimits = async (): Promise<RateLimitInfo | null> => {
    // Return cached rate limit info
    if (
      this.rateLimitState.requestsRemaining === null &&
      this.rateLimitState.tokensRemaining === null
    ) {
      return null;
    }

    return {
      requestsRemaining: this.rateLimitState.requestsRemaining ?? undefined,
      tokensRemaining: this.rateLimitState.tokensRemaining ?? undefined,
      resetAt: this.rateLimitState.resetAt ?? undefined,
    };
  };

  /**
   * Update rate limit state from response headers.
   * OpenAI returns rate limit info in response headers.
   */
  private updateRateLimitsFromResponse(response: OpenAI.Chat.Completions.ChatCompletion): void {
    // Note: The OpenAI SDK doesn't directly expose headers on the response object.
    // In a real implementation, you'd need to use the raw response or a custom fetch handler.
    // For now, we'll leave this as a stub that could be enhanced.
    //
    // Headers would be:
    // x-ratelimit-limit-requests
    // x-ratelimit-limit-tokens
    // x-ratelimit-remaining-requests
    // x-ratelimit-remaining-tokens
    // x-ratelimit-reset-requests
    // x-ratelimit-reset-tokens
    //
    // The response object from the SDK doesn't include these directly.
    // Users needing rate limit tracking would use the getRateLimits() method
    // with middleware/interceptors on their HTTP client.

    // Placeholder: In production, extract from headers
    void response; // Suppress unused variable warning
  }
}
