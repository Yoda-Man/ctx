/**
 * Message Mapper for Ollama
 *
 * Maps ContextAI's ChatMessage format to Ollama's message format.
 *
 * KEY DIFFERENCES FROM CLOUD PROVIDERS:
 * - Ollama uses OpenAI-compatible format (simpler!)
 * - System messages CAN be in the messages array
 * - Images are passed as base64 strings in the `images` array
 * - Tool calls use the same format as OpenAI
 */

import type {
  ChatMessage,
  GenerateOptions,
  ToolDefinition,
} from '../core/index.js';
import { isImageContent, isTextContent } from '../core/index.js';
import type {
  OllamaMessage,
  OllamaTool,
  OllamaChatRequest,
  OllamaModelOptions,
} from './types.js';

// ============================================================================
// Message Mapping
// ============================================================================

/**
 * Maps ContextAI ChatMessage array to Ollama message array.
 */
export function mapMessages(messages: ChatMessage[]): OllamaMessage[] {
  return messages.map(mapMessage);
}

/**
 * Maps a single ChatMessage to Ollama message format.
 *
 * Handles:
 * - System, user, assistant messages
 * - Tool result messages
 * - Multimodal content (images)
 */
export function mapMessage(message: ChatMessage): OllamaMessage {
  const content = message.content;

  // Extract text content
  let textContent: string;
  let images: string[] | undefined;

  if (typeof content === 'string') {
    textContent = content;
  } else if (Array.isArray(content)) {
    // Handle multimodal content
    const textParts: string[] = [];
    const imageParts: string[] = [];

    for (const part of content) {
      if (isTextContent(part)) {
        textParts.push(part.text);
      } else if (isImageContent(part)) {
        // Ollama expects base64 images without data URL prefix
        if (part.base64) {
          // Remove data URL prefix if present
          const base64Data = part.base64.replace(
            /^data:image\/[a-z]+;base64,/,
            ''
          );
          imageParts.push(base64Data);
        }
      }
    }

    textContent = textParts.join('\n');
    images = imageParts.length > 0 ? imageParts : undefined;
  } else {
    textContent = String(content);
  }

  // Build base message
  const ollamaMessage: OllamaMessage = {
    role: message.role,
    content: textContent,
  };

  // Add images if present (for multimodal models like LLaVA)
  if (images) {
    ollamaMessage.images = images;
  }

  // Add tool_call_id for tool result messages
  if (message.role === 'tool' && message.toolCallId) {
    ollamaMessage.tool_call_id = message.toolCallId;
  }

  return ollamaMessage;
}

// ============================================================================
// Tool Mapping
// ============================================================================

/**
 * Maps ContextAI ToolDefinition array to Ollama tool format.
 *
 * Ollama uses OpenAI-compatible tool format:
 * { type: 'function', function: { name, description, parameters } }
 */
export function mapTools(tools: ToolDefinition[]): OllamaTool[] {
  return tools.map(mapTool);
}

/**
 * Maps a single tool definition to Ollama format.
 */
function mapTool(tool: ToolDefinition): OllamaTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

// ============================================================================
// Options Mapping
// ============================================================================

/**
 * Maps ContextAI GenerateOptions to Ollama model options.
 *
 * Note: Ollama uses different parameter names than OpenAI in some cases.
 */
export function mapOptions(options?: GenerateOptions): OllamaModelOptions {
  if (!options) {
    return {};
  }

  const ollamaOptions: OllamaModelOptions = {};

  if (options.temperature !== undefined) {
    ollamaOptions.temperature = options.temperature;
  }

  if (options.topP !== undefined) {
    ollamaOptions.top_p = options.topP;
  }

  if (options.topK !== undefined) {
    ollamaOptions.top_k = options.topK;
  }

  if (options.frequencyPenalty !== undefined) {
    ollamaOptions.frequency_penalty = options.frequencyPenalty;
  }

  if (options.presencePenalty !== undefined) {
    ollamaOptions.presence_penalty = options.presencePenalty;
  }

  if (options.stopSequences?.length) {
    ollamaOptions.stop = options.stopSequences;
  }

  if (options.maxTokens !== undefined) {
    // Ollama uses num_predict instead of max_tokens
    ollamaOptions.num_predict = options.maxTokens;
  }

  if (options.seed !== undefined) {
    ollamaOptions.seed = options.seed;
  }

  return ollamaOptions;
}

// ============================================================================
// Request Building
// ============================================================================

/**
 * Builds complete Ollama API request body.
 *
 * Combines:
 * - Model selection
 * - Mapped messages
 * - Model options (temperature, etc.)
 * - Tools (if any)
 * - Response format (if JSON mode)
 */
export function buildRequestBody(
  model: string,
  messages: ChatMessage[],
  options?: GenerateOptions,
  extra?: {
    stream?: boolean;
    keepAlive?: string;
  }
): OllamaChatRequest {
  const request: OllamaChatRequest = {
    model,
    messages: mapMessages(messages),
    stream: extra?.stream ?? false,
  };

  // Add model options if any are set
  const modelOptions = mapOptions(options);
  if (Object.keys(modelOptions).length > 0) {
    request.options = modelOptions;
  }

  // Add tools if provided
  if (options?.tools?.length) {
    request.tools = mapTools(options.tools);
  }

  // Handle response format
  if (options?.responseFormat) {
    if (options.responseFormat.type === 'json_object') {
      request.format = 'json';
    } else if (
      options.responseFormat.type === 'json_schema' &&
      options.responseFormat.jsonSchema?.schema
    ) {
      // Ollama supports JSON schema directly
      request.format = options.responseFormat.jsonSchema.schema;
    }
  }

  // Add keep_alive if specified
  if (extra?.keepAlive) {
    request.keep_alive = extra.keepAlive;
  }

  return request;
}
