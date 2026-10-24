/**
 * Reranker Errors
 *
 * Structured error handling for reranking operations.
 * Uses factory methods for consistent error creation.
 */

import { ContextAIError } from '../../core/index.js';
import type { RerankerErrorCode, RerankerErrorDetails } from './types.js';

/**
 * Error thrown when reranking operations fail.
 *
 * @example
 * ```typescript
 * // Using factory methods (preferred)
 * throw RerankerError.modelLoadFailed('BGEReranker', 'Model not found');
 *
 * // Direct construction
 * throw new RerankerError(
 *   'Custom error message',
 *   'RERANKING_FAILED',
 *   'MyReranker',
 *   originalError
 * );
 * ```
 */
export class RerankerError extends ContextAIError {
  /** Machine-readable error code */
  readonly code: RerankerErrorCode;
  /** Name of the reranker that failed */
  readonly rerankerName: string;
  /** Underlying cause, if any */
  override readonly cause?: Error;

  constructor(
    message: string,
    code: RerankerErrorCode,
    rerankerName: string,
    cause?: Error
  ) {
    super(message, `RERANKER_${code}`);
    this.name = 'RerankerError';
    this.code = code;
    this.rerankerName = rerankerName;
    this.cause = cause;
  }

  /**
   * Get error details as a structured object.
   */
  toDetails(): RerankerErrorDetails {
    return {
      code: this.code,
      rerankerName: this.rerankerName,
      cause: this.cause,
    };
  }

  // ============================================================================
  // Factory Methods
  // ============================================================================

  /**
   * Create an error for model loading failure.
   * Used when BGE or other ML models fail to initialize.
   */
  static modelLoadFailed(
    rerankerName: string,
    reason: string,
    cause?: Error
  ): RerankerError {
    return new RerankerError(
      `Failed to load model: ${reason}`,
      'MODEL_LOAD_FAILED',
      rerankerName,
      cause
    );
  }

  /**
   * Create an error for reranking operation failure.
   */
  static rerankingFailed(
    rerankerName: string,
    reason: string,
    cause?: Error
  ): RerankerError {
    return new RerankerError(
      `Reranking failed: ${reason}`,
      'RERANKING_FAILED',
      rerankerName,
      cause
    );
  }

  /**
   * Create an error for invalid input.
   */
  static invalidInput(rerankerName: string, reason: string): RerankerError {
    return new RerankerError(
      `Invalid input: ${reason}`,
      'INVALID_INPUT',
      rerankerName
    );
  }
}
