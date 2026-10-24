/**
 * RAG Engine Errors
 *
 * Structured error handling for RAG engine operations.
 * Uses factory methods for consistent error creation.
 */

import { ContextAIError } from '../../core/index.js';
import type { RAGEngineErrorCode, RAGEngineErrorDetails } from './types.js';

/**
 * Error thrown when RAG engine operations fail.
 *
 * @example
 * ```typescript
 * // Using factory methods (preferred)
 * throw RAGEngineError.retrievalFailed('RAGEngine', 'No results found');
 *
 * // Direct construction
 * throw new RAGEngineError(
 *   'Custom error message',
 *   'RETRIEVAL_FAILED',
 *   'MyEngine',
 *   'retrieval',
 *   originalError
 * );
 * ```
 */
export class RAGEngineError extends ContextAIError {
  /** Machine-readable error code */
  readonly code: RAGEngineErrorCode;
  /** Name of the engine that failed */
  readonly engineName: string;
  /** Which pipeline stage failed */
  readonly stage?: 'retrieval' | 'assembly' | 'cache';
  /** Underlying cause, if any */
  override readonly cause?: Error;

  constructor(
    message: string,
    code: RAGEngineErrorCode,
    engineName: string,
    stage?: 'retrieval' | 'assembly' | 'cache',
    cause?: Error
  ) {
    super(message, `RAG_ENGINE_${code}`);
    this.name = 'RAGEngineError';
    this.code = code;
    this.engineName = engineName;
    this.stage = stage;
    this.cause = cause;
  }

  /**
   * Get error details as a structured object.
   */
  toDetails(): RAGEngineErrorDetails {
    return {
      code: this.code,
      engineName: this.engineName,
      stage: this.stage,
      cause: this.cause,
    };
  }

  // ============================================================================
  // Factory Methods
  // ============================================================================

  /**
   * Create an error for invalid query input.
   */
  static invalidQuery(engineName: string, reason: string): RAGEngineError {
    return new RAGEngineError(
      `Invalid query: ${reason}`,
      'INVALID_QUERY',
      engineName
    );
  }

  /**
   * Create an error for retrieval failures.
   */
  static retrievalFailed(
    engineName: string,
    reason: string,
    cause?: Error
  ): RAGEngineError {
    return new RAGEngineError(
      `Retrieval failed: ${reason}`,
      'RETRIEVAL_FAILED',
      engineName,
      'retrieval',
      cause
    );
  }

  /**
   * Create an error for assembly failures.
   */
  static assemblyFailed(
    engineName: string,
    reason: string,
    cause?: Error
  ): RAGEngineError {
    return new RAGEngineError(
      `Assembly failed: ${reason}`,
      'ASSEMBLY_FAILED',
      engineName,
      'assembly',
      cause
    );
  }

  /**
   * Create an error for configuration issues.
   */
  static configError(engineName: string, reason: string): RAGEngineError {
    return new RAGEngineError(
      `Configuration error: ${reason}`,
      'CONFIG_ERROR',
      engineName
    );
  }

  /**
   * Create an error for aborted operations.
   */
  static aborted(
    engineName: string,
    stage: 'retrieval' | 'assembly'
  ): RAGEngineError {
    return new RAGEngineError(
      `Operation aborted during ${stage}`,
      'ABORTED',
      engineName,
      stage
    );
  }
}
