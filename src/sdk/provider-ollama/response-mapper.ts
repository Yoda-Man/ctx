/**
 * Response Mapper for Ollama
 *
 * Maps Ollama API responses to ContextAI's unified format.
 *
 * Handles:
 * - Non-streaming responses (single JSON)
 * - Streaming responses (NDJSON chunks)
 * - Tool calls
 * - Token usage estimation (Ollama provides eval_count)
 */

import type { ChatResponse, StreamChunk, ToolCall, TokenUsage } from '../core/index.js';
import type { OllamaChatResponse, OllamaStreamChunk, OllamaToolCall } from './types.js';

// ============================================================================
// Non-Streaming Response Mapping
// ============================================================================

/**
 * Maps a complete Ollama chat response to ContextAI format.
 */
export function mapResponse(response: OllamaChatResponse): ChatResponse {
  const message = response.message;

  // Extract tool calls if present
  const toolCalls = message.tool_calls?.map(mapToolCall);

  // Determine finish reason
  let finishReason: ChatResponse['finishReason'];
  if (toolCalls && toolCalls.length > 0) {
    finishReason = 'tool_calls';
  } else if (response.done_reason === 'length') {
    finishReason = 'length';
  } else {
    finishReason = 'stop';
  }

  // Build usage from Ollama's metrics
  // Note: Ollama provides token counts differently than cloud providers
  const usage = buildUsage(response);

  return {
    content: message.content,
    toolCalls,
    finishReason,
    usage,
    metadata: {
      modelId: response.model,
      // Ollama provides durations in nanoseconds
      latencyMs: response.total_duration
        ? Math.round(response.total_duration / 1_000_000)
        : undefined,
    },
  };
}

/**
 * Maps an Ollama tool call to ContextAI format.
 */
function mapToolCall(toolCall: OllamaToolCall, index: number): ToolCall {
  return {
    // Ollama doesn't provide tool call IDs, so we generate one
    id: `tool_${index}_${Date.now()}`,
    name: toolCall.function.name,
    arguments: toolCall.function.arguments,
  };
}

/**
 * Builds token usage from Ollama response metrics.
 *
 * Ollama provides:
 * - prompt_eval_count: tokens in the prompt
 * - eval_count: tokens generated
 */
function buildUsage(response: OllamaChatResponse): TokenUsage | undefined {
  const promptTokens = response.prompt_eval_count;
  const completionTokens = response.eval_count;

  if (promptTokens === undefined && completionTokens === undefined) {
    return undefined;
  }

  return {
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    totalTokens: (promptTokens ?? 0) + (completionTokens ?? 0),
  };
}

// ============================================================================
// Streaming Response Mapping
// ============================================================================

/**
 * State for tracking tool calls across streaming chunks.
 *
 * Ollama sends tool calls in chunks, so we need to accumulate them.
 */
export interface StreamingState {
  /** Accumulated tool calls by index */
  toolCalls: Map<number, ToolCall>;
  /** Whether we've seen the first content */
  hasContent: boolean;
}

/**
 * Creates a new streaming state for tracking accumulated data.
 */
export function createStreamingState(): StreamingState {
  return {
    toolCalls: new Map(),
    hasContent: false,
  };
}

/**
 * Maps a streaming chunk to ContextAI StreamChunk format.
 *
 * @param chunk - The parsed NDJSON chunk from Ollama
 * @param state - Streaming state for accumulating tool calls
 * @returns StreamChunk to yield, or null if nothing to emit
 */
export function mapStreamChunk(
  chunk: OllamaStreamChunk,
  state: StreamingState
): StreamChunk | null {
  const message = chunk.message;

  // Handle text content
  if (message.content && message.content.length > 0) {
    state.hasContent = true;
    return {
      type: 'text',
      content: message.content,
    };
  }

  // Handle tool calls in streaming
  if (message.tool_calls && message.tool_calls.length > 0) {
    const toolCalls = message.tool_calls; // Store in const for type narrowing

    // Ollama sends complete tool calls in streaming, not partial
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i]!; // Non-null assertion safe due to length check
      const toolCall = mapToolCall(tc, i);
      state.toolCalls.set(i, toolCall);
    }

    // Emit tool call chunk for the first tool call
    const firstToolCall = toolCalls[0]!; // Non-null assertion safe due to length check
    return {
      type: 'tool_call',
      toolCall: {
        id: `tool_0_${Date.now()}`,
        name: firstToolCall.function.name,
        arguments: firstToolCall.function.arguments,
      },
    };
  }

  // Handle final chunk with metrics
  if (chunk.done) {
    const usage = buildUsage(chunk as unknown as OllamaChatResponse);

    if (usage) {
      return {
        type: 'usage',
        usage,
        metadata: {
          modelId: chunk.model,
          latencyMs: chunk.total_duration
            ? Math.round(chunk.total_duration / 1_000_000)
            : undefined,
        },
      };
    }

    // Emit done chunk
    return {
      type: 'done',
      metadata: {
        modelId: chunk.model,
      },
    };
  }

  return null;
}

/**
 * Finalizes streaming state and returns any accumulated tool calls.
 */
export function finalizeToolCalls(state: StreamingState): ToolCall[] {
  return Array.from(state.toolCalls.values());
}

// ============================================================================
// NDJSON Parsing
// ============================================================================

/**
 * Parses an NDJSON (Newline-Delimited JSON) line.
 *
 * NDJSON is used by Ollama for streaming responses.
 * Each line is a complete JSON object.
 *
 * @param line - A single line from the stream
 * @returns Parsed chunk or null if line is empty/invalid
 */
export function parseNDJSONLine(line: string): OllamaStreamChunk | null {
  const trimmed = line.trim();

  // Skip empty lines
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as OllamaStreamChunk;
  } catch {
    // Invalid JSON - skip this line
    return null;
  }
}

/**
 * Creates an async generator that parses NDJSON from a ReadableStream.
 *
 * This handles the complexity of:
 * - Chunked data (lines split across chunks)
 * - UTF-8 decoding
 * - Empty lines
 *
 * @param body - The ReadableStream from fetch response
 * @yields Parsed OllamaStreamChunk objects
 */
export async function* parseNDJSONStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<OllamaStreamChunk, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Process any remaining buffer
        if (buffer.trim()) {
          const chunk = parseNDJSONLine(buffer);
          if (chunk) {
            yield chunk;
          }
        }
        break;
      }

      // Decode and append to buffer
      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split('\n');

      // Keep the last incomplete line in buffer
      buffer = lines.pop() || '';

      // Parse and yield complete lines
      for (const line of lines) {
        const chunk = parseNDJSONLine(line);
        if (chunk) {
          yield chunk;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
