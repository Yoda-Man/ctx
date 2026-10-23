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
 *   'Rate limit exceeded',
 *   'RATE_LIMIT',
 *   'OpenAIEmbeddingProvider',
 *   'text-embedding-3-small',
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
   * Create an error for rate limit exceeded.
   */
  static rateLimitExceeded(
    providerName: string,
    model: string,
    cause?: Error
  ): EmbeddingError {
    return new EmbeddingError(
      'Rate limit exceeded. Please wait before making more requests.',
      'RATE_LIMIT',
      providerName,
      model,
      cause
    );
  }

  /**
   * Create an error for model not found.
   */
  static modelNotFound(
    providerName: string,
    model: string,
    cause?: Error
  ): EmbeddingError {
    return new EmbeddingError(
      `Model "${model}" not found or not available`,
      'MODEL_NOT_FOUND',
      providerName,
      model,
      cause
    );
  }

  /**
   * Create an error for batch too large.
   */
  static batchTooLarge(
    providerName: string,
    model: string,
    batchSize: number,
    maxBatchSize: number
  ): EmbeddingError {
    return new EmbeddingError(
      `Batch size ${batchSize} exceeds maximum ${maxBatchSize}`,
      'BATCH_TOO_LARGE',
      providerName,
      model
    );
  }

  /**
   * Create an error for text too long.
   */
  static textTooLong(
    providerName: string,
    model: string,
    textLength: number,
    maxLength: number
  ): EmbeddingError {
    return new EmbeddingError(
      `Text length ${textLength} exceeds maximum ${maxLength} characters`,
      'TEXT_TOO_LONG',
      providerName,
      model
    );
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
