import type {
  ChatMessage,
  ContentPart,
  GenerateOptions,
  ResponseFormat,
  ToolDefinition,
} from '../core/index.js';
import {
  isDocumentContent,
  isImageContent,
  isMultimodalContent,
  isTextContent,
} from '../core/index.js';
import type OpenAI from 'openai';

type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type OpenAIContentPart = OpenAI.Chat.Completions.ChatCompletionContentPart;
type OpenAITool = OpenAI.Chat.Completions.ChatCompletionTool;
type OpenAIResponseFormat = OpenAI.Chat.Completions.ChatCompletionCreateParams['response_format'];

/**
 * Convert ContextAI ChatMessage array to OpenAI message format.
 */
function mapMessages(messages: ChatMessage[]): OpenAIMessage[] {
  return messages.map(mapMessage);
}

/**
 * Convert a single ChatMessage to OpenAI format.
 */
function mapMessage(message: ChatMessage): OpenAIMessage {
  switch (message.role) {
    case 'system':
      return {
        role: 'system',
        content: extractTextFromContent(message.content),
      };

    case 'user':
      return {
        role: 'user',
        content: isMultimodalContent(message.content)
          ? mapContentParts(message.content)
          : extractTextFromContent(message.content),
      };

    case 'assistant':
      // Assistant messages may have tool calls
      return {
        role: 'assistant',
        content: extractTextFromContent(message.content) || null,
        // Note: tool_calls would be added by the response mapper when needed
      };

    case 'tool':
      return {
        role: 'tool',
        tool_call_id: message.toolCallId || '',
        content: extractTextFromContent(message.content),
      };

    default:
      // Exhaustive check
      const _exhaustive: never = message.role;
      throw new Error(`Unknown message role: ${_exhaustive}`);
  }
}

/**
 * Convert ContextAI content parts to OpenAI format.
 */
function mapContentParts(parts: ContentPart[]): OpenAIContentPart[] {
  return parts.map(mapContentPart).filter((p): p is OpenAIContentPart => p !== null);
}

/**
 * Convert a single content part to OpenAI format.
 */
function mapContentPart(part: ContentPart): OpenAIContentPart | null {
  if (isTextContent(part)) {
    return {
      type: 'text',
      text: part.text,
    };
  }

  if (isImageContent(part)) {
    // OpenAI supports images via URL or base64 data URL
    let imageUrl: string;

    if (part.url) {
      imageUrl = part.url;
    } else if (part.base64) {
      // Format: data:{mediaType};base64,{data}
      const mediaType = part.mediaType || 'image/png';
      imageUrl = `data:${mediaType};base64,${part.base64}`;
    } else {
      // No image source provided
      return null;
    }

    return {
      type: 'image_url',
      image_url: {
        url: imageUrl,
        detail: part.detail || 'auto',
      },
    };
  }

  if (isDocumentContent(part)) {
    // OpenAI doesn't natively support documents in chat
    // We could potentially extract text, but for now skip
    // This should be handled at a higher level (RAG pipeline)
    return null;
  }

  // Unknown content type - skip
  return null;
}

/**
 * Extract text content from MessageContent.
 */
function extractTextFromContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  // Extract text from multimodal content
  return content
    .filter(isTextContent)
    .map((part) => part.text)
    .join('\n');
}

/**
 * Convert ContextAI tools to OpenAI function calling format.
 */
function mapTools(tools: ToolDefinition[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Convert ContextAI response format to OpenAI format.
 */
function mapResponseFormat(
  format: ResponseFormat
): OpenAIResponseFormat {
  switch (format.type) {
    case 'text':
      return { type: 'text' };

    case 'json_object':
      return { type: 'json_object' };

    case 'json_schema':
      return {
        type: 'json_schema',
        json_schema: {
          name: format.jsonSchema.name,
          schema: format.jsonSchema.schema,
          strict: format.jsonSchema.strict ?? true,
        },
      };

    default:
      // Exhaustive check
      const _exhaustive: never = format;
      throw new Error(`Unknown response format: ${JSON.stringify(_exhaustive)}`);
  }
}

/**
 * Build the full request parameters for OpenAI API.
 */
export function buildRequestParams(
  model: string,
  messages: ChatMessage[],
  options?: GenerateOptions
): OpenAI.Chat.Completions.ChatCompletionCreateParams {
  const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
    model,
    messages: mapMessages(messages),
  };

  if (options) {
    // Temperature and sampling
    if (options.temperature !== undefined) {
      params.temperature = options.temperature;
    }
    if (options.maxTokens !== undefined) {
      params.max_tokens = options.maxTokens;
    }
    if (options.topP !== undefined) {
      params.top_p = options.topP;
    }
    if (options.frequencyPenalty !== undefined) {
      params.frequency_penalty = options.frequencyPenalty;
    }
    if (options.presencePenalty !== undefined) {
      params.presence_penalty = options.presencePenalty;
    }

    // Stop sequences
    if (options.stopSequences && options.stopSequences.length > 0) {
      params.stop = options.stopSequences;
    }

    // Seed for reproducibility
    if (options.seed !== undefined) {
      params.seed = options.seed;
    }

    // User identifier
    if (options.user) {
      params.user = options.user;
    }

    // Tools/function calling
    if (options.tools && options.tools.length > 0) {
      params.tools = mapTools(options.tools);
    }

    // Response format (JSON mode, structured output)
    if (options.responseFormat) {
      params.response_format = mapResponseFormat(options.responseFormat);
    }
  }

  return params;
}
