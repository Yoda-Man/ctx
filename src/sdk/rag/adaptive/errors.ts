/**
 * Adaptive RAG Errors
 *
 * Domain-specific error classes for the adaptive RAG module.
 * Provides machine-readable error codes and cause chaining.
 */

import type { AdaptiveRAGErrorCode, AdaptiveRAGErrorDetails, QueryType } from './types.js';

/**
 * Error thrown by adaptive RAG components.
 *
 * Includes an error code for programmatic handling and
 * optional cause for debugging nested failures.
 *
 * @example
 * ```typescript
 * try {
 *   await adaptiveRag.search('...');
 * } catch (error) {
 *   if (error instanceof AdaptiveRAGError) {
 *     console.log(error.code); // 'UNDERLYING_ENGINE_ERROR'
 *     console.log(error.cause); // Original error
 *   }
 * }
 * ```
 */
export class AdaptiveRAGError extends Error {
  /** Machine-readable error code */
  readonly code: AdaptiveRAGErrorCode;
  /** Name of the component that failed */
  readonly componentName: string;
  /** Query type at time of failure (if classified) */
  readonly queryType?: QueryType;
  /** Underlying cause, if any */
  override readonly cause?: Error;

  constructor(message: string, details: AdaptiveRAGErrorDetails) {
    super(message);
    this.name = 'AdaptiveRAGError';
    this.code = details.code;
    this.componentName = details.componentName;
    this.queryType = details.queryType;
    this.cause = details.cause;

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AdaptiveRAGError);
    }
  }

  /**
   * Create a user-friendly error message with context.
   */
  toDetailedString(): string {
    let msg = `[${this.code}] ${this.message}`;
    if (this.componentName) {
      msg += ` (component: ${this.componentName})`;
    }
    if (this.queryType) {
      msg += ` (queryType: ${this.queryType})`;
    }
    if (this.cause) {
      msg += `\nCaused by: ${this.cause.message}`;
    }
    return msg;
  }
}
