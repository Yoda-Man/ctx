/**
 * Message Mapper for Anthropic Claude
 *
 * Maps ContextAI's ChatMessage format to Anthropic's message format.
 *
 * KEY DIFFERENCE FROM OPENAI:
 * - System messages are NOT in the messages array
 * - They're passed as a separate `system` parameter
 * - Tool results use `tool_result` type (not role: 'tool')
 */

import type {
  ChatMessage,
  ContentPart,
  GenerateOptions,
  ToolDefinition,
} from '../core/index.js';
import {
  isImageContent,
  isTextContent,
  isDocumentContent,
} from '../core/index.js';
import type Anthropic from '@anthropic-ai/sdk';

// ============================================================================
// Type Aliases for Anthropic SDK types
// ============================================================================

type AnthropicMessage = Anthropic.MessageParam;
type AnthropicContentBlock = Anthropic.ContentBlockParam;
type AnthropicTool = Anthropic.Tool;
type AnthropicTextBlock = Anthropic.TextBlockParam;
type AnthropicImageBlock = Anthropic.ImageBlockParam;
type AnthropicToolUseBlock = Anthropic.ToolUseBlockParam;
type AnthropicToolResultBlock = Anthropic.ToolResultBlockParam;

// ============================================================================
// System Message Extraction
// ============================================================================

/**
 * Result of extracting system messages from the conversation.
 */
interface ExtractedMessages {
  /** Combined system message content (or undefined if none) */
  system: string | undefined;
  /** Non-system messages for the messages array */
  messages: ChatMessage[];
}

/**
 * Extracts system messages from the conversation.
 *
 * Anthropic requires system messages to be passed separately, not in the
 * messages array. This function:
 * 1. Finds all system messages
 * 2. Combines them into a single system string
 * 3. Returns remaining messages without system messages
 *
 * @example
 * ```typescript
 * const { system, messages } = extractSystemMessage([
 *   { role: 'system', content: 'You are helpful.' },
 *   { role: 'user', content: 'Hello' },
 * ]);
 * // system = 'You are helpful.'
 * // messages = [{ role: 'user', content: 'Hello' }]
 * ```
 */
function extractSystemMessage(messages: ChatMessage[]): ExtractedMessages {
  const systemMessages: string[] = [];
  const nonSystemMessages: ChatMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Extract text content from system message
      const text = extractTextContent(msg.content);
      if (text) {
        systemMessages.push(text);
      }
    } else {
      nonSystemMessages.push(msg);
    }
  }

  return {
    system: systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined,
    messages: nonSystemMessages,
  };
}

// ============================================================================
// Message Mapping
// ============================================================================

/**
 * Maps ContextAI ChatMessage array to Anthropic MessageParam array.
 *
 * NOTE: Call extractSystemMessage first to separate system messages!
 * This function assumes system messages have already been extracted.
 */
function mapMessages(messages: ChatMessage[]): AnthropicMessage[] {
  return messages.map(mapMessage);
}

/**
 * Maps a single ChatMessage to Anthropic MessageParam.
 *
 * Handles:
 * - User messages (text or multimodal)
 * - Assistant messages (text or with tool calls)
 * - Tool result messages
 */
function mapMessage(message: ChatMessage): AnthropicMessage {
  switch (message.role) {
    case 'user':
      return mapUserMessage(message);

    case 'assistant':
      return mapAssistantMessage(message);

    case 'tool':
      return mapToolResultMessage(message);

    case 'system':
      // System messages should be extracted before calling mapMessage
      // If we get here, treat as user message (fallback)
      return {
        role: 'user',
        content: extractTextContent(message.content) || '',
      };

    default: {
      // Exhaustive check
      const _exhaustive: never = message.role;
      throw new Error(`Unknown message role: ${_exhaustive}`);
    }
  }
}

/**
 * Maps a user message, handling both text and multimodal content.
 */
function mapUserMessage(message: ChatMessage): AnthropicMessage {
  const content = message.content;

  // Simple text content
  if (typeof content === 'string') {
    return {
      role: 'user',
      content: content,
    };
  }

  // Multimodal content (array of parts)
  if (Array.isArray(content)) {
    const blocks = mapContentParts(content);
    return {
      role: 'user',
      content: blocks,
    };
  }

  // Fallback for unexpected content type
  return {
    role: 'user',
    content: String(content),
  };
}

/**
 * Maps an assistant message, handling tool calls if present.
 */
function mapAssistantMessage(message: ChatMessage): AnthropicMessage {
  const textContent = extractTextContent(message.content);

  // Check if there are tool calls in the message
  // Tool calls are stored in message metadata or as structured content
  const toolCalls = (message as ChatMessage & { toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }).toolCalls;

  if (toolCalls && toolCalls.length > 0) {
    // Assistant message with tool calls
    const blocks: AnthropicContentBlock[] = [];

    // Add text content if present
    if (textContent) {
      blocks.push({ type: 'text', text: textContent });
    }

    // Add tool_use blocks for each tool call
    for (const tc of toolCalls) {
      blocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.arguments,
      } as AnthropicToolUseBlock);
    }

    return {
      role: 'assistant',
      content: blocks,
    };
  }

  // Simple text assistant message
  return {
    role: 'assistant',
    content: textContent || '',
  };
}

/**
 * Maps a tool result message to Anthropic's tool_result format.
 *
 * KEY DIFFERENCE FROM OPENAI:
 * - OpenAI: { role: 'tool', tool_call_id: '...', content: '...' }
 * - Anthropic: { role: 'user', content: [{ type: 'tool_result', tool_use_id: '...', content: '...' }] }
 *
 * Anthropic treats tool results as user messages with tool_result blocks!
 */
function mapToolResultMessage(message: ChatMessage): AnthropicMessage {
  const content = extractTextContent(message.content);

  const toolResultBlock: AnthropicToolResultBlock = {
    type: 'tool_result',
    tool_use_id: message.toolCallId || '',
    content: content || '',
  };

  // Anthropic expects tool results as user messages
  return {
    role: 'user',
    content: [toolResultBlock],
  };
}

// ============================================================================
// Content Part Mapping (Multimodal)
// ============================================================================

/**
 * Maps ContextAI ContentPart array to Anthropic content blocks.
 *
 * Supports:
 * - Text parts
 * - Image parts (base64 or URL - URLs converted to base64 note)
 * - Document parts (limited support)
 */
function mapContentParts(parts: ContentPart[]): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];

  for (const part of parts) {
    const mapped = mapContentPart(part);
    if (mapped) {
      blocks.push(mapped);
    }
  }

  return blocks;
}

/**
 * Maps a single content part to an Anthropic content block.
 */
function mapContentPart(part: ContentPart): AnthropicContentBlock | null {
  if (isTextContent(part)) {
    return {
      type: 'text',
      text: part.text,
    } as AnthropicTextBlock;
  }

  if (isImageContent(part)) {
    return mapImageContent(part);
  }

  if (isDocumentContent(part)) {
    // Anthropic supports PDF documents via base64
    // For now, we'll convert to a text note
    // Full document support could be added later
    if (part.base64 && part.mediaType === 'application/pdf') {
      return {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: part.base64,
        },
      } as unknown as AnthropicContentBlock;
    }
    return null;
  }

  return null;
}

/**
 * Maps image content to Anthropic's image block format.
 *
 * Anthropic requires images as base64 with explicit media type.
 * URL-based images need to be fetched and converted (not done here).
 */
function mapImageContent(
  part: ContentPart & { type: 'image' }
): AnthropicImageBlock | null {
  // Anthropic prefers base64 images
  if (part.base64) {
    const mediaType = part.mediaType || 'image/png';
    // Validate media type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(mediaType)) {
      return null;
    }

    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: part.base64,
      },
    };
  }

  // URL-based images - Anthropic supports these directly now
  if (part.url) {
    return {
      type: 'image',
      source: {
        type: 'url',
        url: part.url,
      },
    } as AnthropicImageBlock;
  }

  return null;
}

// ============================================================================
// Tool Mapping
// ============================================================================

/**
 * Maps ContextAI ToolDefinition array to Anthropic Tool array.
 *
 * Anthropic's tool format:
 * {
 *   name: string,
 *   description: string,
 *   input_schema: JSONSchema  // Note: input_schema, not parameters
 * }
 */
function mapTools(tools: ToolDefinition[]): AnthropicTool[] {
  return tools.map(mapTool);
}

/**
 * Maps a single tool definition to Anthropic format.
 */
function mapTool(tool: ToolDefinition): AnthropicTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as AnthropicTool['input_schema'],
  };
}

// ============================================================================
// Request Building
// ============================================================================

/**
 * Builds complete Anthropic API request parameters.
 *
 * Combines:
 * - Model selection
 * - System message (extracted)
 * - Mapped messages
 * - Generation options (temperature, max_tokens, etc.)
 * - Tools (if any)
 * - Extended thinking config (if enabled)
 */
export function buildRequestParams(
  model: string,
  messages: ChatMessage[],
  options?: GenerateOptions
): Anthropic.MessageCreateParams {
  // Extract system message separately
  const { system, messages: nonSystemMessages } = extractSystemMessage(messages);

  // Build base params
  const params: Anthropic.MessageCreateParams = {
    model,
    messages: mapMessages(nonSystemMessages),
    max_tokens: options?.maxTokens ?? 4096, // Anthropic requires max_tokens
  };

  // Add system message if present
  if (system) {
    params.system = system;
  }

  // Map generation options
  if (options) {
    // temperature, top_p and top_k are not sent: the Messages API removed
    // them (Anthropic SDK 1.x), and the model's own sampling applies.
    if (options.stopSequences?.length) {
      params.stop_sequences = options.stopSequences;
    }

    // Map tools
    if (options.tools?.length) {
      params.tools = mapTools(options.tools);
    }

    // Extended thinking support
    if (options.thinking?.enabled) {
      // Anthropic's extended thinking uses a different parameter
      // The thinking block appears in the response content
      (params as unknown as Record<string, unknown>).thinking = {
        type: 'enabled',
        budget_tokens: options.thinking.budgetTokens ?? 10000,
      };
    }
  }

  return params;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Extracts plain text content from MessageContent.
 * Handles both string and ContentPart[] formats.
 */
function extractTextContent(content: ChatMessage['content']): string | null {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const textParts = content
      .filter(isTextContent)
      .map((p) => p.text);
    return textParts.length > 0 ? textParts.join('') : null;
  }

  return null;
}
