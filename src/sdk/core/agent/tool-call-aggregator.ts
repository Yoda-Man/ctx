import type { ToolCall, StreamChunk } from '../provider/types';

/**
 * Pending tool call being assembled from stream chunks
 */
interface PendingToolCall {
  id: string;
  name?: string;
  argumentsBuffer: string;
}

/**
 * Aggregates partial tool_call chunks from streaming LLM responses
 * into complete ToolCall objects.
 *
 * LLM providers stream tool calls incrementally:
 * - First chunk: { id: 'call_123' }
 * - Next chunk: { name: 'search' }
 * - Following chunks: { arguments: '{"query":' }, { arguments: '"weather"}' }
 *
 * This class buffers these pieces and assembles complete tool calls.
 *
 * @example
 * ```typescript
 * const aggregator = new ToolCallAggregator();
 *
 * for await (const chunk of llm.streamChat(messages)) {
 *   if (chunk.type === 'tool_call') {
 *     aggregator.process(chunk);
 *   }
 * }
 *
 * const toolCalls = aggregator.finalize();
 * // Now execute the complete tool calls
 * ```
 */

export class ToolCallAggregator {
  private pending: Map<string, PendingToolCall> = new Map();
  private currentId: string | null = null;

  /**
   * Process a tool_call chunk from the stream
   *
   * Chunks may contain partial data:
   * - id: Identifies which tool call this belongs to
   * - name: The tool name
   * - arguments: JSON string fragment (accumulated across chunks)
   */
  process(chunk: StreamChunk): void {
    if (chunk.type !== 'tool_call' || !chunk.toolCall) {
      return;
    }

    const partial = chunk.toolCall;

    // If we get a new ID, start tracking a new tool call
    if (partial.id) {
      this.currentId = partial.id;
      if (!this.pending.has(partial.id)) {
        this.pending.set(partial.id, {
          id: partial.id,
          name: undefined,
          argumentsBuffer: '',
        });
      }
    }

    // Must have an ID to process (either from this chunk or previous)
    const id = partial.id ?? this.currentId;
    if (!id) {
      return;
    }

    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }

    // Update name if provided
    if (partial.name) {
      pending.name = partial.name;
    }

    // Accumulate arguments string
    if (partial.arguments !== undefined) {
      if (typeof partial.arguments === 'string') {
        pending.argumentsBuffer += partial.arguments;
      } else {
        // Already parsed object (some providers do this)
        pending.argumentsBuffer = JSON.stringify(partial.arguments);
      }
    }
  }

  /**
   * Finalize and return all complete tool calls
   *
   * Call this after streaming completes (on 'done' chunk or stream end).
   * Parses accumulated JSON arguments and returns valid tool calls.
   * Invalid/incomplete tool calls are skipped.
   */
  finalize(): ToolCall[] {
    const completed: ToolCall[] = [];

    for (const pending of this.pending.values()) {
      // Must have both name and arguments to be valid
      if (!pending.name) {
        continue;
      }

      try {
        const args = pending.argumentsBuffer
          ? JSON.parse(pending.argumentsBuffer)
          : {};

        completed.push({
          id: pending.id,
          name: pending.name,
          arguments: args,
        });
      } catch {
        // JSON parse failed - skip this tool call
        // This can happen if streaming was interrupted
      }
    }

    return completed;
  }

  /**
   * Check if there are any pending tool calls being aggregated
   */
  hasPending(): boolean {
    return this.pending.size > 0;
  }

  /**
   * Reset state for next ReAct iteration
   *
   * Call this after processing tool calls and before the next LLM call.
   */
  reset(): void {
    this.pending.clear();
    this.currentId = null;
  }
}
