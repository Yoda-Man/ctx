/**
 * Vector Store Errors
 */

import { ContextAIError } from '../../core/index.js';
import type { VectorStoreErrorCode, VectorStoreErrorDetails } from './types.js';

/**
 * Error thrown when vector store operations fail.
 *
 * @example
 * ```typescript
 * // Using factory methods (preferred)
 * throw VectorStoreError.dimensionMismatch('MyStore', 1536, 768);
 *
 * // Direct construction
 * throw new VectorStoreError(
 *   'Custom error message',
 *   'STORE_ERROR',
 *   'MyStore',
 *   originalError
 * );
 * ```
 */
export class VectorStoreError extends ContextAIError {
  /** Machine-readable error code */
  readonly code: VectorStoreErrorCode;
  /** Name of the store that failed */
  readonly storeName: string;
  /** Underlying cause, if any */
  override readonly cause?: Error;

  constructor(
    message: string,
    code: VectorStoreErrorCode,
    storeName: string,
    cause?: Error
  ) {
    super(message, `VECTORSTORE_${code}`);
    this.name = 'VectorStoreError';
    this.code = code;
    this.storeName = storeName;
    this.cause = cause;
  }

  /**
   * Get error details as a structured object.
   */
  toDetails(): VectorStoreErrorDetails {
    return {
      code: this.code,
      storeName: this.storeName,
      cause: this.cause,
    };
  }

  /**
   * Create an error for dimension mismatch.
   */
  static dimensionMismatch(
    storeName: string,
    expected: number,
    received: number
  ): VectorStoreError {
    return new VectorStoreError(
      `Dimension mismatch: store expects ${expected} dimensions, got ${received}`,
      'DIMENSION_MISMATCH',
      storeName
    );
  }

  /**
   * Create an error for invalid query.
   */
  static invalidQuery(storeName: string, reason: string): VectorStoreError {
    return new VectorStoreError(
      `Invalid query: ${reason}`,
      'INVALID_QUERY',
      storeName
    );
  }
}
