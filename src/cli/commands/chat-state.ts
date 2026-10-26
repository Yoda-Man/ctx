/**
 * State shared by `ctx chat`'s commands, question handlers and runners,
 * and the project lookups they have in common.
 */

import type * as readline from 'node:readline';
import chalk from 'chalk';
import type { ConversationContext, LLMProvider } from '../../sdk/core/index.js';
import { getDb, runMigrations } from '../../database/index.js';
import type { Config } from '../../config/loader.js';
import type { ContextExpertRAGEngine } from '../../agent/rag-engine.js';
import type { ProjectMetadata } from '../../agent/query-router.js';
import { createRoutingRAGEngine, type RoutingRAGEngine } from '../../agent/routing-rag-engine.js';
import { createEmbeddingProvider } from '../../indexer/index.js';
import type { Project } from '../../database/schema.js';
import type { TUIController } from '../tui/index.js';
import type { ChatAgent } from '../../agent/chat-agent.js';
import type { CommandContext } from '../types.js';
import { errorMessage } from '../../utils/error.js';

/**
 * Mutable state for the chat REPL session.
 * Persists across user inputs within a single session.
 */
export interface ChatState {
  /** Currently focused project (null = no RAG, pure LLM mode) */
  currentProject: Project | null;
  /** Conversation history with automatic truncation (from @contextaisdk/core) */
  conversationContext: ConversationContext;
  /**
   * RAG engine for current project (null if unfocused).
   * @deprecated Use routingEngine instead. Kept for backward compatibility
   * with /focus command and cases where routing is not available.
   */
  ragEngine: ContextExpertRAGEngine | null;
  /** LLM provider (cached for session) */
  llmProvider: LLMProvider;
  /** Provider metadata for display */
  providerInfo: { name: string; model: string };
  /** Loaded config (cached) */
  config: Config;
  /** Readline interface for prompt updates (set after REPL starts) */
  rl?: readline.Interface;
  /** All indexed projects (cached for routing) */
  allProjects: ProjectMetadata[];
  /**
   * Unified routing + RAG engine (new in ticket #88).
   * Handles both single-project and multi-project search with automatic routing.
   * When available, this is the preferred way to search.
   */
  routingEngine?: RoutingRAGEngine | null;
  /** TUI controller when in TUI mode (null/undefined for classic REPL) */
  tui?: TUIController;
  /** ReAct chat agent that answers questions */
  chatAgent: ChatAgent;
  /** AbortController for cancelling in-flight agent work (Ctrl+C support) */
  agentAbortController?: AbortController;
}

/**
 * Clean up resources held by the chat state.
 *
 * Call on all exit paths to prevent memory leaks:
 * - SIGINT (Ctrl+C)
 * - exit/quit command
 * - Normal REPL loop exit
 *
 * Releases:
 * - RAG engine (which clears vector store and BM25 caches)
 * - Conversation context
 */
export function cleanupChatState(state: ChatState): void {
  // Dispose routing engine (clears all cached single-project engines)
  if (state.routingEngine) {
    state.routingEngine.dispose();
    state.routingEngine = null;
  }

  // Dispose legacy RAG engine (for backward compatibility)
  if (state.ragEngine) {
    state.ragEngine.dispose();
    state.ragEngine = null;
  }

  // Clear conversation context
  state.conversationContext.clear();
}

/**
 * The engine the agent searches with: routing across projects plus RAG.
 * Null when the embedding model can't load; the agent then can't search.
 */
export async function createRoutingEngine(
  config: Config,
  llmProvider: LLMProvider,
  ctx: CommandContext
): Promise<RoutingRAGEngine | null> {
  ctx.debug('Creating RoutingRAGEngine...');
  try {
    const { provider: embeddingProvider, dimensions } = await createEmbeddingProvider(
      config.embedding,
      { onProgress: (p) => ctx.debug(`Embedding init: ${p.status}`) }
    );
    return createRoutingRAGEngine({
      config,
      embeddingProvider,
      dimensions,
      forceRAG: true, // Always search when projects exist
      llmProvider, // LLM-based routing for GENERAL queries
    });
  } catch (error) {
    ctx.debug(`Failed to create RoutingRAGEngine: ${errorMessage(error)}`);
    return null;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate the REPL prompt based on current focus state.
 * Shows [project-name]> when focused, just > when unfocused.
 */
export function getPrompt(state: ChatState): string {
  return state.currentProject
    ? chalk.green(`[${state.currentProject.name}]> `)
    : chalk.green('> ');
}

/**
 * Get all project names for tab completion.
 */
export function getAllProjectNames(): string[] {
  try {
    runMigrations();
    const db = getDb();
    const projects = db
      .prepare('SELECT name FROM projects ORDER BY name')
      .all() as Array<{ name: string }>;
    return projects.map((p) => p.name);
  } catch {
    return [];
  }
}

/**
 * Update the readline prompt to reflect current state.
 */
export function updatePrompt(state: ChatState): void {
  if (state.rl) {
    state.rl.setPrompt(getPrompt(state));
  }
}

/** Every project, as the query router and the agent need it. */
export function loadProjectMetadata(): ProjectMetadata[] {
  const rows = getDb()
    .prepare('SELECT id, name, description, tags, file_count, chunk_count FROM projects')
    .all() as Array<{
      id: string;
      name: string;
      description: string | null;
      tags: string | null;
      file_count: number;
      chunk_count: number;
    }>;
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    tags: safeParseJsonArray(p.tags),
    fileCount: p.file_count,
    chunkCount: p.chunk_count,
  }));
}

/**
 * Safely parse a JSON array from database, returning empty array on error.
 * Handles null, undefined, and malformed JSON gracefully.
 */
export function safeParseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Find a project by name (case-insensitive).
 */
export function findProject(name: string): Project | undefined {
  runMigrations();
  const db = getDb();
  return db
    .prepare('SELECT * FROM projects WHERE LOWER(name) = LOWER(?)')
    .get(name) as Project | undefined;
}
