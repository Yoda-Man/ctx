import { ToolTimeoutError } from '../errors/errors';

/** Default tool timeout: 30 seconds */
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

/**
 * Wrap a promise with timeout enforcement
 *
 * Uses Promise.race() to race the original promise against a timeout.
 * If the timeout wins, throws ToolTimeoutError.
 *
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param toolName - Tool name for error reporting
 * @returns The promise result, or throws ToolTimeoutError
 */

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  toolName: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new ToolTimeoutError(toolName, timeoutMs));
    }, timeoutMs);
  });

  try {
    //Race: first one to resolve/reject wins
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    // Always cleanup the timer to prevent memory leaks
    clearTimeout(timeoutId!);
  }
}

/**
 * Create an AbortController that triggers on timeout OR external abort
 *
 * This allows tools to receive an abort signal they can use for cleanup
 * when either:
 * 1. The timeout expires
 * 2. An external signal aborts (e.g., user cancellation)
 *
 * @param timeoutMs - Timeout in milliseconds
 * @param externalSignal - Optional external AbortSignal to link
 * @returns Object with combined signal and cleanup function
 */

export function createCombinedSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();

  //Set up timeout
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  // Link external signal if provided
  const abortHandler = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      // Already aborted, abort immediately
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', abortHandler);
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', abortHandler);
    },
  };
}
