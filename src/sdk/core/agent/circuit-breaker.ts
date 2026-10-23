/**
 * CircuitBreaker - Fail fast on repeated failures
 *
 * Prevents cascading failures by stopping requests to failing services.
 * Implements the standard circuit breaker pattern with three states.
 */

import { ContextAIError } from '../errors/errors.js';
import type {
  CircuitBreakerState,
  CircuitBreakerOptions,
} from './retry-types.js';
import { DEFAULT_CIRCUIT_BREAKER_OPTIONS } from './retry-types.js';

/**
 * Error thrown when circuit is open and rejecting requests.
 */
export class CircuitOpenError extends ContextAIError {
  constructor(
    message: string,
    public readonly remainingMs: number
  ) {
    super(message, 'CIRCUIT_OPEN');
    this.name = 'CircuitOpenError';
  }
}

/**
 * CircuitBreaker implements the circuit breaker pattern.
 *
 * State transitions:
 * - CLOSED: Normal operation, tracking failures
 * - OPEN: Rejecting all requests immediately (fail fast)
 * - HALF_OPEN: Testing with limited requests to see if service recovered
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker({ failureThreshold: 5 });
 * const result = await breaker.execute(async () => {
 *   return await callExternalService();
 * });
 * ```
 */
export class CircuitBreaker {
  private readonly options: CircuitBreakerOptions;
  private state: CircuitBreakerState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenSuccesses = 0;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.options = {
      ...DEFAULT_CIRCUIT_BREAKER_OPTIONS,
      ...options,
    };
  }

  /**
   * Execute a function through the circuit breaker.
   *
   * @param fn - The async function to execute
   * @returns The result of the function
   * @throws CircuitOpenError if circuit is open
   */
  execute = async <T>(fn: () => Promise<T>): Promise<T> => {
    // Check if we should allow the request
    this.checkState();

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  };

  /**
   * Check current state and potentially transition.
   * Throws if circuit is open and should reject.
   */
  private checkState = (): void => {
    const now = Date.now();

    switch (this.state) {
      case 'CLOSED':
        // Normal operation, allow request
        return;

      case 'OPEN': {
        // Check if timeout has elapsed
        const elapsed = now - this.lastFailureTime;
        if (elapsed >= this.options.resetTimeoutMs) {
          // Transition to HALF_OPEN
          this.state = 'HALF_OPEN';
          this.halfOpenSuccesses = 0;
          return;
        }
        // Still open, reject immediately
        throw new CircuitOpenError(
          'Circuit breaker is open',
          this.options.resetTimeoutMs - elapsed
        );
      }

      case 'HALF_OPEN':
        // Allow limited requests to test recovery
        return;
    }
  };

  /**
   * Handle successful execution.
   */
  private onSuccess = (): void => {
    switch (this.state) {
      case 'CLOSED':
        // Reset failure count on success
        this.failureCount = 0;
        break;

      case 'HALF_OPEN':
        this.halfOpenSuccesses++;
        // If we've had enough successes, close the circuit
        if (this.halfOpenSuccesses >= this.options.halfOpenRequests) {
          this.state = 'CLOSED';
          this.failureCount = 0;
        }
        break;

      case 'OPEN':
        // Should not happen, but handle gracefully
        break;
    }
  };

  /**
   * Handle failed execution.
   */
  private onFailure = (): void => {
    this.lastFailureTime = Date.now();

    switch (this.state) {
      case 'CLOSED':
        this.failureCount++;
        // Check if we should open the circuit
        if (this.failureCount >= this.options.failureThreshold) {
          this.state = 'OPEN';
        }
        break;

      case 'HALF_OPEN':
        // Any failure in half-open goes back to open
        this.state = 'OPEN';
        break;

      case 'OPEN':
        // Already open, just update failure time
        break;
    }
  };

  /**
   * Get current circuit state (useful for monitoring/debugging).
   */
  getState = (): CircuitBreakerState => {
    return this.state;
  };

  /**
   * Get current failure count.
   */
  getFailureCount = (): number => {
    return this.failureCount;
  };

  /**
   * Manually reset the circuit breaker to closed state.
   */
  reset = (): void => {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.halfOpenSuccesses = 0;
    this.lastFailureTime = 0;
  };

  /**
   * Force the circuit open (useful for testing or manual intervention).
   */
  trip = (): void => {
    this.state = 'OPEN';
    this.lastFailureTime = Date.now();
  };
}
