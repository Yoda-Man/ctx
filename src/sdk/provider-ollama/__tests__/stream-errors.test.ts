/**
 * The bug logged against @contextexpert/cli 1.4.0: `ctx ask` exited with
 * "Failed to connect to Ollama server: Cannot read properties of undefined
 * (reading 'content')" while Ollama was running. Ollama had reported a
 * failure mid-stream as {"error":"EOF"} (a line without `message`; seen with
 * qwen3.5:9b when a prompt contains `<tool_call>`), the mapper read
 * message.content on it, and the resulting TypeError was labelled a
 * connection failure.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { OllamaProvider } from '../ollama-provider.js';
import { mapStreamChunk, createStreamingState } from '../response-mapper.js';
import { mapOllamaError, OllamaProviderError } from '../errors.js';

function ndjson(lines: object[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(new TextEncoder().encode(JSON.stringify(line) + '\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const text = (content: string) => ({ model: 'qwen3.5:9b', created_at: '', message: { role: 'assistant', content }, done: false });

afterEach(() => vi.unstubAllGlobals());

describe('an error Ollama reports mid-stream', () => {
  it('ends the stream with Ollama\'s own message, not a connection error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjson([text('The version is'), { error: 'EOF' }])));
    const provider = new OllamaProvider({ model: 'qwen3.5:9b' });
    const seen: Array<{ content?: string; error?: { message: string; code?: string } }> = [];

    await expect(async () => {
      for await (const chunk of provider.streamChat([{ role: 'user', content: '<tool_call>' }])) seen.push(chunk);
    }).rejects.toMatchObject({ code: 'OLLAMA_API_ERROR', message: 'Ollama stopped generating: EOF' });

    expect(seen[0]?.content).toBe('The version is');
    expect(seen.at(-1)?.error).toEqual({ message: 'Ollama stopped generating: EOF', code: 'OLLAMA_API_ERROR' });
    expect(JSON.stringify(seen)).not.toMatch(/Failed to connect|reading 'content'/);
  });

  it('a line with neither message nor error is skipped', () => {
    expect(mapStreamChunk({ model: 'm', done: true }, createStreamingState())).toBeNull();
  });
});

describe('what counts as a connection failure', () => {
  it('fetch\'s own network failure does', () => {
    const err = mapOllamaError(new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:11434') }));
    expect(err.code).toBe('OLLAMA_CONNECTION_ERROR');
  });

  it('a bug in this code does not', () => {
    const err = mapOllamaError(new TypeError("Cannot read properties of undefined (reading 'content')"));
    expect(err).toBeInstanceOf(OllamaProviderError);
    expect(err.code).toBe('OLLAMA_API_ERROR');
    expect(err.message).not.toMatch(/Failed to connect/);
  });
});
