/**
 * Anything can be thrown; these turn it into something printable or rethrowable.
 */

/** The message of a thrown value: an Error's message, or the value as text. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A thrown value as an Error, wrapping non-Error values. */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
