/**
 * Tracer Factory
 *
 * Traces stay on this machine. The upstream project could also send them to
 * Langfuse's cloud service; this fork removed that: it sent searches and code
 * off the machine, and its OpenTelemetry dependencies crashed ctx on start
 * whenever a fresh install resolved incompatible versions (OpenTelemetry api
 * 1.10, October 2026), even with tracing switched off.
 */

import type { Config } from '../config/schema.js';
import type { Tracer } from './types.js';
import { createNoopTracer } from './noop-tracer.js';

/**
 * The tracer for a command. Always the zero-overhead local tracer; local
 * recording to SQLite is decided separately, by shouldRecord().
 *
 * @param _config - Kept so callers need no change
 */
export function createTracer(_config: Config): Tracer {
  return createNoopTracer();
}
