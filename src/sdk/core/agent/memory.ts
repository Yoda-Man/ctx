import type { ChatMessage } from '../provider/types';

/**
 * MemoryProvider interface for conversation persistence
 *
 * Implement this interface to store conversation history in any backend:
 * - File system
 * - Redis/Memcached
 * - PostgreSQL/MongoDB
 * - Vector databases (for semantic retrieval)
 *
 * @example
 * ```typescript
 * class RedisMemoryProvider implements MemoryProvider {
 *   constructor(private redis: RedisClient) {}
 *
 *   async save(sessionId: string, messages: ChatMessage[]) {
 *     await this.redis.set(`chat:${sessionId}`, JSON.stringify(messages));
 *   }
 *
 *   async load(sessionId: string) {
 *     const data = await this.redis.get(`chat:${sessionId}`);
 *     return data ? JSON.parse(data) : [];
 *   }
 *
 *   async clear(sessionId: string) {
 *     await this.redis.del(`chat:${sessionId}`);
 *   }
 * }
 * ```
 */
export interface MemoryProvider {
  /**
   * Save messages for a session
   * Called after each agent interaction
   *
   * @param sessionId - Unique identifier for the conversation
   * @param messages - All messages in the conversation (provider decides what to persist)
   */
  save(sessionId: string, messages: ChatMessage[]): Promise<void>;

  /**
   * Load messages for a session
   * Called when resuming a conversation
   *
   * @param sessionId - Unique identifier for the conversation
   * @returns Array of messages, empty array if session not found
   */
  load(sessionId: string): Promise<ChatMessage[]>;

  /**
   * Clear all messages for a session
   * Called when conversation should be reset
   *
   * @param sessionId - Unique identifier for the conversation
   */
  clear(sessionId: string): Promise<void>;
}

/**
 * InMemoryProvider - Default memory provider using in-process storage
 *
 * Stores conversations in a Map. Data is lost when process restarts.
 * Suitable for development, testing, and short-lived conversations.
 *
 * @example
 * ```typescript
 * const memory = new InMemoryProvider();
 * const agent = new Agent({
 *   // ...
 *   memory,
 *   sessionId: 'user-123',
 * });
 * ```
 */
export class InMemoryProvider implements MemoryProvider {
  private storage: Map<string, ChatMessage[]> = new Map();

  /**
   * Save messages to in-memory storage
   * Creates a defensive copy to prevent external mutation
   */
  save = async (sessionId: string, messages: ChatMessage[]): Promise<void> => {
    // Defensive copy - don't store reference to external array
    this.storage.set(sessionId, [...messages]);
  };

  /**
   * Load messages from in-memory storage
   * Returns a defensive copy to prevent external mutation
   */
  load = async (sessionId: string): Promise<ChatMessage[]> => {
    const messages = this.storage.get(sessionId);
    // Return copy to prevent external mutation of stored data
    return messages ? [...messages] : [];
  };

  /**
   * Clear messages for a session
   */
  clear = async (sessionId: string): Promise<void> => {
    this.storage.delete(sessionId);
  };

  /**
   * Check if a session exists (utility method, not part of interface)
   */
  has = (sessionId: string): boolean => {
    return this.storage.has(sessionId);
  };

  /**
   * Get all session IDs (utility method for debugging)
   */
  getSessions = (): string[] => {
    return Array.from(this.storage.keys());
  };

  /**
   * Clear all sessions (utility method for testing)
   */
  clearAll = (): void => {
    this.storage.clear();
  };
}
