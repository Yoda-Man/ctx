/**
 * Embedding Provider Errors
 */

import { ContextAIError } from '../../core/index.js';
import type { EmbeddingErrorCode, EmbeddingErrorDetails } from './types.js';

/**
 * Error thrown when embedding generation fails.
 *
 * @example
 * ```typescript
 * throw new EmbeddingError(
 *   'Model failed to load',
 *   'PROVIDER_UNAVAILABLE',
 *   'HuggingFaceEmbeddingProvider',
 *   'Xenova/bge-large-en-v1.5',
 *   originalError
 * );
 * ```
 */
export class EmbeddingError extends ContextAIError {
  /** Machine-readable error code */
  readonly code: EmbeddingErrorCode;
  /** Name of the provider that failed */
  readonly providerName: string;
  /** Model being used */
  readonly model: string;
  /** Underlying cause, if any */
  override readonly cause?: Error;

  constructor(
    message: string,
    code: EmbeddingErrorCode,
    providerName: string,
    model: string,
    cause?: Error
  ) {
    super(message, `EMBEDDING_${code}`);
    this.name = 'EmbeddingError';
    this.code = code;
    this.providerName = providerName;
    this.model = model;
    this.cause = cause;
  }

  /**
   * Get error details as a structured object.
   */
  toDetails(): EmbeddingErrorDetails {
    return {
      code: this.code,
      providerName: this.providerName,
      model: this.model,
      cause: this.cause,
    };
  }

  /**
   * Create an error for empty input.
   */
  static emptyInput(providerName: string, model: string): EmbeddingError {
    return new EmbeddingError(
      'Cannot generate embedding for empty text',
      'EMPTY_INPUT',
      providerName,
      model
    );
  }

  /**
   * Create an error for invalid response from provider.
   */
  static invalidResponse(
    providerName: string,
    model: string,
    details: string,
    cause?: Error
  ): EmbeddingError {
    return new EmbeddingError(
      `Invalid response from provider: ${details}`,
      'INVALID_RESPONSE',
      providerName,
      model,
      cause
    );
  }

  /**
   * Create an error for provider unavailable.
   */
  static providerUnavailable(
    providerName: string,
    model: string,
    reason: string,
    cause?: Error
  ): EmbeddingError {
    return new EmbeddingError(
      `Provider unavailable: ${reason}`,
      'PROVIDER_UNAVAILABLE',
      providerName,
      model,
      cause
    );
  }
}
