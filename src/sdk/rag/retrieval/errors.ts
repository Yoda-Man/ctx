/**
 * Retriever Errors
 */

import { ContextAIError } from '../../core/index.js';
import type { RetrieverErrorCode, RetrieverErrorDetails } from './types.js';

/**
 * Error thrown when retrieval operations fail.
 *
 * @example
 * ```typescript
 * // Using factory methods (preferred)
 * throw RetrieverError.invalidQuery('HybridRetriever', 'Query cannot be empty');
 *
 * // Direct construction
 * throw new RetrieverError(
 *   'Custom error message',
 *   'RETRIEVAL_FAILED',
 *   'MyRetriever',
 *   originalError
 * );
 * ```
 */
export class RetrieverError extends ContextAIError {
  /** Machine-readable error code */
  readonly code: RetrieverErrorCode;
  /** Name of the retriever that failed */
  readonly retrieverName: string;
  /** Underlying cause, if any */
  override readonly cause?: Error;

  constructor(
    message: string,
    code: RetrieverErrorCode,
    retrieverName: string,
    cause?: Error
  ) {
    super(message, `RETRIEVER_${code}`);
    this.name = 'RetrieverError';
    this.code = code;
    this.retrieverName = retrieverName;
    this.cause = cause;
  }

  /**
   * Get error details as a structured object.
   */
  toDetails(): RetrieverErrorDetails {
    return {
      code: this.code,
      retrieverName: this.retrieverName,
      cause: this.cause,
    };
  }

  /**
   * Create an error for invalid query.
   */
  static invalidQuery(
    retrieverName: string,
    reason: string
  ): RetrieverError {
    return new RetrieverError(
      `Invalid query: ${reason}`,
      'INVALID_QUERY',
      retrieverName
    );
  }

  /**
   * Create an error for configuration issues.
   */
  static configError(
    retrieverName: string,
    reason: string
  ): RetrieverError {
    return new RetrieverError(
      `Configuration error: ${reason}`,
      'CONFIG_ERROR',
      retrieverName
    );
  }

  /**
   * Create an error for index not built.
   */
  static indexNotBuilt(retrieverName: string): RetrieverError {
    return new RetrieverError(
      'Index not built. Call buildIndex() before retrieve()',
      'INDEX_NOT_BUILT',
      retrieverName
    );
  }

  /**
   * Create an error for embedding failure.
   */
  static embeddingFailed(
    retrieverName: string,
    reason: string,
    cause?: Error
  ): RetrieverError {
    return new RetrieverError(
      `Embedding failed: ${reason}`,
      'EMBEDDING_FAILED',
      retrieverName,
      cause
    );
  }

  /**
   * Create an error for underlying store failure.
   */
  static storeError(
    retrieverName: string,
    reason: string,
    cause?: Error
  ): RetrieverError {
    return new RetrieverError(
      `Store error: ${reason}`,
      'STORE_ERROR',
      retrieverName,
      cause
    );
  }
}
