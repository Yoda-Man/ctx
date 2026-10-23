/**
 * RetryStrategy - Exponential backoff with jitter
 *
 * Wraps async operations with automatic retry on failure.
 * Uses exponential backoff to give failing services time to recover.
 */

import { ContextAIError } from '../errors/errors.js';
import type { RetryOptions } from './retry-types.js';
import { DEFAULT_RETRY_OPTIONS } from './retry-types.js';

/**
 * Error thrown when all retry attempts are exhausted.
 */
export class RetryExhaustedError extends ContextAIError {
  constructor(
    message: string,
    public readonly lastError: Error,
    public readonly attempts: number
  ) {
    super(message, 'RETRY_EXHAUSTED');
    this.name = 'RetryExhaustedError';
  }
}

/**
 * RetryStrategy implements exponential backoff with optional jitter.
 *
 * @example
 * ```typescript
 * const retry = new RetryStrategy({ maxRetries: 3 });
 * const result = await retry.execute(async () => {
 *   return await fetchData();
 * });
 * ```
 */
export class RetryStrategy {
  private readonly options: Required<Omit<RetryOptions, 'retryableErrors'>> & {
    retryableErrors?: string[];
  };

  constructor(options: Partial<RetryOptions> = {}) {
    this.options = {
      ...DEFAULT_RETRY_OPTIONS,
      ...options,
    };
  }

  /**
   * Execute an async function with retry logic.
   *
   * @param fn - The async function to execute
   * @param signal - Optional AbortSignal for cancellation
   * @returns The result of the function
   * @throws RetryExhaustedError if all retries fail
   */
  execute = async <T>(
    fn: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> => {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      // Check for abort before each attempt
      if (signal?.aborted) {
        throw new ContextAIError('Retry aborted', 'RETRY_ABORTED');
      }

      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if this error is retryable
        if (!this.isRetryable(lastError)) {
          throw lastError;
        }

        // If this was the last attempt, don't wait
        if (attempt === this.options.maxRetries) {
          break;
        }

        // Calculate and wait for backoff delay
        const delay = this.calculateDelay(attempt);
        await this.sleep(delay, signal);
      }
    }

    // All retries exhausted
    throw new RetryExhaustedError(
      `All ${this.options.maxRetries + 1} attempts failed`,
      lastError!,
      this.options.maxRetries + 1
    );
  };

  /**
   * Calculate delay for a given attempt using exponential backoff.
   * Applies jitter if enabled to prevent thundering herd.
   */
  calculateDelay = (attempt: number): number => {
    // Exponential backoff: baseDelay * (multiplier ^ attempt)
    const exponentialDelay =
      this.options.baseDelayMs *
      Math.pow(this.options.backoffMultiplier, attempt);

    // Cap at maxDelayMs
    const cappedDelay = Math.min(exponentialDelay, this.options.maxDelayMs);

    // Apply jitter if enabled (0.5 to 1.0 multiplier)
    if (this.options.jitter) {
      const jitterMultiplier = 0.5 + Math.random() * 0.5;
      return Math.floor(cappedDelay * jitterMultiplier);
    }

    return cappedDelay;
  };

  /**
   * Check if an error should trigger a retry.
   */
  isRetryable = (error: Error): boolean => {
    // If no specific errors configured, retry all errors
    if (!this.options.retryableErrors?.length) {
      return true;
    }

    // Check if error code matches any retryable error
    const errorCode = (error as ContextAIError).code;
    if (errorCode && this.options.retryableErrors.includes(errorCode)) {
      return true;
    }

    // Check error name as fallback
    return this.options.retryableErrors.includes(error.name);
  };

  /**
   * Sleep for a given duration, respecting abort signal.
   */
  private sleep = (ms: number, signal?: AbortSignal): Promise<void> => {
    return new Promise((resolve, reject) => {
      // If already aborted, reject immediately
      if (signal?.aborted) {
        reject(
          new ContextAIError('Retry aborted during delay', 'RETRY_ABORTED')
        );
        return;
      }

      let settled = false;
      const timeoutId = setTimeout(() => {
        settled = true;
        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }
        resolve();
      }, ms);

      // Listen for abort during sleep
      const abortHandler = () => {
        if (settled) return; // Already resolved, don't reject
        settled = true;
        clearTimeout(timeoutId);
        reject(
          new ContextAIError('Retry aborted during delay', 'RETRY_ABORTED')
        );
      };

      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true });
      }
    });
  };

  /**
   * Get current options (useful for testing/debugging).
   */
  getOptions = (): Readonly<typeof this.options> => {
    return this.options;
  };
}
