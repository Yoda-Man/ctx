/**
 * Chat Command
 *
 * Interactive multi-turn chat REPL with RAG-powered Q&A.
 * Maintains conversation history within a session and supports
 * REPL commands for project switching, indexing, history clearing, etc.
 *
 *   ctx chat                     # Start chat (uses most recent project)
 *   ctx chat --project my-app    # Start focused on specific project
 *
 * REPL Commands:
 *   /help      - Show available commands
 *   /index X   - Index directory X for RAG search
 *   /focus X   - Switch to project X
 *   /unfocus   - Clear project scope
 *   /projects  - List available projects
 *   /describe  - Add description/tags to project for smart routing
 *   /clear     - Clear conversation history
 *   exit       - Exit the chat
 */

import * as readline from 'node:readline';
import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync } from 'node:fs';
import type { CommandContext } from '../types.js';
import { ConversationContext } from '../../sdk/core/index.js';
import { getDb, runMigrations } from '../../database/index.js';
import { loadConfig } from '../../config/loader.js';
import { createRAGEngine, type ContextExpertRAGEngine } from '../../agent/rag-engine.js';
import { createLLMProvider } from '../../providers/llm.js';
import { CLIError } from '../../errors/index.js';
import { getBackgroundIndexingCoordinator } from '../utils/background-indexing.js';
import type { Project } from '../../database/schema.js';
import { completeDirectoryPath, contractTilde } from '../utils/path-completer.js';
import { getGitInfo } from '../utils/git-status.js';
import { completeFileNames } from '../utils/file-completer.js';
import {
  TUIController,
  AgentPhase,
} from '../tui/index.js';
import { ChatAgent } from '../../agent/chat-agent.js';
import { errorMessage } from '../../utils/error.js';
import { parseREPLCommand } from './chat-commands.js';
import { handleQuestionTUIWithAgent, handleQuestionWithAgent } from './chat-questions.js';
import {
  type ChatState,
  cleanupChatState,
  createRoutingEngine,
  findProject,
  getAllProjectNames,
  getPrompt,
  loadProjectMetadata,
} from './chat-state.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Command-specific options parsed from CLI arguments.
 */
interface ChatCommandOptions {
  /** Start focused on a specific project name */
  project?: string;
  /** TUI mode is enabled by default on TTY; --no-tui disables it */
  tui?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum tokens to retain in conversation context.
 * When exceeded, oldest messages are automatically removed by ConversationContext.
 */
const MAX_CONTEXT_TOKENS = 8000;

/**
 * Get the most recently updated project.
 */
function getMostRecentProject(): Project | undefined {
  runMigrations();
  const db = getDb();
  return db
    .prepare('SELECT * FROM projects ORDER BY updated_at DESC LIMIT 1')
    .get() as Project | undefined;
}

/**
 * Check if any projects exist in the database.
 * Used to differentiate "no projects indexed" from "projects exist but none valid".
 */
function hasAnyProjects(): boolean {
  runMigrations();
  const db = getDb();
  const result = db
    .prepare('SELECT COUNT(*) as count FROM projects')
    .get() as { count: number } | undefined;
  return (result?.count ?? 0) > 0;
}

// ============================================================================
// Session: welcome, completion and the TUI and REPL loops
// ============================================================================

/**
 * Display welcome message with current state.
 */
function displayWelcome(state: ChatState, ctx: CommandContext): void {
  ctx.log('');
  ctx.log(chalk.bold('Context Expert Chat'));
  ctx.log(chalk.dim(`Model: ${state.providerInfo.name}/${state.providerInfo.model}`));
  ctx.log('');

  if (state.currentProject) {
    ctx.log(chalk.blue(`Focused on: ${state.currentProject.name}`));
  } else {
    // Check if there are ANY projects in the database
    if (hasAnyProjects()) {
      // Projects exist but none are focused (maybe paths missing)
      ctx.log(chalk.dim('No project focused (pure LLM mode)'));
      ctx.log(chalk.dim('Use /focus <project> to enable RAG search'));
    } else {
      // No projects at all - show helpful onboarding message
      ctx.log(chalk.yellow('No projects indexed.'));
      ctx.log(chalk.dim('Use /index <path> to get started.'));
    }
  }

  ctx.log('');
  ctx.log(chalk.dim('Type /help for commands, "exit" to quit'));
  ctx.log('');
}

/**
 * Tab completion handler for REPL commands.
 *
 * Supports:
 * - /focus <TAB> → project names
 * - /index <TAB> → directory paths
 * - @<TAB> → file names from focused project
 *
 * @internal Exported for testing purposes
 * @param getProjectNames - Function to retrieve project names (injected for testability)
 * @param getCurrentProjectId - Function to get current project ID for @file completion
 * @returns Tuple of [completions, originalLine] as per Node.js readline spec
 */
export function createCompleter(
  getProjectNames: () => string[] = getAllProjectNames,
  getCurrentProjectId: () => string | null = () => null
): (line: string) => [string[], string] {
  return (line: string): [string[], string] => {
    // Check for /focus or /f command with at least one space after
    const focusMatch = line.match(/^\/(focus|f)\s+(.*)$/i);
    if (focusMatch) {
      const prefix = focusMatch[1] ?? 'focus'; // 'focus' or 'f'
      const partial = (focusMatch[2] ?? '').toLowerCase();
      const projectNames = getProjectNames();
      const matches = projectNames
        .filter((name) => name.toLowerCase().startsWith(partial))
        .map((name) => `/${prefix} ${name}`);
      return [matches, line];
    }

    // Check for /index command with at least one space after
    const indexMatch = line.match(/^\/(index)\s+(.*)$/i);
    if (indexMatch) {
      const partial = indexMatch[2] ?? '';

      // Don't complete if user is typing flags (-n, --force, etc.)
      if (partial.startsWith('-')) {
        return [[], line];
      }

      // Don't complete if partial is 'status' (subcommand)
      if (partial.toLowerCase() === 'status' || partial.toLowerCase().startsWith('status')) {
        return [['/index status'], line];
      }

      // Complete directory paths
      const matches = completeDirectoryPath(partial);
      return [matches.map((m) => `/index ${m}`), line];
    }

    // Check for @ file reference (anywhere in the line)
    // Match @partial at the end of the line or before a space
    const atMatch = line.match(/@([^\s@]*)$/);
    if (atMatch) {
      const projectId = getCurrentProjectId();
      if (projectId !== null) {
        const partial = atMatch[1] ?? '';
        const fileNames = completeFileNames(projectId, partial);

        // Replace the @partial with @filename in the completions
        const linePrefix = line.slice(0, line.length - atMatch[0].length);
        const matches = fileNames.map((name) => `${linePrefix}@${name}`);
        return [matches, line];
      }
      // No project focused - can't complete files
      return [[], line];
    }

    // No completion for other input
    return [[], line];
  };
}

/**
 * TUI-based chat REPL with fixed screen regions.
 *
 * Uses TUIController to manage:
 * - Scrollable chat area (messages)
 * - Fixed status bar (mode, context gauge, turns)
 * - Fixed input area (readline with tab completion)
 *
 * Reuses all existing REPL command handlers and question logic.
 */
async function runChatTUI(
  state: ChatState,
  ctx: CommandContext
): Promise<void> {
  return new Promise((resolve) => {
    // Create completer with state-aware project ID getter for @file completion
    const completer = createCompleter(
      getAllProjectNames,
      () => (state.currentProject ? state.currentProject.id : null)
    );

    // Create TUI controller
    // Note: omit contextWindowSize to use default 200k (actual model context window),
    // not MAX_CONTEXT_TOKENS which is the conversation sliding window limit (8k).
    const projectDir = state.currentProject?.path ?? process.cwd();
    const gitInfo = getGitInfo(projectDir);
    const tui = new TUIController({
      model: {
        name: state.providerInfo.model,
        provider: state.providerInfo.name,
      },
      project: state.currentProject?.name ?? null,
      workingDirectory: contractTilde(projectDir),
      gitBranch: gitInfo.branch,
      gitDirty: gitInfo.dirty,
      enableMarkdown: true,
    });

    // Store in state so command handlers can detect TUI mode
    state.tui = tui;

    // Create TUI-aware context that routes output through the scroll region.
    // Without this, ctx.log() → console.log() bypasses ANSI scroll regions,
    // causing REPL command output (/help, /projects, etc.) to be invisible.
    const tuiCtx: CommandContext = {
      ...ctx,
      log: (message: string) => {
        if (!ctx.options.json) {
          tui.addInfoMessage(message);
        }
      },
      warn: (message: string) => {
        if (!ctx.options.json) {
          tui.addInfoMessage(chalk.yellow(`Warning: ${message}`));
        }
      },
      error: (message: string) => {
        if (ctx.options.json) {
          console.error(JSON.stringify({ error: message }));
        } else {
          tui.addInfoMessage(chalk.red(`Error: ${message}`));
        }
      },
    };

    // Track if we've already cleaned up to prevent double-cleanup
    let cleanedUp = false;
    const cleanup = () => {
      if (!cleanedUp) {
        cleanedUp = true;
        cleanupChatState(state);
        tui.shutdown();
      }
    };

    // Handle user input
    tui.onLine(async (line: string) => {
      const input = line.trim();

      // Skip empty input
      if (!input) {
        tui.prompt();
        return;
      }

      // Check for REPL commands
      const replCmd = parseREPLCommand(input);
      if (replCmd) {
        try {
          const shouldContinue = await replCmd.command.handler(
            replCmd.args,
            state,
            tuiCtx
          );
          if (!shouldContinue) {
            cleanup();
            resolve();
            return;
          }
          // Update TUI project and status bar if project changed
          tui.setProject(state.currentProject?.name ?? null);
          const newDir = state.currentProject?.path ?? process.cwd();
          tui.setWorkingDirectory(contractTilde(newDir));
          const newGit = getGitInfo(newDir);
          tui.setGitStatus(newGit.branch, newGit.dirty);
        } catch (error) {
          tuiCtx.error(`Command failed: ${errorMessage(error)}`);
        }
        tui.prompt();
        return;
      }

      // Handle as question - show user message in chat area
      tui.addUserMessage(input);

      try {
        // Set status to thinking
        tui.setActivity(AgentPhase.THINKING, undefined, 'Thinking...');

        await handleQuestionTUIWithAgent(input, state, tuiCtx, tui);
      } catch (error) {
        if (error instanceof CLIError) {
          tuiCtx.error(error.message);
          if (error.hint) {
            tuiCtx.log(chalk.dim(error.hint));
          }
        } else {
          tuiCtx.error(`Failed to process question: ${errorMessage(error)}`);
        }
      }

      // Count the exchange and return to idle
      tui.incrementTurns();
      tui.setActivity(AgentPhase.IDLE);
      tui.prompt();
    });

    // Handle Ctrl+C — 3-tier cancellation (mirrors REPL SIGINT)
    tui.onSIGINT(() => {
      // Tier 1: Cancel in-flight agent work
      if (state.agentAbortController) {
        state.agentAbortController.abort();
        state.agentAbortController = undefined;
        tui.prompt();
        return;
      }

      // Tier 2: Cancel background indexing
      const coordinator = getBackgroundIndexingCoordinator();
      if (coordinator.isRunning()) {
        coordinator.cancel();
        tuiCtx.log(chalk.yellow('Indexing cancelled.'));
        tui.prompt();
        return;
      }

      // Tier 3: Exit chat
      tuiCtx.log(chalk.dim('Goodbye!'));
      cleanup();
      resolve();
    });

    // Handle close
    tui.onClose(() => {
      cleanup();
      resolve();
    });

    // Start TUI with completer and prompt
    tui.start(completer, getPrompt(state));
  });
}

/**
 * Main REPL loop using readline.
 *
 * Uses event-based pattern (rl.on('line', ...)) instead of async iterator
 * (for await) for robustness. The async iterator pattern can exit prematurely
 * when combined with other async operations like streaming LLM responses.
 */
async function runChatREPL(
  state: ChatState,
  ctx: CommandContext
): Promise<void> {
  return new Promise((resolve) => {
    // Create completer with state-aware project ID getter for @file completion
    const completer = createCompleter(
      getAllProjectNames,
      () => (state.currentProject ? state.currentProject.id : null)
    );

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: getPrompt(state),
      completer,
    });

    // Store rl in state so handlers can update prompt
    state.rl = rl;

    // Track if we've already cleaned up to prevent double-cleanup
    let cleanedUp = false;
    const cleanup = () => {
      if (!cleanedUp) {
        cleanedUp = true;
        cleanupChatState(state);
      }
    };

    // ─────────────────────────────────────────────────────────────────────
    // Register all event handlers BEFORE calling prompt()
    // This ensures no input is lost to unregistered handlers
    // ─────────────────────────────────────────────────────────────────────

    // Lines are handled one at a time: readline doesn't wait for an async
    // handler, so piped input ran `/exit` while a question was still running,
    // and a second question typed during an answer ran alongside it.
    let queue = Promise.resolve();
    const prompt = () => state.rl?.prompt(); // state.rl is cleared once input closes
    rl.on('line', (line) => {
      queue = queue.then(() => handleLine(line));
    });

    const handleLine = async (line: string): Promise<void> => {
      const input = line.trim();

      // Skip empty input
      if (!input) {
        prompt();
        return;
      }

      // Check for REPL commands
      const replCmd = parseREPLCommand(input);
      if (replCmd) {
        try {
          const shouldContinue = await replCmd.command.handler(
            replCmd.args,
            state,
            ctx
          );
          if (!shouldContinue) {
            cleanup();
            rl.close();
            resolve();
            return;
          }
        } catch (error) {
          ctx.error(`Command failed: ${errorMessage(error)}`);
        }
        prompt();
        return;
      }

      // Handle as question
      try {
        await handleQuestionWithAgent(input, state, ctx);
      } catch (error) {
        if (error instanceof CLIError) {
          ctx.error(error.message);
          if (error.hint) {
            ctx.log(chalk.dim(error.hint));
          }
        } else {
          ctx.error(`Failed to process question: ${errorMessage(error)}`);
        }
      }

      prompt();
    };

    // Handle Ctrl+C gracefully — 3-tier cancellation:
    // 1. If agent is processing → cancel agent, return to prompt
    // 2. If background indexing is running → cancel indexing
    // 3. Nothing running → exit chat
    rl.on('SIGINT', () => {
      // Tier 1: Cancel in-flight agent work
      if (state.agentAbortController) {
        state.agentAbortController.abort();
        state.agentAbortController = undefined;
        process.stdout.write('\n');
        rl.prompt();
        return;
      }

      const coordinator = getBackgroundIndexingCoordinator();

      // Tier 2: Cancel background indexing
      if (coordinator.isRunning()) {
        coordinator.cancel();
        ctx.log('');
        ctx.log(chalk.yellow('Indexing cancelled.'));
        rl.prompt();
        return;
      }

      // No indexing running - exit chat
      ctx.log('');
      ctx.log(chalk.dim('Goodbye!'));
      cleanup();
      rl.close();
      resolve();
    });

    // Handle stream close (EOF, pipe closed, etc.): finish the lines already
    // read, then clean up
    rl.on('close', () => {
      state.rl = undefined;
      void queue.then(() => {
        cleanup();
        resolve();
      });
    });

    // All handlers registered - now safe to start accepting input
    displayWelcome(state, ctx);
    rl.prompt();
  });
}

// ============================================================================
// Command Factory
// ============================================================================

/**
 * Create the chat command.
 *
 * @param getContext - Factory to get command context with global options
 * @returns Configured Commander command
 */
export function createChatCommand(getContext: () => CommandContext): Command {
  return new Command('chat')
    .description('Interactive multi-turn chat with RAG-powered Q&A')
    .option('-p, --project <name>', 'Start focused on a specific project')
    .option('--no-tui', 'Disable TUI mode (status bar, scroll regions) and use classic readline REPL')
    .action(async (cmdOptions: ChatCommandOptions) => {
      const ctx = getContext();

      ctx.debug('Starting chat session...');

      // ─────────────────────────────────────────────────────────────────────
      // 1. Load config
      // ─────────────────────────────────────────────────────────────────────
      const config = loadConfig();
      ctx.debug(`LLM: ${config.default_model ?? 'default'}`);

      // ─────────────────────────────────────────────────────────────────────
      // 2. Resolve initial project (optional)
      // ─────────────────────────────────────────────────────────────────────
      let currentProject: Project | null = null;
      let ragEngine: ContextExpertRAGEngine | null = null;

      if (cmdOptions.project) {
        const project = findProject(cmdOptions.project);
        if (!project) {
          throw new CLIError(
            `Project not found: ${cmdOptions.project}`,
            'Run: ctx list  to see available projects'
          );
        }
        currentProject = project;
        ctx.debug(`Initial project: ${project.name}`);

        // Create RAG engine for the project
        ragEngine = await createRAGEngine(config, String(project.id));
      } else {
        // Try to use the most recent project as default
        const recent = getMostRecentProject();
        if (recent) {
          // Validate that the project path still exists on disk
          if (!existsSync(recent.path)) {
            // Path no longer exists - don't auto-focus on stale project
            ctx.debug(`Skipping stale project: ${recent.name} (path missing: ${recent.path})`);
          } else {
            currentProject = recent;
            ragEngine = await createRAGEngine(config, String(recent.id));
            ctx.debug(`Using most recent project: ${recent.name}`);
          }
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // 3. Create LLM provider (cached for session)
      // ─────────────────────────────────────────────────────────────────────
      ctx.debug('Creating LLM provider...');

      const { provider, name: providerName, model } = await createLLMProvider(config);

      ctx.debug(`Using: ${providerName}/${model}`);

      // ─────────────────────────────────────────────────────────────────────
      // 4. Initialize conversation context (from @contextaisdk/core)
      // ─────────────────────────────────────────────────────────────────────
      const conversationContext = new ConversationContext({
        maxTokens: MAX_CONTEXT_TOKENS,
      });

      // ─────────────────────────────────────────────────────────────────────
      // 5. Create the search engine (once a project exists) and the agent
      // ─────────────────────────────────────────────────────────────────────
      const allProjects = loadProjectMetadata();
      const routingEngine = allProjects.length > 0
        ? await createRoutingEngine(config, provider, ctx)
        : null;

      const chatAgent = new ChatAgent({
        llmProvider: provider,
        routingEngine,
        allProjects,
        currentProject,
        maxContextTokens: MAX_CONTEXT_TOKENS,
        maxIterations: 5,
      });

      const state: ChatState = {
        currentProject,
        conversationContext,
        ragEngine,
        llmProvider: provider,
        providerInfo: { name: providerName, model },
        config,
        allProjects,
        routingEngine,
        chatAgent,
      };

      // TUI is default on TTY; --no-tui falls back to classic readline REPL
      const useTUI = cmdOptions.tui !== false && process.stdout.isTTY;

      if (useTUI) {
        ctx.debug('Starting TUI mode...');
        await runChatTUI(state, ctx);
      } else {
        if (cmdOptions.tui === false) {
          ctx.debug('TUI disabled via --no-tui flag');
        } else {
          ctx.debug('TUI not available (not a TTY), using classic REPL');
        }
        await runChatREPL(state, ctx);
      }
    });
}
