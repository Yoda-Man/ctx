import { ContextAIError } from '../core/index.js';

/**
 * Error codes specific to the Anthropic provider.
 * These help identify the type of failure for error handling.
 */
export type AnthropicErrorCode =
  | 'ANTHROPIC_API_ERROR' // Generic API error
  | 'ANTHROPIC_AUTH_ERROR' // 401: Invalid API key
  | 'ANTHROPIC_PERMISSION_ERROR' // 403: Key lacks permissions
  | 'ANTHROPIC_NOT_FOUND' // 404: Invalid model or endpoint
  | 'ANTHROPIC_RATE_LIMIT' // 429: Too many requests
  | 'ANTHROPIC_OVERLOADED' // 529: API overloaded
  | 'ANTHROPIC_INVALID_REQUEST' // 400: Bad request format
  | 'ANTHROPIC_TIMEOUT' // Request timed out
  | 'ANTHROPIC_CONNECTION_ERROR' // Network failure
  | 'ANTHROPIC_INVALID_RESPONSE'; // Unexpected response format

/**
 * Error class for Anthropic provider failures.
 *
 * Extends ContextAIError to integrate with the SDK's error handling.
 * Provides additional context like HTTP status codes and request IDs.
 *
 * @example
 * ```typescript
 * try {
 *   await provider.chat(messages);
 * } catch (error) {
 *   if (error instanceof AnthropicProviderError) {
 *     if (error.isRetryable) {
 *       // Implement retry logic
 *     }
 *     console.error(`Anthropic error [${error.code}]: ${error.message}`);
 *   }
 * }
 * ```
 */
export class AnthropicProviderError extends ContextAIError {
  override readonly code: AnthropicErrorCode;

  /** HTTP status code from the API response */
  readonly statusCode?: number;

  /** Request ID from Anthropic (for support tickets) */
  readonly requestId?: string;

  /** Original error that caused this one */
  readonly cause?: Error;

  constructor(
    message: string,
    code: AnthropicErrorCode,
    options?: {
      cause?: Error;
      statusCode?: number;
      requestId?: string;
    }
  ) {
    super(message, code);
    this.name = 'AnthropicProviderError';
    this.code = code;
    this.cause = options?.cause;
    this.statusCode = options?.statusCode;
    this.requestId = options?.requestId;
  }

  /**
   * Whether this error is transient and the request could succeed if retried.
   *
   * Retryable errors:
   * - Rate limits (429) - wait and retry
   * - Overloaded (529) - API is busy
   * - Timeouts - network issues
   * - Connection errors - network issues
   * - Server errors (5xx) - transient API issues
   */
  get isRetryable(): boolean {
    return (
      this.code === 'ANTHROPIC_RATE_LIMIT' ||
      this.code === 'ANTHROPIC_OVERLOADED' ||
      this.code === 'ANTHROPIC_TIMEOUT' ||
      this.code === 'ANTHROPIC_CONNECTION_ERROR' ||
      (this.statusCode !== undefined && this.statusCode >= 500)
    );
  }

  /**
   * Suggested retry delay in milliseconds.
   * Returns null if the error is not retryable.
   */
  get retryAfterMs(): number | null {
    if (!this.isRetryable) return null;

    switch (this.code) {
      case 'ANTHROPIC_RATE_LIMIT':
        // Rate limits typically need longer waits
        return 60000; // 1 minute
      case 'ANTHROPIC_OVERLOADED':
        // API overload - try again soon
        return 30000; // 30 seconds
      case 'ANTHROPIC_TIMEOUT':
      case 'ANTHROPIC_CONNECTION_ERROR':
        // Network issues - short retry
        return 5000; // 5 seconds
      default:
        // Server errors
        return 10000; // 10 seconds
    }
  }
}

/**
 * Maps Anthropic SDK errors to our standardized error type.
 *
 * The Anthropic SDK throws errors with this structure:
 * - status: HTTP status code
 * - message: Error message
 * - error: { type: string, message: string }
 * - headers: Response headers (including request ID)
 *
 * @param error - The error from the Anthropic SDK
 * @returns A standardized AnthropicProviderError
 */
export function mapAnthropicError(error: unknown): AnthropicProviderError {
  // Handle Anthropic SDK errors
  if (error && typeof error === 'object') {
    const err = error as {
      status?: number;
      message?: string;
      error?: { type?: string; message?: string };
      headers?: Record<string, string> | Headers;
    };

    // Extract error message (prefer nested error.message)
    const message =
      err.error?.message || err.message || 'Unknown Anthropic API error';

    // Extract status code
    const statusCode = err.status;

    // Extract request ID from headers
    let requestId: string | undefined;
    if (err.headers) {
      if (err.headers instanceof Headers) {
        requestId = err.headers.get('request-id') ?? undefined;
      } else {
        requestId = err.headers['request-id'];
      }
    }

    // Map status code to error code
    let code: AnthropicErrorCode = 'ANTHROPIC_API_ERROR';

    if (statusCode === 400) {
      code = 'ANTHROPIC_INVALID_REQUEST';
    } else if (statusCode === 401) {
      code = 'ANTHROPIC_AUTH_ERROR';
    } else if (statusCode === 403) {
      code = 'ANTHROPIC_PERMISSION_ERROR';
    } else if (statusCode === 404) {
      code = 'ANTHROPIC_NOT_FOUND';
    } else if (statusCode === 429) {
      code = 'ANTHROPIC_RATE_LIMIT';
    } else if (statusCode === 529) {
      code = 'ANTHROPIC_OVERLOADED';
    }

    // Check for network/timeout errors by error type or code
    const errorType = err.error?.type;
    if (errorType === 'timeout' || (err as { code?: string }).code === 'ETIMEDOUT') {
      code = 'ANTHROPIC_TIMEOUT';
    } else if (
      (err as { code?: string }).code === 'ECONNREFUSED' ||
      (err as { code?: string }).code === 'ENOTFOUND' ||
      (err as { code?: string }).code === 'ECONNRESET'
    ) {
      code = 'ANTHROPIC_CONNECTION_ERROR';
    }

    return new AnthropicProviderError(message, code, {
      cause: error instanceof Error ? error : undefined,
      statusCode,
      requestId,
    });
  }

  // Fallback for unexpected error types
  return new AnthropicProviderError(
    error instanceof Error ? error.message : String(error),
    'ANTHROPIC_API_ERROR',
    { cause: error instanceof Error ? error : undefined }
  );
}
