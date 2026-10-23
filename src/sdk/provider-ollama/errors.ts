import { ContextAIError } from '../core/index.js';

/**
 * Error codes specific to the Ollama provider.
 * These help identify the type of failure for error handling.
 */
export type OllamaErrorCode =
  | 'OLLAMA_API_ERROR' // Generic API error
  | 'OLLAMA_CONNECTION_ERROR' // Server not reachable
  | 'OLLAMA_MODEL_NOT_FOUND' // Model not pulled
  | 'OLLAMA_INVALID_REQUEST' // Bad request format
  | 'OLLAMA_TIMEOUT' // Request timed out
  | 'OLLAMA_INVALID_RESPONSE' // Unexpected response format
  | 'OLLAMA_STREAM_ERROR'; // Error parsing stream

/**
 * Error class for Ollama provider failures.
 *
 * Extends ContextAIError to integrate with the SDK's error handling.
 * Provides Ollama-specific context like connection status.
 *
 * @example
 * ```typescript
 * try {
 *   await provider.chat(messages);
 * } catch (error) {
 *   if (error instanceof OllamaProviderError) {
 *     if (error.code === 'OLLAMA_CONNECTION_ERROR') {
 *       console.log('Is Ollama running? Try: ollama serve');
 *     }
 *     console.error(`Ollama error [${error.code}]: ${error.message}`);
 *   }
 * }
 * ```
 */
export class OllamaProviderError extends ContextAIError {
  override readonly code: OllamaErrorCode;

  /** HTTP status code from the API response (if available) */
  readonly statusCode?: number;

  /** Original error that caused this one */
  readonly cause?: Error;

  constructor(
    message: string,
    code: OllamaErrorCode,
    options?: {
      cause?: Error;
      statusCode?: number;
    }
  ) {
    super(message, code);
    this.name = 'OllamaProviderError';
    this.code = code;
    this.cause = options?.cause;
    this.statusCode = options?.statusCode;
  }

  /**
   * Whether this error is transient and the request could succeed if retried.
   *
   * Retryable errors:
   * - Timeouts - model might have been loading
   * - Connection errors - server might be starting up
   */
  get isRetryable(): boolean {
    return (
      this.code === 'OLLAMA_TIMEOUT' ||
      this.code === 'OLLAMA_CONNECTION_ERROR'
    );
  }

  /**
   * Suggested retry delay in milliseconds.
   * Returns null if the error is not retryable.
   */
  get retryAfterMs(): number | null {
    if (!this.isRetryable) return null;

    switch (this.code) {
      case 'OLLAMA_TIMEOUT':
        // Model might be loading - wait a bit
        return 10000; // 10 seconds
      case 'OLLAMA_CONNECTION_ERROR':
        // Server might be starting
        return 5000; // 5 seconds
      default:
        return null;
    }
  }

  /**
   * User-friendly troubleshooting hints for common errors.
   */
  get troubleshootingHint(): string | null {
    switch (this.code) {
      case 'OLLAMA_CONNECTION_ERROR':
        return 'Is Ollama running? Start it with: ollama serve';
      case 'OLLAMA_MODEL_NOT_FOUND':
        return 'Model not found. Pull it with: ollama pull <model-name>';
      case 'OLLAMA_TIMEOUT':
        return 'Request timed out. The model might be loading for the first time.';
      default:
        return null;
    }
  }
}

/**
 * Maps fetch/API errors to our standardized error type.
 *
 * @param error - The error from fetch or Ollama API
 * @returns A standardized OllamaProviderError
 */
export function mapOllamaError(error: unknown): OllamaProviderError {
  // Handle fetch/network errors
  if (error instanceof TypeError) {
    // Network errors from fetch (e.g., "Failed to fetch")
    return new OllamaProviderError(
      `Failed to connect to Ollama server: ${error.message}`,
      'OLLAMA_CONNECTION_ERROR',
      { cause: error }
    );
  }

  // Handle abort errors (timeouts)
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new OllamaProviderError(
      'Request timed out',
      'OLLAMA_TIMEOUT',
      { cause: error }
    );
  }

  // Handle our own errors (pass through)
  if (error instanceof OllamaProviderError) {
    return error;
  }

  // Handle generic errors
  if (error instanceof Error) {
    // Check for common connection error messages
    const message = error.message.toLowerCase();
    if (
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('failed to fetch') ||
      message.includes('network')
    ) {
      return new OllamaProviderError(
        `Failed to connect to Ollama server: ${error.message}`,
        'OLLAMA_CONNECTION_ERROR',
        { cause: error }
      );
    }

    return new OllamaProviderError(
      error.message,
      'OLLAMA_API_ERROR',
      { cause: error }
    );
  }

  // Fallback for unknown error types
  return new OllamaProviderError(
    String(error),
    'OLLAMA_API_ERROR'
  );
}

/**
 * Creates an error from an HTTP response.
 *
 * @param response - The fetch Response object
 * @param body - The parsed response body (if available)
 */
export async function createErrorFromResponse(
  response: Response,
  body?: unknown
): Promise<OllamaProviderError> {
  const statusCode = response.status;

  // Try to extract error message from body
  let message = `Ollama API error: ${response.statusText}`;
  if (body && typeof body === 'object' && 'error' in body) {
    message = String((body as { error: string }).error);
  }

  // Map status codes to error codes
  let code: OllamaErrorCode = 'OLLAMA_API_ERROR';

  if (statusCode === 400) {
    code = 'OLLAMA_INVALID_REQUEST';
  } else if (statusCode === 404) {
    code = 'OLLAMA_MODEL_NOT_FOUND';
    // Enhance message for model not found
    if (message.includes('model')) {
      message = `Model not found: ${message}. Run 'ollama pull <model>' to download it.`;
    }
  }

  return new OllamaProviderError(message, code, { statusCode });
}
