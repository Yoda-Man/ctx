/**
 * Tracer factory: traces never leave the machine.
 *
 * The upstream project sent traces to Langfuse's cloud when keys were set.
 * This fork removed that path; these tests hold that no configuration or
 * environment variable brings it back.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTracer } from '../factory.js';
import { DEFAULT_CONFIG } from '../../config/defaults.js';
import type { Config } from '../../config/schema.js';

describe('createTracer', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  beforeEach(() => {
    // The upstream variables, set as a user who configured Langfuse would have.
    process.env['LANGFUSE_PUBLIC_KEY'] = 'pk-lf-test';
    process.env['LANGFUSE_SECRET_KEY'] = 'sk-lf-test';
    process.env['LANGFUSE_BASE_URL'] = 'https://cloud.langfuse.com';
  });

  it('is local even with Langfuse keys in the environment and observability on', () => {
    const tracer = createTracer({ ...DEFAULT_CONFIG, observability: { enabled: true, sample_rate: 1 } } as Config);
    expect(tracer.isRemote).toBe(false);
  });

  it('is local with observability off or missing', () => {
    expect(createTracer({ ...DEFAULT_CONFIG, observability: { enabled: false, sample_rate: 1 } } as Config).isRemote).toBe(false);
    expect(createTracer({ ...DEFAULT_CONFIG, observability: undefined } as Config).isRemote).toBe(false);
  });

  it('a trace can still be started and ended, so commands need no change', async () => {
    const tracer = createTracer(DEFAULT_CONFIG);
    const trace = tracer.trace({ name: 'ctx-search', input: 'query' });
    trace.span({ name: 'retrieve' }).end();
    trace.end();
    await expect(tracer.shutdown()).resolves.toBeUndefined();
  });
});
