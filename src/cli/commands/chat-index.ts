/**
 * `/index` in `ctx chat`: index a folder (in the background in REPL mode),
 * show indexing status, and focus the project when it finishes.
 */

import { basename } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync } from 'node:fs';
import type { CommandContext } from '../types.js';
import { getDb, runMigrations, getDatabase } from '../../database/index.js';
import { createRAGEngine } from '../../agent/rag-engine.js';
import { validateProjectPath } from '../../utils/path-validation.js';
import { getBackgroundIndexingCoordinator } from '../utils/background-indexing.js';
import {
  createEmbeddingProvider,
  type EmbeddingProvider,
} from '../../indexer/index.js';
import type { Project } from '../../database/schema.js';
import { type ChatState, createRoutingEngine, getPrompt, loadProjectMetadata, updatePrompt } from './chat-state.js';

// ============================================================================
// Index Command Handler
// ============================================================================

/**
 * Format a path with ~ for home directory.
 * Matches the pattern used in status.ts for consistency.
 */
function formatPath(filePath: string): string {
  const homeDir = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  if (homeDir && filePath.startsWith(homeDir)) {
    return '~' + filePath.slice(homeDir.length);
  }
  return filePath;
}

/**
 * Format a date as relative time (e.g., "2 hours ago", "yesterday").
 * Used by /index status to show when projects were last indexed.
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  // For older dates, show the actual date
  return date.toLocaleDateString();
}

/**
 * Result of parsing /index command arguments.
 */
interface IndexArgs {
  path: string;
  name?: string;
  force: boolean;
  /** Subcommand: 'status' for /index status */
  subcommand?: 'status';
}

/**
 * Parse /index command arguments.
 *
 * Supports:
 *   /index <path>                 - Basic usage
 *   /index <path> -n <name>       - Custom project name
 *   /index <path> --force         - Re-index existing project
 *   /index status                 - Show indexing status
 *
 * @internal Exported for testing
 */
export function parseIndexArgs(args: string[]): IndexArgs {
  // Check for 'status' subcommand first (case-insensitive)
  if (args.length > 0 && args[0]?.toLowerCase() === 'status') {
    return { path: '', name: undefined, force: false, subcommand: 'status' };
  }

  let path = '';
  let name: string | undefined;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-n' || arg === '--name') {
      // Bounds check: only consume next arg if it exists
      if (i + 1 < args.length) {
        name = args[++i];
      }
    } else if (arg === '--force' || arg === '-f') {
      force = true;
    } else if (!path && arg && !arg.startsWith('-')) {
      path = arg;
    }
  }

  return { path, name, force };
}

/**
 * Handle /index status command to show indexing status.
 *
 * Since /index runs synchronously and blocks the REPL, this command
 * can only show historical information (last indexed project).
 * Real-time progress is displayed during the /index command itself.
 *
 * @returns true to continue REPL
 */
async function handleIndexStatusCommand(
  _state: ChatState,
  ctx: CommandContext
): Promise<boolean> {
  runMigrations();
  const db = getDb();

  // Check if background indexing is running
  const coordinator = getBackgroundIndexingCoordinator();
  const bgStatus = coordinator.getStatus();

  ctx.log('');
  ctx.log(chalk.bold('Index Status'));
  ctx.log(chalk.dim('─'.repeat(35)));

  if (bgStatus.running) {
    // Show live progress for background indexing
    ctx.log(`${chalk.cyan('State:')}          ${chalk.yellow('indexing')}`);
    ctx.log('');
    ctx.log(chalk.bold('Currently Indexing:'));
    ctx.log(`  ${chalk.cyan('Project:')}     ${bgStatus.projectName}`);

    if (bgStatus.stage) {
      const stageLabels: Record<string, string> = {
        scanning: 'Scanning files',
        chunking: 'Chunking files',
        embedding: 'Computing embeddings',
        storing: 'Storing chunks',
      };
      ctx.log(`  ${chalk.cyan('Stage:')}       ${stageLabels[bgStatus.stage] ?? bgStatus.stage}`);
    }

    if (bgStatus.progress) {
      const { processed, total, rate, eta } = bgStatus.progress;
      const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
      ctx.log(`  ${chalk.cyan('Progress:')}    ${processed.toLocaleString()}/${total.toLocaleString()} (${percent}%)`);

      if (rate !== undefined && rate > 0) {
        ctx.log(`  ${chalk.cyan('Rate:')}        ${rate.toFixed(1)} chunks/sec`);
      }

      if (eta !== undefined && eta > 0) {
        const etaStr = eta < 60 ? `${eta}s` : `${Math.floor(eta / 60)}m ${eta % 60}s`;
        ctx.log(`  ${chalk.cyan('ETA:')}         ${etaStr}`);
      }
    }

    if (bgStatus.startedAt) {
      const elapsed = Math.round((Date.now() - bgStatus.startedAt) / 1000);
      const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
      ctx.log(`  ${chalk.cyan('Elapsed:')}     ${elapsedStr}`);
    }

    ctx.log('');
    ctx.log(chalk.dim(`Use ${chalk.cyan('/index cancel')} to stop indexing.`));
    ctx.log('');
    return true;
  }

  // Not currently indexing - show idle state
  ctx.log(`${chalk.cyan('State:')}          ${chalk.green('idle')}`);

  // Get the most recently indexed project (by indexed_at timestamp)
  const lastIndexed = db
    .prepare(
      'SELECT * FROM projects WHERE indexed_at IS NOT NULL ORDER BY indexed_at DESC LIMIT 1'
    )
    .get() as Project | undefined;

  if (lastIndexed) {
    const indexedAt = new Date(lastIndexed.indexed_at!);
    const relativeTime = formatRelativeTime(indexedAt);

    ctx.log('');
    ctx.log(chalk.bold('Last Indexed Project:'));
    ctx.log(`  ${chalk.cyan('Name:')}        ${lastIndexed.name}`);
    ctx.log(`  ${chalk.cyan('Path:')}        ${formatPath(lastIndexed.path)}`);
    ctx.log(`  ${chalk.cyan('Indexed:')}     ${relativeTime}`);
    ctx.log(`  ${chalk.cyan('Files:')}       ${lastIndexed.file_count.toLocaleString()}`);
    ctx.log(`  ${chalk.cyan('Chunks:')}      ${lastIndexed.chunk_count.toLocaleString()}`);

    if (lastIndexed.embedding_model) {
      ctx.log(`  ${chalk.cyan('Model:')}       ${lastIndexed.embedding_model}`);
    }

    // Warn if the project path no longer exists
    if (!existsSync(lastIndexed.path)) {
      ctx.log(`  ${chalk.yellow('(path no longer exists)')}`);
    }
  } else {
    ctx.log('');
    ctx.log(chalk.dim('No projects have been indexed yet.'));
    ctx.log(chalk.dim(`Run ${chalk.cyan('/index <path>')} to index a project.`));
  }

  ctx.log('');
  return true;
}

/**
 * Focus chat on a project that just finished indexing, and tell the router
 * about it. Indexing has succeeded either way; a focus failure is only reported.
 */
async function focusIndexedProject(
  result: { projectId: string; projectName: string },
  state: ChatState,
  ctx: CommandContext
): Promise<void> {
  try {
    const newProject = getDatabase().getProjectById(result.projectId);
    if (newProject) {
      const newRagEngine = await createRAGEngine(state.config, result.projectId);
      state.ragEngine?.dispose();
      state.currentProject = newProject;
      state.ragEngine = newRagEngine;
      updatePrompt(state);

      // A chat that started with no projects has no engine yet.
      state.allProjects = loadProjectMetadata();
      state.routingEngine ??= await createRoutingEngine(state.config, state.llmProvider, ctx);
      state.chatAgent.updateProject(newProject, state.allProjects, state.routingEngine);

      ctx.log(chalk.blue(`Now focused on: ${result.projectName}`));
      ctx.log(chalk.dim('Ask questions about your code, or use /unfocus to clear focus'));
    }
  } catch (error) {
    ctx.log(
      chalk.yellow(
        `Indexed successfully, but auto-focus failed: ${(error as Error).message}`
      )
    );
    ctx.log(chalk.dim(`Use /focus ${result.projectName} to focus manually`));
  }
}

/**
 * Handle /index command to index a project from within the REPL.
 *
 * This reuses the same indexing pipeline as `ctx index`, providing:
 * - Path validation with helpful error messages
 * - Progress display with spinners (in TTY mode)
 * - Auto-focus on the newly indexed project
 *
 * @returns true to continue REPL
 */
export async function handleIndexCommand(
  args: string[],
  state: ChatState,
  ctx: CommandContext
): Promise<boolean> {
  // 1. Parse arguments
  const { path: inputPath, name, force, subcommand } = parseIndexArgs(args);

  // Handle /index status subcommand
  if (subcommand === 'status') {
    return handleIndexStatusCommand(state, ctx);
  }

  // Handle /index cancel subcommand
  if (subcommand === 'cancel') {
    const coordinator = getBackgroundIndexingCoordinator();
    if (coordinator.cancel()) {
      ctx.log(chalk.yellow('Cancelling indexing...'));
    } else {
      ctx.log(chalk.dim('No indexing operation in progress.'));
    }
    return true;
  }

  if (!inputPath) {
    ctx.log(chalk.yellow('Usage: /index <path> [-n name] [--force] | status | cancel'));
    ctx.log(chalk.dim('Example: /index ./my-project'));
    ctx.log(chalk.dim('         /index ../other-repo -n my-app'));
    ctx.log(chalk.dim('         /index status'));
    ctx.log(chalk.dim('         /index cancel'));
    return true;
  }

  // Check if indexing is already running
  const coordinator = getBackgroundIndexingCoordinator();
  if (coordinator.isRunning()) {
    const status = coordinator.getStatus();
    ctx.log(chalk.yellow(`Indexing already in progress: ${status.projectName}`));
    ctx.log(chalk.dim('Use /index status to check progress, /index cancel to stop.'));
    return true;
  }

  // 2. Validate path (same validation as `ctx index`)
  const validation = validateProjectPath(inputPath);
  if (!validation.valid) {
    ctx.error(validation.error);
    if (validation.hint) ctx.log(chalk.dim(validation.hint));
    return true;
  }

  const projectPath = validation.normalizedPath;
  for (const warning of validation.warnings) {
    ctx.log(chalk.yellow(`Warning: ${warning}`));
  }

  // 3. Determine project name (default to directory name)
  const projectName = name ?? basename(projectPath);

  // 4. Check for existing project
  runMigrations();
  const db = getDatabase();
  // By folder or by name: a moved project keeps its name, and names are unique.
  const existingProject = db.getProjectByPath(projectPath) ?? db.getProjectByName(projectName);

  if (existingProject && !force) {
    ctx.error(`Project already indexed: ${existingProject.name}`);
    ctx.log(chalk.dim('Use /index <path> --force to re-index'));
    return true;
  }

  if (existingProject) {
    ctx.log(chalk.dim(`Re-indexing: the ${existingProject.chunk_count} existing chunks stay searchable until it finishes`));
  }

  // 5. Create embedding provider with progress display
  ctx.log('');
  let modelLoadingSpinner: ReturnType<typeof ora> | null = null;
  if (process.stdout.isTTY && !state.tui) {
    modelLoadingSpinner = ora({
      text: 'Loading embedding model...',
      prefixText: chalk.cyan('Setup'.padEnd(12)),
    }).start();
  } else if (state.tui) {
    ctx.log(chalk.dim('Loading embedding model...'));
  }

  let embeddingProvider: EmbeddingProvider;
  let embeddingModel: string;
  let embeddingDimensions: number;
  try {
    const result = await createEmbeddingProvider(state.config.embedding, {
      onProgress: (progress) => {
        if (modelLoadingSpinner) {
          const pct = progress.progress ? ` (${progress.progress}%)` : '';
          modelLoadingSpinner.text = `${progress.status}${pct}`;
        }
      },
    });
    embeddingProvider = result.provider;
    embeddingModel = result.model;
    embeddingDimensions = result.dimensions;
    if (modelLoadingSpinner) {
      modelLoadingSpinner.succeed(
        `Embedding model ready (${embeddingModel}, ${embeddingDimensions}d)`
      );
    } else {
      ctx.log(chalk.green(`✓ Embedding model ready (${embeddingModel}, ${embeddingDimensions}d)`));
    }
  } catch (error) {
    if (modelLoadingSpinner) {
      modelLoadingSpinner.fail('Failed to load embedding model');
    } else {
      ctx.log(chalk.red('✗ Failed to load embedding model'));
    }
    ctx.error(`Embedding setup failed: ${(error as Error).message}`);
    ctx.log(chalk.dim('Check your embedding configuration: ctx config list'));
    return true;
  }

  // 6. Start indexing. A re-index goes into a staging table that is swapped in
  // at the end, so the old index keeps answering, and survives a failure.
  const pipelineOptions = {
    projectPath,
    projectName,
    projectId: existingProject?.id,
    embeddingProvider,
    embeddingModel,
    embeddingDimensions,
    embeddingTimeout: state.config.embedding.timeout_ms,
    additionalIgnorePatterns: state.config.indexing?.ignore_patterns,
    chunkerConfig: { embeddingProvider },
    useStaging: !!existingProject,
  };
  // In TUI mode: blocking with progress display (input disabled until complete)
  // In classic REPL: background with StatusBarRenderer (chat available)

  if (state.tui) {
    // ── BLOCKING MODE (TUI) ────────────────────────────────────────
    // Await indexing completion. Input is naturally blocked by
    // InputManager.isProcessing guard. Ctrl+C cancellation works via
    // the SIGINT handler in runChatTUI which calls coordinator.cancel().

    // Change prompt to indicate indexing mode
    state.tui.setPrompt(chalk.dim('Indexing... (Ctrl+C to cancel) '));
    state.tui.prompt();
    ctx.log(chalk.blue(`Indexing: ${projectName}`));

    // Track stage changes for chat area messages
    let currentStage: string | null = null;

    await new Promise<void>((resolve) => {
      coordinator.start({
        // Balanced batch size: good throughput + enough yield points
        // for progress events and cancellation checks
        pipelineOptions: { ...pipelineOptions, embeddingBatchSize: 16 },
        // No StatusBarRenderer or readline in TUI mode
        statusBarOptions: undefined,
        readline: undefined,

        // Progress → prompt area (always visible) + stage messages in chat area
        onProgress: (() => {
          let lastUpdateTime = 0;
          const stageLabels: Record<string, string> = {
            scanning: 'Scanning files...',
            chunking: 'Chunking files...',
            embedding: 'Embedding chunks...',
            storing: 'Storing data...',
          };
          const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
          return (data: { stage: string; processed: number; total: number; projectName: string }) => {
            // Detect stage transitions → show compact milestone in chat area
            if (data.stage !== currentStage) {
              currentStage = data.stage;
              state.tui!.addInfoMessage(
                chalk.dim(stageLabels[data.stage] ?? data.stage),
                { compact: true }
              );
            }

            // Throttle prompt + status bar updates to 200ms
            const now = performance.now();
            if (now - lastUpdateTime >= 200) {
              lastUpdateTime = now;
              const percent = data.total > 0
                ? Math.round((data.processed / data.total) * 100) : 0;

              // Show progress in prompt (always visible, never truncated)
              state.tui!.setPrompt(
                chalk.dim(`📦 ${capitalize(data.stage)} ${percent}% (Ctrl+C to cancel) `)
              );
              state.tui!.prompt();

              // Also update status bar (visible if not truncated)
              state.tui!.setIndexingStatus({
                projectName: data.projectName,
                progress: percent,
                stage: data.stage,
              });
            }
          };
        })(),

        onComplete: async (result) => {
          state.tui!.setIndexingStatus(undefined);
          ctx.log('');
          ctx.log(chalk.green(`✓ Indexed ${result.projectName}`));
          ctx.log(
            chalk.dim(
              `  ${result.filesIndexed} files, ${result.chunksStored.toLocaleString()} chunks`
            )
          );

          await focusIndexedProject(result, state, ctx);

          ctx.log('');
          resolve();
        },

        onError: (error) => {
          state.tui!.setIndexingStatus(undefined);
          ctx.error(`Indexing failed: ${error.message}`);
          ctx.log(chalk.dim('Try running: ctx index <path> for detailed diagnostics'));
          resolve();
        },

        onCancelled: () => {
          state.tui!.setIndexingStatus(undefined);
          // SIGINT handler in runChatTUI already shows "Indexing cancelled."
          resolve();
        },
      });
    });

    // Restore normal prompt after indexing completes/fails/cancels
    state.tui.setPrompt(getPrompt(state));
    return true;

  } else {
    // ── BACKGROUND MODE (Classic REPL) ─────────────────────────────
    // Fire-and-forget: indexing continues while user chats
    coordinator.start({
      // Small batch size for background: frequent event-loop yields
      // keep readline responsive during embedding
      pipelineOptions: { ...pipelineOptions, embeddingBatchSize: 8 },
      statusBarOptions: {
        terminalWidth: process.stdout.columns,
        noColor: !!process.env.NO_COLOR,
      },
      readline: state.rl,

      onComplete: async (result) => {
        ctx.log('');
        ctx.log(chalk.green(`✓ Indexed ${result.projectName}`));
        ctx.log(
          chalk.dim(
            `  ${result.filesIndexed} files, ${result.chunksStored.toLocaleString()} chunks`
          )
        );

        await focusIndexedProject(result, state, ctx);

        ctx.log('');
        state.rl?.prompt();
      },

      onError: (error) => {
        ctx.error(`Indexing failed: ${error.message}`);
        ctx.log(chalk.dim('Try running: ctx index <path> for detailed diagnostics'));
        state.rl?.prompt();
      },

      onCancelled: () => {
        ctx.log(chalk.yellow('Indexing cancelled.'));
        state.rl?.prompt();
      },
    });

    // Return immediately - indexing continues in background
    ctx.log(chalk.blue(`Started indexing: ${projectName}`));
    ctx.log(chalk.dim('Chat is available. Use /index status or /index cancel.'));
    ctx.log('');
    return true;
  }
}
