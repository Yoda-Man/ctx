import type {
  ChatResponse,
  StreamChunk,
  TokenUsage,
  ToolCall,
  ResponseMetadata,
} from '../core/index.js';
import type OpenAI from 'openai';
import { OpenAIProviderError } from './errors.js';

type OpenAIChatCompletion = OpenAI.Chat.Completions.ChatCompletion;
type OpenAIStreamChunk = OpenAI.Chat.Completions.ChatCompletionChunk;
// Use the actual OpenAI finish reason type from the SDK
type OpenAIFinishReason = OpenAI.Chat.Completions.ChatCompletion['choices'][0]['finish_reason'];

/**
 * Convert OpenAI finish reason to ContextAI format.
 */
function mapFinishReason(
  reason: OpenAIFinishReason
): ChatResponse['finishReason'] {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool_calls':
    case 'function_call': // Legacy, equivalent to tool_calls
      return 'tool_calls';
    case 'content_filter':
      return 'content_filter';
    case null:
    default:
      return 'stop'; // Default to stop if unknown
  }
}

/**
 * Convert OpenAI usage to ContextAI TokenUsage.
 */
function mapUsage(usage: OpenAIChatCompletion['usage']): TokenUsage | undefined {
  if (!usage) return undefined;

  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    // OpenAI doesn't provide these directly, but some models might
    reasoningTokens: (usage as { reasoning_tokens?: number }).reasoning_tokens,
  };
}

/**
 * Convert OpenAI tool calls to ContextAI format.
 */
function mapToolCalls(
  toolCalls?: OpenAIChatCompletion['choices'][0]['message']['tool_calls']
): ToolCall[] | undefined {
  if (!toolCalls || toolCalls.length === 0) return undefined;

  // openai 5+ also has 'custom' tool calls; ctx only defines function tools.
  return toolCalls.flatMap((tc) =>
    tc.type === 'function'
      ? [{ id: tc.id, name: tc.function.name, arguments: safeParseJSON(tc.function.arguments) }]
      : []
  );
}

/**
 * Safely parse JSON, returning empty object on failure.
 */
function safeParseJSON(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Convert OpenAI ChatCompletion to ContextAI ChatResponse.
 */
export function mapResponse(completion: OpenAIChatCompletion): ChatResponse {
  const choice = completion.choices[0];

  if (!choice) {
    throw new OpenAIProviderError(
      'No choices in OpenAI response',
      'OPENAI_INVALID_RESPONSE'
    );
  }

  const metadata: ResponseMetadata = {
    requestId: completion.id,
    modelId: completion.model,
    systemFingerprint: completion.system_fingerprint ?? undefined,
  };

  return {
    content: choice.message.content || '',
    toolCalls: mapToolCalls(choice.message.tool_calls),
    finishReason: mapFinishReason(choice.finish_reason),
    usage: mapUsage(completion.usage),
    metadata,
  };
}

/**
 * State for accumulating streaming tool calls.
 * Tool calls arrive in pieces and must be assembled.
 */
export interface StreamingToolCallState {
  id: string;
  name: string;
  arguments: string; // Accumulated JSON string
}

/**
 * Convert OpenAI stream chunk to ContextAI StreamChunk.
 * Returns null if chunk has no meaningful content.
 *
 * @param chunk - The OpenAI stream chunk
 * @param toolCallState - Mutable state for accumulating tool calls
 */
export function mapStreamChunk(
  chunk: OpenAIStreamChunk,
  toolCallState: Map<number, StreamingToolCallState>
): StreamChunk | null {
  const choice = chunk.choices[0];

  // Final chunk with usage
  if (chunk.usage) {
    return {
      type: 'usage',
      usage: {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens,
      },
    };
  }

  if (!choice) {
    return null;
  }

  const delta = choice.delta;

  // Text content chunk
  if (delta.content) {
    return {
      type: 'text',
      content: delta.content,
    };
  }

  // Tool call chunks - need to accumulate
  if (delta.tool_calls && delta.tool_calls.length > 0) {
    for (const tc of delta.tool_calls) {
      const index = tc.index;

      // Initialize state for new tool call
      if (!toolCallState.has(index)) {
        toolCallState.set(index, {
          id: tc.id || '',
          name: tc.function?.name || '',
          arguments: '',
        });
      }

      const state = toolCallState.get(index)!;

      // Update state with new data
      if (tc.id) state.id = tc.id;
      if (tc.function?.name) state.name = tc.function.name;
      if (tc.function?.arguments) {
        state.arguments += tc.function.arguments;
      }

      // Emit tool_call chunk with current state
      // Arguments may be partial JSON at this point
      return {
        type: 'tool_call',
        toolCall: {
          id: state.id || undefined,
          name: state.name || undefined,
          arguments: state.arguments || undefined,
        },
      };
    }
  }

  // Check for finish reason
  if (choice.finish_reason) {
    // If finished with tool_calls, emit final tool calls
    if (choice.finish_reason === 'tool_calls') {
      // The accumulated tool calls are in toolCallState
      // Caller will handle emitting the done chunk
    }

    return {
      type: 'done',
      metadata: {
        requestId: chunk.id,
        modelId: chunk.model,
        systemFingerprint: chunk.system_fingerprint ?? undefined,
      },
    };
  }

  return null;
}

/**
 * Get finalized tool calls from accumulated state.
 */
export function finalizeToolCalls(
  toolCallState: Map<number, StreamingToolCallState>
): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  for (const [, state] of toolCallState) {
    if (state.id && state.name) {
      toolCalls.push({
        id: state.id,
        name: state.name,
        arguments: safeParseJSON(state.arguments),
      });
    }
  }

  return toolCalls;
}
