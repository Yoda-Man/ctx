/**
 * ErrorRecovery - Orchestrates retry, circuit breaker, and fallback
 *
 * Combines RetryStrategy and CircuitBreaker with callbacks for
 * logging, metrics, and custom recovery behavior.
 */

import type {
  ErrorContext,
  ErrorRecoveryOptions,
  ErrorRecoveryConfig,
} from './retry-types.js';
import { RetryStrategy } from './retry.js';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';

/**
 * Result of an error recovery operation.
 */
export interface ErrorRecoveryResult<T> {
  /** Whether the operation succeeded */
  success: boolean;
  /** The result value (if successful or fallback used) */
  value?: T;
  /** The error (if failed without fallback) */
  error?: Error;
  /** Number of attempts made */
  attempts: number;
  /** Total time elapsed in milliseconds */
  elapsedMs: number;
  /** Whether fallback was used */
  usedFallback: boolean;
}

/**
 * ErrorRecovery orchestrates retry logic, circuit breaker, and fallback handling.
 *
 * @example
 * ```typescript
 * const recovery = new ErrorRecovery({
 *   retry: { maxRetries: 3 },
 *   recovery: {
 *     fallbackResponse: 'Service unavailable',
 *     onError: (ctx) => console.log(`Error: ${ctx.error.message}`),
 *   },
 * });
 *
 * const result = await recovery.execute(async () => {
 *   return await fetchData();
 * });
 * ```
 */
export class ErrorRecovery {
  private readonly retryStrategy: RetryStrategy;
  private readonly circuitBreaker?: CircuitBreaker;
  private readonly options: ErrorRecoveryOptions;

  constructor(config: ErrorRecoveryConfig = {}) {
    this.retryStrategy = new RetryStrategy(config.retry);
    this.options = config.recovery ?? {};

    // Only create circuit breaker if explicitly configured
    if (config.circuitBreaker) {
      this.circuitBreaker = new CircuitBreaker(config.circuitBreaker);
    }
  }

  /**
   * Execute a function with full error recovery.
   *
   * Order of operations:
   * 1. Check circuit breaker (if enabled)
   * 2. Execute with retry strategy
   * 3. On success: record success with circuit breaker
   * 4. On failure: invoke callbacks, apply fallback if configured
   *
   * @param fn - The async function to execute
   * @param context - Optional context for error callbacks
   * @param signal - Optional AbortSignal for cancellation
   */
  execute = async <T>(
    fn: () => Promise<T>,
    context?: Partial<Pick<ErrorContext, 'toolName' | 'input'>>,
    signal?: AbortSignal
  ): Promise<ErrorRecoveryResult<T>> => {
    const startTime = Date.now();
    let attempts = 0;

    // Check circuit breaker state BEFORE attempting (fail fast)
    if (this.circuitBreaker) {
      try {
        // Dry run to check circuit state - will throw if open
        // We do this by checking state directly
        const state = this.circuitBreaker.getState();
        if (state === 'OPEN') {
          // Try to execute once to get the proper error with remaining time
          try {
            await this.circuitBreaker.execute(() => Promise.resolve());
          } catch (circuitError) {
            if (circuitError instanceof CircuitOpenError) {
              const elapsedMs = Date.now() - startTime;
              const errorContext: ErrorContext = {
                error: circuitError,
                attempt: 0,
                maxRetries: this.retryStrategy.getOptions().maxRetries,
                toolName: context?.toolName,
                input: context?.input,
                elapsedMs,
              };
              this.options.onError?.(errorContext);

              if (this.options.fallbackResponse !== undefined) {
                return {
                  success: true,
                  value: this.options.fallbackResponse as T,
                  attempts: 0,
                  elapsedMs,
                  usedFallback: true,
                };
              }

              return {
                success: false,
                error: circuitError,
                attempts: 0,
                elapsedMs,
                usedFallback: false,
              };
            }
          }
        }
      } catch {
        // Ignore errors from state check
      }
    }

    // Wrap the function to track attempts and invoke callbacks
    const wrappedFn = async (): Promise<T> => {
      attempts++;
      return fn();
    };

    // If circuit breaker is enabled, wrap execution
    const executeWithBreaker = this.circuitBreaker
      ? () => this.circuitBreaker!.execute(wrappedFn)
      : wrappedFn;

    try {
      // Execute with retry strategy
      const value = await this.retryStrategy.execute(
        executeWithBreaker,
        signal
      );

      return {
        success: true,
        value,
        attempts,
        elapsedMs: Date.now() - startTime,
        usedFallback: false,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const elapsedMs = Date.now() - startTime;

      // Build error context for callbacks
      const errorContext: ErrorContext = {
        error: err,
        attempt: attempts,
        maxRetries: this.retryStrategy.getOptions().maxRetries,
        toolName: context?.toolName,
        input: context?.input,
        elapsedMs,
      };

      // Invoke error callback
      this.options.onError?.(errorContext);

      // Check if we should use fallback
      if (this.options.fallbackResponse !== undefined) {
        return {
          success: true,
          value: this.options.fallbackResponse as T,
          attempts,
          elapsedMs,
          usedFallback: true,
        };
      }

      // No fallback, return failure
      return {
        success: false,
        error: err,
        attempts,
        elapsedMs,
        usedFallback: false,
      };
    }
  };

  /**
   * Execute and throw on failure (simpler API for when you want exceptions).
   *
   * @param fn - The async function to execute
   * @param context - Optional context for error callbacks
   * @param signal - Optional AbortSignal for cancellation
   * @throws The original error if all recovery fails
   */
  executeOrThrow = async <T>(
    fn: () => Promise<T>,
    context?: Partial<Pick<ErrorContext, 'toolName' | 'input'>>,
    signal?: AbortSignal
  ): Promise<T> => {
    const result = await this.execute(fn, context, signal);

    if (!result.success) {
      throw result.error;
    }

    return result.value as T;
  };

  /**
   * Create a wrapped version of a function with error recovery.
   * Useful for creating recoverable versions of existing functions.
   *
   * @param fn - The function to wrap
   * @param context - Optional static context for all invocations
   */
  wrap = <TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => Promise<TResult>,
    context?: Partial<Pick<ErrorContext, 'toolName'>>
  ): ((...args: TArgs) => Promise<ErrorRecoveryResult<TResult>>) => {
    return async (...args: TArgs) => {
      return this.execute(() => fn(...args), { ...context, input: args });
    };
  };

  /**
   * Get the circuit breaker instance (if enabled).
   * Useful for monitoring circuit state.
   */
  getCircuitBreaker = (): CircuitBreaker | undefined => {
    return this.circuitBreaker;
  };

  /**
   * Get the retry strategy instance.
   * Useful for inspecting configuration.
   */
  getRetryStrategy = (): RetryStrategy => {
    return this.retryStrategy;
  };
}
// Re-export error classes for convenience
export { RetryExhaustedError } from './retry.js';
export { CircuitOpenError } from './circuit-breaker.js';
