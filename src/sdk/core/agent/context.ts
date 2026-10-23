import type { ChatMessage } from '../provider/types';

/**
 * Token counter function type
 * Can be provided by LLM provider or custom implementation
 */
export type TokenCounter = (messages: ChatMessage[]) => Promise<number>;

/**
 * Configuration for ConversationContext
 */
export interface ConversationContextConfig {
  /** Maximum tokens to retain in context (triggers truncation) */
  maxTokens?: number;
  /** Initial messages to populate context */
  initialMessages?: ChatMessage[];
  /** Custom token counter (defaults to estimation) */
  tokenCounter?: TokenCounter;
}

/**
 * Default token estimator: ~4 characters per token (rough approximation)
 * Used when no LLM provider tokenizer is available
 */
const estimateTokens = async (messages: ChatMessage[]): Promise<number> => {
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length;
    } else {
      // For content arrays, sum up text parts
      for (const part of msg.content) {
        if (part.type === 'text') {
          totalChars += part.text.length;
        }
      }
    }
    // Add overhead for role and structure (~10 tokens per message)
    totalChars += 40;
  }
  return Math.ceil(totalChars / 4);
};

/**
 * ConversationContext - Manages message history for multi-turn conversations
 *
 * Provides a sliding window over conversation history, automatically
 * truncating old messages when token limits are exceeded.
 *
 * @example
 * ```typescript
 * const context = new ConversationContext({ maxTokens: 4000 });
 * context.addMessage({ role: 'user', content: 'Hello' });
 * context.addMessage({ role: 'assistant', content: 'Hi there!' });
 *
 * // Get all messages for next LLM call
 * const messages = context.getMessages();
 * ```
 */
export class ConversationContext {
  private messages: ChatMessage[] = [];
  private readonly maxTokens: number | undefined;
  private readonly tokenCounter: TokenCounter;

  constructor(config: ConversationContextConfig = {}) {
    this.maxTokens = config.maxTokens;
    this.tokenCounter = config.tokenCounter ?? estimateTokens;

    if (config.initialMessages) {
      this.messages = [...config.initialMessages];
    }
  }

  /**
   * Add a message to the conversation history
   */
  addMessage = (message: ChatMessage): void => {
    this.messages.push(message);
  };

  /**
   * Add multiple messages to the conversation history
   */
  addMessages = (messages: ChatMessage[]): void => {
    this.messages.push(...messages);
  };

  /**
   * Get all messages in the conversation
   */
  getMessages = (): ChatMessage[] => {
    return [...this.messages];
  };

  /**
   * Get the number of messages in context
   */
  get length(): number {
    return this.messages.length;
  }

  /**
   * Clear all messages from context
   */
  clear = (): void => {
    this.messages = [];
  };

  /**
   * Count tokens in current context
   */
  countTokens = async (): Promise<number> => {
    return this.tokenCounter(this.messages);
  };

  /**
   * Truncate old messages to fit within maxTokens
   * Preserves system message (index 0) and removes oldest user/assistant pairs
   *
   * @returns Number of messages removed
   */
  truncate = async (): Promise<number> => {
    if (!this.maxTokens) {
      return 0;
    }

    let removed = 0;
    let currentTokens = await this.countTokens();

    // Keep removing oldest non-system messages until under limit
    while (currentTokens > this.maxTokens && this.messages.length > 1) {
      // Find first non-system message to remove
      const indexToRemove = this.messages.findIndex(
        (msg) => msg.role !== 'system'
      );

      if (indexToRemove === -1) {
        break; // Only system messages left
      }

      this.messages.splice(indexToRemove, 1);
      removed++;
      currentTokens = await this.countTokens();
    }

    return removed;
  };

  /**
   * Create a snapshot of the current context for serialization
   */
  toJSON = (): { messages: ChatMessage[]; maxTokens?: number } => {
    return {
      messages: this.getMessages(),
      maxTokens: this.maxTokens,
    };
  };

  /**
   * Create a ConversationContext from a serialized snapshot
   */
  static fromJSON = (
    data: { messages: ChatMessage[]; maxTokens?: number },
    tokenCounter?: TokenCounter
  ): ConversationContext => {
    return new ConversationContext({
      initialMessages: data.messages,
      maxTokens: data.maxTokens,
      tokenCounter,
    });
  };
}
