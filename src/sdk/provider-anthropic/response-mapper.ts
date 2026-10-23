/**
 * Response Mapper for Anthropic Claude
 *
 * Maps Anthropic API responses to ContextAI's ChatResponse format.
 *
 * KEY DIFFERENCES FROM OPENAI:
 * - Streaming uses discrete event types (not deltas)
 * - Tool calls are content blocks with type: 'tool_use'
 * - Extended thinking appears as type: 'thinking' blocks
 * - Finish reasons differ: 'end_turn' vs 'stop', 'tool_use' vs 'tool_calls'
 */

import type {
  ChatResponse,
  StreamChunk,
  ToolCall,
  TokenUsage,
  ResponseMetadata,
} from '../core/index.js';
import type Anthropic from '@anthropic-ai/sdk';

// ============================================================================
// Type Aliases
// ============================================================================

type AnthropicMessage = Anthropic.Message;
type AnthropicContentBlock = Anthropic.ContentBlock;
type AnthropicStreamEvent = Anthropic.MessageStreamEvent;

// ============================================================================
// Non-Streaming Response Mapping
// ============================================================================

/**
 * Maps an Anthropic Message response to ContextAI ChatResponse.
 *
 * Extracts:
 * - Text content from text blocks
 * - Tool calls from tool_use blocks
 * - Thinking content from thinking blocks (extended thinking)
 * - Usage statistics
 * - Metadata (request ID, model)
 */
export function mapResponse(message: AnthropicMessage): ChatResponse {
  // Extract content from blocks
  const { text, toolCalls, thinking } = extractContentBlocks(message.content);

  // Map finish reason
  const finishReason = mapStopReason(message.stop_reason);

  // Build usage stats
  const usage: TokenUsage = {
    promptTokens: message.usage.input_tokens,
    completionTokens: message.usage.output_tokens,
    totalTokens: message.usage.input_tokens + message.usage.output_tokens,
  };

  // Add cache tokens if present (prompt caching feature)
  const extendedUsage = message.usage as {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  if (extendedUsage.cache_read_input_tokens) {
    usage.cacheReadTokens = extendedUsage.cache_read_input_tokens;
  }
  if (extendedUsage.cache_creation_input_tokens) {
    usage.cacheWriteTokens = extendedUsage.cache_creation_input_tokens;
  }

  // Build metadata
  const metadata: ResponseMetadata = {
    requestId: message.id,
    modelId: message.model,
  };

  return {
    content: text,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason,
    usage,
    metadata,
    thinking: thinking || undefined,
  };
}

/**
 * Extracts text, tool calls, and thinking from Anthropic content blocks.
 */
function extractContentBlocks(blocks: AnthropicContentBlock[]): {
  text: string;
  toolCalls: ToolCall[];
  thinking: string | null;
} {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  let thinking: string | null = null;

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        textParts.push(block.text);
        break;

      case 'tool_use':
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
        break;

      case 'thinking':
        // Extended thinking block (Claude's reasoning)
        thinking = (block as { type: 'thinking'; thinking: string }).thinking;
        break;
    }
  }

  return {
    text: textParts.join(''),
    toolCalls,
    thinking,
  };
}

/**
 * Maps Anthropic stop_reason to ContextAI finish reason.
 *
 * Anthropic reasons:
 * - 'end_turn' -> 'stop' (normal completion)
 * - 'tool_use' -> 'tool_calls' (model wants to call tools)
 * - 'max_tokens' -> 'length' (hit token limit)
 * - 'stop_sequence' -> 'stop' (hit stop sequence)
 * - null -> 'stop' (shouldn't happen, but handle gracefully)
 */
function mapStopReason(
  reason: AnthropicMessage['stop_reason']
): ChatResponse['finishReason'] {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'tool_use':
      return 'tool_calls';
    case 'max_tokens':
      return 'length';
    default:
      return 'stop';
  }
}

// ============================================================================
// Streaming Response Mapping
// ============================================================================

/**
 * State for accumulating tool calls during streaming.
 *
 * Tool calls arrive in pieces:
 * 1. content_block_start: { type: 'tool_use', id, name }
 * 2. content_block_delta: { partial_json: '...' } (multiple times)
 * 3. content_block_stop: finalize and emit
 */
interface StreamingToolCallState {
  /** Tool call ID from Anthropic */
  id: string;
  /** Tool/function name */
  name: string;
  /** Accumulated JSON string for arguments */
  argumentsJson: string;
  /** Block index for tracking */
  index: number;
}

/**
 * State for tracking the current streaming block.
 */
export interface StreamingState {
  /** Current content block index */
  currentBlockIndex: number;
  /** Current block type */
  currentBlockType: 'text' | 'tool_use' | 'thinking' | null;
  /** Tool calls being accumulated */
  toolCalls: Map<number, StreamingToolCallState>;
  /** Message ID from message_start */
  messageId: string | null;
  /** Model ID from message_start */
  modelId: string | null;
}

/**
 * Creates a fresh streaming state for a new stream.
 */
export function createStreamingState(): StreamingState {
  return {
    currentBlockIndex: -1,
    currentBlockType: null,
    toolCalls: new Map(),
    messageId: null,
    modelId: null,
  };
}

/**
 * Maps an Anthropic stream event to a ContextAI StreamChunk.
 *
 * Returns null for events that don't produce output (e.g., message_start metadata).
 * The caller should skip null returns.
 *
 * @param event - Anthropic stream event
 * @param state - Mutable streaming state (updated in place)
 * @returns StreamChunk or null
 */
export function mapStreamEvent(
  event: AnthropicStreamEvent,
  state: StreamingState
): StreamChunk | null {
  switch (event.type) {
    // ========================================================================
    // Message lifecycle events
    // ========================================================================

    case 'message_start':
      // Capture metadata for later
      state.messageId = event.message.id;
      state.modelId = event.message.model;
      // No chunk to emit yet
      return null;

    case 'message_delta':
      // End of message - emit usage and done
      return mapMessageDelta(event, state);

    case 'message_stop':
      // Stream complete - emit done chunk
      return {
        type: 'done',
        metadata: {
          requestId: state.messageId ?? undefined,
          modelId: state.modelId ?? undefined,
        },
      };

    // ========================================================================
    // Content block lifecycle events
    // ========================================================================

    case 'content_block_start':
      return mapContentBlockStart(event, state);

    case 'content_block_delta':
      return mapContentBlockDelta(event, state);

    case 'content_block_stop':
      // Block complete - finalize any pending tool call
      return mapContentBlockStop(state);

    default:
      // Unknown event type (including ping keep-alive), skip
      return null;
  }
}

/**
 * Handles content_block_start event.
 * Initializes state for new text, tool_use, or thinking blocks.
 */
function mapContentBlockStart(
  event: Extract<AnthropicStreamEvent, { type: 'content_block_start' }>,
  state: StreamingState
): StreamChunk | null {
  state.currentBlockIndex = event.index;
  const block = event.content_block;

  switch (block.type) {
    case 'text':
      state.currentBlockType = 'text';
      // Text blocks start empty, content comes in deltas
      return null;

    case 'tool_use':
      state.currentBlockType = 'tool_use';
      // Initialize tool call state
      state.toolCalls.set(event.index, {
        id: block.id,
        name: block.name,
        argumentsJson: '',
        index: event.index,
      });
      // Emit initial tool_call chunk with name
      return {
        type: 'tool_call',
        toolCall: {
          id: block.id,
          name: block.name,
          arguments: undefined, // Arguments come in deltas
        },
      };

    case 'thinking':
      state.currentBlockType = 'thinking';
      // Thinking blocks start empty
      return null;

    default:
      state.currentBlockType = null;
      return null;
  }
}

/**
 * Handles content_block_delta event.
 * Emits incremental content for text, tool arguments, or thinking.
 */
function mapContentBlockDelta(
  event: Extract<AnthropicStreamEvent, { type: 'content_block_delta' }>,
  state: StreamingState
): StreamChunk | null {
  const delta = event.delta;

  switch (delta.type) {
    case 'text_delta':
      // Incremental text content
      return {
        type: 'text',
        content: delta.text,
      };

    case 'input_json_delta':
      // Incremental tool call arguments (JSON string)
      const toolState = state.toolCalls.get(event.index);
      if (toolState) {
        toolState.argumentsJson += delta.partial_json;
        // Emit partial arguments for real-time display
        return {
          type: 'tool_call',
          toolCall: {
            id: toolState.id,
            name: toolState.name,
            arguments: toolState.argumentsJson, // Partial JSON string
          },
        };
      }
      return null;

    case 'thinking_delta':
      // Incremental thinking content (extended thinking)
      return {
        type: 'thinking',
        thinking: (delta as { type: 'thinking_delta'; thinking: string }).thinking,
      };

    default:
      return null;
  }
}

/**
 * Handles content_block_stop event.
 * Finalizes tool calls by parsing accumulated JSON.
 */
function mapContentBlockStop(state: StreamingState): StreamChunk | null {
  // If this was a tool_use block, emit finalized tool call
  if (state.currentBlockType === 'tool_use') {
    const toolState = state.toolCalls.get(state.currentBlockIndex);
    if (toolState && toolState.argumentsJson) {
      // Parse the accumulated JSON
      const parsedArgs = safeParseJSON(toolState.argumentsJson);
      return {
        type: 'tool_call',
        toolCall: {
          id: toolState.id,
          name: toolState.name,
          arguments: parsedArgs, // Parsed object
        },
      };
    }
  }

  // Reset block tracking
  state.currentBlockType = null;
  return null;
}

/**
 * Handles message_delta event.
 * Emits usage statistics when available.
 */
function mapMessageDelta(
  event: Extract<AnthropicStreamEvent, { type: 'message_delta' }>,
  state: StreamingState
): StreamChunk | null {
  const usage = event.usage;
  if (usage) {
    return {
      type: 'usage',
      usage: {
        promptTokens: 0, // Not available in delta, only output tokens
        completionTokens: usage.output_tokens,
        totalTokens: usage.output_tokens,
      },
      metadata: {
        requestId: state.messageId ?? undefined,
        modelId: state.modelId ?? undefined,
      },
    };
  }
  return null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Finalizes all accumulated tool calls from streaming state.
 * Call this after the stream ends to get parsed tool calls.
 */
export function finalizeToolCalls(state: StreamingState): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  for (const [, toolState] of state.toolCalls) {
    if (toolState.id && toolState.name) {
      toolCalls.push({
        id: toolState.id,
        name: toolState.name,
        arguments: safeParseJSON(toolState.argumentsJson),
      });
    }
  }

  return toolCalls;
}

/**
 * Safely parses JSON, returning empty object on failure.
 */
function safeParseJSON(json: string): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
