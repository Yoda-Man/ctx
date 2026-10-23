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
   * Create an error for chunk not found.
   */
  static chunkNotFound(storeName: string, ids: string[]): VectorStoreError {
    const idList =
      ids.length <= 3 ? ids.join(', ') : `${ids.slice(0, 3).join(', ')}...`;
    return new VectorStoreError(
      `Chunk(s) not found: ${idList}`,
      'CHUNK_NOT_FOUND',
      storeName
    );
  }

  /**
   * Create an error for store unavailable.
   */
  static storeUnavailable(
    storeName: string,
    reason: string,
    cause?: Error
  ): VectorStoreError {
    return new VectorStoreError(
      `Store unavailable: ${reason}`,
      'STORE_UNAVAILABLE',
      storeName,
      cause
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

  /**
   * Create an error for invalid filter.
   */
  static invalidFilter(storeName: string, reason: string): VectorStoreError {
    return new VectorStoreError(
      `Invalid filter: ${reason}`,
      'INVALID_FILTER',
      storeName
    );
  }

  /**
   * Create an error for insert failure.
   */
  static insertFailed(
    storeName: string,
    reason: string,
    cause?: Error
  ): VectorStoreError {
    return new VectorStoreError(
      `Insert failed: ${reason}`,
      'INSERT_FAILED',
      storeName,
      cause
    );
  }

  /**
   * Create an error for delete failure.
   */
  static deleteFailed(
    storeName: string,
    reason: string,
    cause?: Error
  ): VectorStoreError {
    return new VectorStoreError(
      `Delete failed: ${reason}`,
      'DELETE_FAILED',
      storeName,
      cause
    );
  }
}
