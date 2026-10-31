/**
 * Answering a question in `ctx chat` with the ReAct agent, in REPL and TUI mode.
 */

import chalk from 'chalk';
import type { CommandContext } from '../types.js';
import { getDatabase } from '../../database/index.js';
import { formatCitations } from '../../agent/citations.js';
import {
  parseFileReferences,
  stripFileReferences,
  resolveFileReferences,
  formatReferencesAsContext,
  getReferenceSummary,
} from '../../search/file-reference.js';
import { TUIController } from '../tui/index.js';
import {
  renderAgentEventsREPL,
  adaptAgentEventsForTUI,
} from '../utils/agent-event-renderer.js';
import { shouldRecord } from '../../observability/index.js';
import { errorMessage } from '../../utils/error.js';
import type { ChatState } from './chat-state.js';

// ============================================================================
// Agent-Based Question Handlers
// ============================================================================

/**
 * Handle a user question via the ReAct ChatAgent (REPL mode).
 *
 * The agent autonomously decides whether to search the knowledge base.
 * Streams the response token-by-token with tool activity indicators.
 */
export async function handleQuestionWithAgent(
  question: string,
  state: ChatState,
  ctx: CommandContext
): Promise<void> {
  // Handle @file references (pre-processing, not an agent tool)
  let fileReferenceContext = '';
  const filePatterns = parseFileReferences(question);

  if (filePatterns.length > 0 && state.currentProject) {
    const resolvedReferences = resolveFileReferences(state.currentProject.id, filePatterns);
    fileReferenceContext = formatReferencesAsContext(resolvedReferences);
    const summary = getReferenceSummary(resolvedReferences);
    const hasMatches = resolvedReferences.some((r) => r.matches.length > 0);

    if (hasMatches) {
      ctx.log(chalk.cyan('Using: ') + chalk.dim(summary));
    } else {
      ctx.log(chalk.yellow('No files found matching: ') + filePatterns.join(', '));
    }
    question = stripFileReferences(question);
  } else if (filePatterns.length > 0 && !state.currentProject) {
    ctx.log(
      chalk.yellow('@file references require a focused project. Use /focus <project> first.')
    );
  }

  // Stream agent events to REPL (with abort signal for Ctrl+C)
  state.agentAbortController = new AbortController();
  const turnStart = performance.now();
  ctx.log('');
  try {
    const events = state.chatAgent.streamQuestion(question, {
      fileReferenceContext: fileReferenceContext || undefined,
      signal: state.agentAbortController.signal,
    });
    const { content, sources } = await renderAgentEventsREPL(events, ctx);

    ctx.log('');

    // Update the legacy conversation context too (for /share export compatibility)
    if (content) {
      state.conversationContext.addMessage({ role: 'user', content: question });
      state.conversationContext.addMessage({ role: 'assistant', content });
      await state.conversationContext.truncate();
    }

    // Always-on local trace recording for chat turn (fire-and-forget, respects sample_rate)
    if (state.currentProject && shouldRecord(state.config.observability)) {
      try {
        const dbOps = getDatabase();
        dbOps.insertTrace({
          project_id: String(state.currentProject.id),
          query: question,
          retrieved_files: sources.map((s) => s.filePath),
          top_k: 0,
          latency_ms: Math.round(performance.now() - turnStart),
          answer: content || undefined,
          retrieval_method: 'fusion',
          trace_type: 'chat',
          metadata: { mode: 'chat-repl' },
        });
      } catch (err) {
        ctx.debug(`Trace recording failed: ${errorMessage(err)}`);
      }
    }
  } finally {
    state.agentAbortController = undefined;
  }
}

/**
 * Handle a user question via the ReAct ChatAgent (TUI mode).
 *
 * Same as REPL version but routes events through the TUI adapter
 * for status bar phase management and scrollable chat area.
 */
export async function handleQuestionTUIWithAgent(
  question: string,
  state: ChatState,
  ctx: CommandContext,
  tui: TUIController
): Promise<void> {
  // Handle @file references
  let fileReferenceContext = '';
  const filePatterns = parseFileReferences(question);

  if (filePatterns.length > 0 && state.currentProject) {
    const resolvedReferences = resolveFileReferences(state.currentProject.id, filePatterns);
    fileReferenceContext = formatReferencesAsContext(resolvedReferences);
    const summary = getReferenceSummary(resolvedReferences);
    const hasMatches = resolvedReferences.some((r) => r.matches.length > 0);

    if (hasMatches) {
      tui.addInfoMessage(chalk.cyan('Using: ') + chalk.dim(summary));
    } else {
      tui.addInfoMessage(chalk.yellow('No files found matching: ') + filePatterns.join(', '));
    }
    question = stripFileReferences(question);
  } else if (filePatterns.length > 0 && !state.currentProject) {
    tui.addInfoMessage(
      chalk.yellow('@file references require a focused project. Use /focus <project> first.')
    );
  }

  // Stream agent events through TUI adapter (with abort signal for Ctrl+C)
  state.agentAbortController = new AbortController();
  const turnStart = performance.now();
  const events = state.chatAgent.streamQuestion(question, {
    fileReferenceContext: fileReferenceContext || undefined,
    signal: state.agentAbortController.signal,
  });
  const { stream: tuiStream, getSources } = adaptAgentEventsForTUI(events, tui);

  try {
    const responseContent = await tui.streamResponse(tuiStream);
    state.agentAbortController = undefined;

    // Show citations if we have sources (same as legacy TUI path)
    const sources = getSources();
    if (sources.length > 0) {
      tui.addInfoMessage(formatCitations(sources));
    }

    // Update legacy conversation context for /share compatibility
    if (responseContent) {
      state.conversationContext.addMessage({ role: 'user', content: question });
      state.conversationContext.addMessage({ role: 'assistant', content: responseContent });
      await state.conversationContext.truncate();
    }

    // Always-on local trace recording for chat turn (fire-and-forget, respects sample_rate)
    if (state.currentProject && shouldRecord(state.config.observability)) {
      try {
        const dbOps = getDatabase();
        dbOps.insertTrace({
          project_id: String(state.currentProject.id),
          query: question,
          retrieved_files: sources.map((s) => s.filePath),
          top_k: 0,
          latency_ms: Math.round(performance.now() - turnStart),
          answer: responseContent || undefined,
          retrieval_method: 'fusion',
          trace_type: 'chat',
          metadata: { mode: 'chat-tui' },
        });
      } catch (err) {
        ctx.debug(`Trace recording failed: ${errorMessage(err)}`);
      }
    }
  } catch (error) {
    state.agentAbortController = undefined;
    tui.addInfoMessage(
      chalk.red(`Response failed: ${errorMessage(error)}`)
    );
  }
}
