/**
 * Anthropic Claude LLM Provider
 *
 * Implements the LLMProvider interface for Anthropic's Claude models.
 * Supports chat completions, streaming, tool calling, and extended thinking.
 *
 * @example
 * ```typescript
 * import { AnthropicProvider } from '@contextaisdk/provider-anthropic';
 *
 * const provider = new AnthropicProvider({
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 *   model: 'claude-opus-5-5',
 * });
 *
 * // Non-streaming
 * const response = await provider.chat([
 *   { role: 'user', content: 'Hello!' }
 * ]);
 *
 * // Streaming
 * for await (const chunk of provider.streamChat(messages)) {
 *   if (chunk.type === 'text') process.stdout.write(chunk.content);
 * }
 * ```
 */

import type {
  LLMProvider,
  ChatMessage,
  ChatResponse,
  StreamChunk,
  GenerateOptions,
  RateLimitInfo,
} from '../core/index.js';
import Anthropic from '@anthropic-ai/sdk';

import type { AnthropicProviderConfig, RateLimitState } from './types.js';
import { AnthropicProviderError, mapAnthropicError } from './errors.js';
import { buildRequestParams } from './message-mapper.js';
import {
  mapResponse,
  mapStreamEvent,
  createStreamingState,
  finalizeToolCalls,
} from './response-mapper.js';

/**
 * Anthropic Claude LLM Provider.
 *
 * Provides chat completions using Anthropic's Claude models with support for:
 * - Streaming and non-streaming responses
 * - Tool/function calling
 * - Extended thinking (reasoning)
 * - Multimodal inputs (images)
 * - Rate limit tracking
 */
export class AnthropicProvider implements LLMProvider {
  /** Provider identifier */
  readonly name = 'anthropic';

  /** Model being used (e.g., 'claude-opus-5-5') */
  readonly model: string;

  /** Anthropic SDK client */
  private readonly client: Anthropic;

  /** Default generation options */
  private readonly defaultOptions: Partial<GenerateOptions>;

  /** Rate limit state from last response */
  private rateLimitState: RateLimitState = {
    requestsLimit: null,
    requestsRemaining: null,
    requestsResetAt: null,
    tokensLimit: null,
    tokensRemaining: null,
    tokensResetAt: null,
  };

  /**
   * Creates a new Anthropic provider instance.
   *
   * @param config - Provider configuration
   * @throws {AnthropicProviderError} If configuration is invalid
   */
  constructor(config: AnthropicProviderConfig) {
    if (!config.apiKey) {
      throw new AnthropicProviderError(
        'Anthropic API key is required',
        'ANTHROPIC_AUTH_ERROR'
      );
    }

    if (!config.model) {
      throw new AnthropicProviderError(
        'Model is required',
        'ANTHROPIC_INVALID_REQUEST'
      );
    }

    this.model = config.model;
    this.defaultOptions = config.defaultOptions || {};

    // Build default headers
    const defaultHeaders: Record<string, string> = {
      ...config.headers,
    };

    // Add beta features header if specified
    if (config.betaFeatures?.length) {
      defaultHeaders['anthropic-beta'] = config.betaFeatures.join(',');
    }

    // Initialize Anthropic SDK client
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.timeout ?? 60000,
      maxRetries: config.maxRetries ?? 2,
      defaultHeaders:
        Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
    });
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
      // Build request parameters (handles system message extraction)
      const params = buildRequestParams(this.model, messages, mergedOptions);

      // Call Anthropic API (explicitly non-streaming)
      const response = await this.client.messages.create(
        {
          ...params,
          stream: false,
        },
        {
          signal: options?.signal,
        }
      );

      // Update rate limits from response headers (if available)
      this.updateRateLimitsFromResponse(response);

      // Map response to ContextAI format
      return mapResponse(response);
    } catch (error) {
      // Map to standardized error
      throw mapAnthropicError(error);
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
   * - `{ type: 'thinking', thinking: '...' }` - Extended thinking
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
      // Build request parameters
      const params = buildRequestParams(this.model, messages, mergedOptions);

      // Create streaming state for accumulating tool calls
      const state = createStreamingState();

      // Open stream with Anthropic SDK
      const stream = this.client.messages.stream(params, {
        signal: options?.signal,
      });

      // Process each event from the stream
      for await (const event of stream) {
        const chunk = mapStreamEvent(event, state);

        if (chunk) {
          yield chunk;
        }
      }

      // After stream ends, check if we need to emit finalized tool calls
      // This handles the case where tool calls weren't fully emitted during streaming
      const finalToolCalls = finalizeToolCalls(state);
      if (finalToolCalls.length > 0) {
        // Check if any tool calls weren't already emitted with parsed arguments
        for (const tc of finalToolCalls) {
          // Only emit if arguments weren't already parsed
          // (This is a safety net; normally content_block_stop handles this)
          if (
            tc.arguments &&
            Object.keys(tc.arguments).length > 0 &&
            !state.toolCalls.get(
              Array.from(state.toolCalls.entries()).find(
                ([, s]) => s.id === tc.id
              )?.[0] ?? -1
            )
          ) {
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
      }

      // Get final message for usage info
      const finalMessage = await stream.finalMessage();
      if (finalMessage) {
        this.updateRateLimitsFromResponse(finalMessage);

        // Emit final usage chunk if not already emitted
        yield {
          type: 'usage',
          usage: {
            promptTokens: finalMessage.usage.input_tokens,
            completionTokens: finalMessage.usage.output_tokens,
            totalTokens:
              finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
          },
        };
      }
    } catch (error) {
      // Yield error information before throwing
      const mappedError = mapAnthropicError(error);
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
   * Checks if the provider is available and credentials are valid.
   *
   * Makes a minimal API call to verify the API key works.
   * Use this to validate configuration before making real requests.
   *
   * @returns true if available, false otherwise
   *
   * @example
   * ```typescript
   * if (await provider.isAvailable()) {
   *   // Safe to make requests
   * } else {
   *   console.error('Anthropic provider not available');
   * }
   * ```
   */
  isAvailable = async (): Promise<boolean> => {
    try {
      // Make a minimal request to verify credentials
      // We use a cheap request with minimal tokens
      await this.client.messages.create({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      return true;
    } catch (error) {
      // Check if it's an auth error vs other error
      const mapped = mapAnthropicError(error);
      if (
        mapped.code === 'ANTHROPIC_AUTH_ERROR' ||
        mapped.code === 'ANTHROPIC_PERMISSION_ERROR'
      ) {
        return false;
      }
      // Other errors (rate limit, overload) mean the API is reachable
      // but we hit a limit - still "available"
      if (
        mapped.code === 'ANTHROPIC_RATE_LIMIT' ||
        mapped.code === 'ANTHROPIC_OVERLOADED'
      ) {
        return true;
      }
      return false;
    }
  };

  // ==========================================================================
  // LLMProvider Interface: getRateLimits() (Optional)
  // ==========================================================================

  /**
   * Returns current rate limit information from the last API response.
   *
   * Anthropic includes rate limit headers in responses:
   * - anthropic-ratelimit-requests-remaining
   * - anthropic-ratelimit-tokens-remaining
   * - anthropic-ratelimit-*-reset
   *
   * @returns Rate limit info or null if not available
   *
   * @example
   * ```typescript
   * const limits = await provider.getRateLimits();
   * if (limits?.requestsRemaining === 0) {
   *   await sleep(limits.resetAt - Date.now());
   * }
   * ```
   */
  getRateLimits = async (): Promise<RateLimitInfo | null> => {
    // Return cached rate limit info from last response
    if (
      this.rateLimitState.requestsRemaining === null &&
      this.rateLimitState.tokensRemaining === null
    ) {
      return null;
    }

    return {
      requestsRemaining: this.rateLimitState.requestsRemaining ?? undefined,
      tokensRemaining: this.rateLimitState.tokensRemaining ?? undefined,
      resetAt: this.rateLimitState.requestsResetAt ?? undefined,
    };
  };

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Updates rate limit state from response headers.
   *
   * Anthropic returns these headers:
   * - anthropic-ratelimit-requests-limit
   * - anthropic-ratelimit-requests-remaining
   * - anthropic-ratelimit-requests-reset
   * - anthropic-ratelimit-tokens-limit
   * - anthropic-ratelimit-tokens-remaining
   * - anthropic-ratelimit-tokens-reset
   */
  private updateRateLimitsFromResponse(response: unknown): void {
    // The Anthropic SDK response object may have headers attached
    // This is SDK-version dependent, so we handle it gracefully
    const resp = response as {
      _headers?: Record<string, string>;
      headers?: Record<string, string>;
    };

    const headers = resp._headers || resp.headers;
    if (!headers) return;

    // Parse request limits
    const requestsLimit = headers['anthropic-ratelimit-requests-limit'];
    const requestsRemaining = headers['anthropic-ratelimit-requests-remaining'];
    const requestsReset = headers['anthropic-ratelimit-requests-reset'];

    // Parse token limits
    const tokensLimit = headers['anthropic-ratelimit-tokens-limit'];
    const tokensRemaining = headers['anthropic-ratelimit-tokens-remaining'];
    const tokensReset = headers['anthropic-ratelimit-tokens-reset'];

    // Update state
    if (requestsLimit) {
      this.rateLimitState.requestsLimit = parseInt(requestsLimit, 10);
    }
    if (requestsRemaining) {
      this.rateLimitState.requestsRemaining = parseInt(requestsRemaining, 10);
    }
    if (requestsReset) {
      this.rateLimitState.requestsResetAt = new Date(requestsReset).getTime();
    }
    if (tokensLimit) {
      this.rateLimitState.tokensLimit = parseInt(tokensLimit, 10);
    }
    if (tokensRemaining) {
      this.rateLimitState.tokensRemaining = parseInt(tokensRemaining, 10);
    }
    if (tokensReset) {
      this.rateLimitState.tokensResetAt = new Date(tokensReset).getTime();
    }
  }
}
