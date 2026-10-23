import { ContextAIError } from '../core/index.js';

/**
 * Error codes for OpenAI provider errors.
 */
export type OpenAIErrorCode =
  | 'OPENAI_API_ERROR'
  | 'OPENAI_AUTH_ERROR'
  | 'OPENAI_RATE_LIMIT'
  | 'OPENAI_INVALID_REQUEST'
  | 'OPENAI_CONTENT_FILTER'
  | 'OPENAI_TIMEOUT'
  | 'OPENAI_CONNECTION_ERROR'
  | 'OPENAI_INVALID_RESPONSE';

/**
 * Error thrown by the OpenAI provider.
 *
 * @example
 * ```typescript
 * try {
 *   await provider.chat(messages);
 * } catch (error) {
 *   if (error instanceof OpenAIProviderError) {
 *     if (error.code === 'OPENAI_RATE_LIMIT') {
 *       // Wait and retry
 *     }
 *   }
 * }
 * ```
 */
export class OpenAIProviderError extends ContextAIError {
  override readonly code: OpenAIErrorCode;
  readonly statusCode?: number;
  readonly requestId?: string;
  override readonly cause?: Error;

  constructor(
    message: string,
    code: OpenAIErrorCode,
    options?: {
      cause?: Error;
      statusCode?: number;
      requestId?: string;
    }
  ) {
    super(message, code, { severity: 'error', cause: options?.cause });
    this.name = 'OpenAIProviderError';
    this.code = code;
    this.cause = options?.cause;
    this.statusCode = options?.statusCode;
    this.requestId = options?.requestId;
  }

  /**
   * Check if this error is retryable (rate limits, temporary failures).
   */
  override get isRetryable(): boolean {
    return (
      this.code === 'OPENAI_RATE_LIMIT' ||
      this.code === 'OPENAI_TIMEOUT' ||
      this.code === 'OPENAI_CONNECTION_ERROR' ||
      (this.statusCode !== undefined && this.statusCode >= 500)
    );
  }

  /**
   * Suggested delay before retrying (in milliseconds).
   *
   * Returns appropriate delays based on error type:
   * - Rate limits: 60 seconds (API typically resets in ~1 min)
   * - Timeouts/connection: 5 seconds
   * - Server errors (5xx): 10 seconds
   */
  override get retryAfterMs(): number | null {
    if (!this.isRetryable) return null;

    switch (this.code) {
      case 'OPENAI_RATE_LIMIT':
        return 60000; // 60 seconds for rate limits
      case 'OPENAI_TIMEOUT':
      case 'OPENAI_CONNECTION_ERROR':
        return 5000; // 5 seconds for transient network errors
      default:
        // Server errors (5xx)
        if (this.statusCode !== undefined && this.statusCode >= 500) {
          return 10000; // 10 seconds for server errors
        }
        return null;
    }
  }

  /**
   * Provide actionable troubleshooting hints for OpenAI errors.
   *
   * Follows the pattern established by OllamaProviderError.
   */
  override get troubleshootingHint(): string | null {
    switch (this.code) {
      case 'OPENAI_AUTH_ERROR':
        return (
          `Invalid API key. ` +
          `Check your OPENAI_API_KEY environment variable or apiKey config. ` +
          `Ensure the key is active in the OpenAI dashboard.`
        );

      case 'OPENAI_RATE_LIMIT':
        return (
          `Rate limit exceeded. ` +
          `Wait before retrying or upgrade your OpenAI plan. ` +
          `Consider implementing exponential backoff.`
        );

      case 'OPENAI_INVALID_REQUEST':
        return (
          `Invalid request format. ` +
          `Check message structure, tool definitions, and model compatibility. ` +
          `Ensure all required fields are present.`
        );

      case 'OPENAI_CONTENT_FILTER':
        return (
          `Content was filtered by OpenAI's safety system. ` +
          `Modify your prompt to comply with OpenAI's usage policies.`
        );

      case 'OPENAI_TIMEOUT':
        return (
          `Request timed out. ` +
          `The model may be overloaded. Try again or increase the timeout setting.`
        );

      case 'OPENAI_CONNECTION_ERROR':
        return (
          `Cannot connect to OpenAI API. ` +
          `Check your network connection and firewall settings. ` +
          `Verify api.openai.com is accessible.`
        );

      case 'OPENAI_INVALID_RESPONSE':
        return (
          `Unexpected response format from OpenAI. ` +
          `This may be a temporary API issue. Try again later.`
        );

      case 'OPENAI_API_ERROR':
        return (
          `OpenAI API returned an error. ` +
          `Check the error message for details. ` +
          (this.requestId
            ? `Request ID: ${this.requestId} (useful for OpenAI support)`
            : '')
        );

      default:
        return null;
    }
  }
}

/**
 * Map OpenAI SDK error to our error type.
 */
export function mapOpenAIError(error: unknown): OpenAIProviderError {
  // Handle OpenAI SDK errors (they have specific structure)
  if (error && typeof error === 'object') {
    const err = error as {
      status?: number;
      message?: string;
      code?: string;
      error?: { message?: string; type?: string; code?: string };
      headers?: { 'x-request-id'?: string };
    };

    const message =
      err.error?.message || err.message || 'Unknown OpenAI API error';
    const statusCode = err.status;
    const requestId = err.headers?.['x-request-id'];

    // Map status codes to error codes
    let code: OpenAIErrorCode = 'OPENAI_API_ERROR';

    if (statusCode === 401) {
      code = 'OPENAI_AUTH_ERROR';
    } else if (statusCode === 429) {
      code = 'OPENAI_RATE_LIMIT';
    } else if (statusCode === 400) {
      code = 'OPENAI_INVALID_REQUEST';
    } else if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
      code = 'OPENAI_TIMEOUT';
    } else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      code = 'OPENAI_CONNECTION_ERROR';
    } else if (err.error?.type === 'content_filter') {
      code = 'OPENAI_CONTENT_FILTER';
    }

    return new OpenAIProviderError(message, code, {
      cause: error instanceof Error ? error : undefined,
      statusCode,
      requestId,
    });
  }

  // Fallback for unknown errors
  return new OpenAIProviderError(
    error instanceof Error ? error.message : 'Unknown error',
    'OPENAI_API_ERROR',
    { cause: error instanceof Error ? error : undefined }
  );
}
