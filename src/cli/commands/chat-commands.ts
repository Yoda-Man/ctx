/**
 * `ctx chat`'s slash commands and their parser.
 */

import chalk from 'chalk';
import { existsSync } from 'node:fs';
import type { CommandContext } from '../types.js';
import { getDb, runMigrations, getDatabase } from '../../database/index.js';
import { createRAGEngine } from '../../agent/rag-engine.js';
import {
  RAGEngineError,
  RAGErrorCodes,
} from '../../agent/types.js';
import type { Project } from '../../database/schema.js';
import { handleShareCommand } from './share-handler.js';
import { errorMessage } from '../../utils/error.js';
import { handleIndexCommand } from './chat-index.js';
import { type ChatState, cleanupChatState, findProject, safeParseJsonArray, updatePrompt } from './chat-state.js';

/**
 * REPL command definition.
 * Handler returns true to continue REPL, false to exit.
 */
interface REPLCommand {
  name: string;
  aliases: string[];
  description: string;
  usage?: string;
  handler: (
    args: string[],
    state: ChatState,
    ctx: CommandContext
  ) => Promise<boolean>;
}

// ============================================================================
// REPL Commands Registry
// ============================================================================

/**
 * Registry of all available REPL commands.
 * Commands start with "/" except for exit/quit.
 */
const REPL_COMMANDS: REPLCommand[] = [
  {
    name: 'help',
    aliases: ['h', '?'],
    description: 'Show available commands',
    handler: async (_args, _state, ctx) => {
      ctx.log('');
      ctx.log(chalk.bold('Available Commands:'));
      ctx.log('');
      for (const cmd of REPL_COMMANDS) {
        const aliasStr =
          cmd.aliases.length > 0
            ? chalk.dim(` (${cmd.aliases.map((a) => '/' + a).join(', ')})`)
            : '';
        const usageStr = cmd.usage ? ` ${chalk.cyan(cmd.usage)}` : '';
        ctx.log(`  ${chalk.green('/' + cmd.name)}${usageStr}${aliasStr}`);
        ctx.log(`    ${chalk.dim(cmd.description)}`);
      }
      ctx.log('');
      ctx.log(chalk.dim('Type any other text to ask a question.'));
      ctx.log('');
      return true;
    },
  },
  {
    name: 'focus',
    aliases: ['f'],
    description: 'Focus on a specific project for RAG search',
    usage: '<project-name>',
    handler: async (args, state, ctx) => {
      if (args.length === 0) {
        ctx.log(chalk.yellow('Usage: /focus <project-name>'));
        ctx.log(chalk.dim('Run /projects to see available projects'));
        return true;
      }

      const projectName = args.join(' ');
      const project = findProject(projectName);

      if (!project) {
        ctx.log(chalk.red(`Project not found: ${projectName}`));
        ctx.log(chalk.dim('Run /projects to see available projects'));
        return true;
      }

      // Create RAG engine first, then update state atomically
      // (If createRAGEngine throws, state remains unchanged)
      try {
        const newRagEngine = await createRAGEngine(
          state.config,
          String(project.id)
        );
        state.currentProject = project;
        state.ragEngine = newRagEngine;
        updatePrompt(state);

        // Update ChatAgent with new project context
        state.chatAgent.updateProject(project, state.allProjects, state.routingEngine);

        ctx.log(chalk.blue(`Focused on: ${project.name}`));
        if (!existsSync(project.path)) {
          ctx.log(
            chalk.yellow(`Warning: Project path no longer exists: ${project.path}`)
          );
        }
      } catch (error) {
        // Provide user-friendly error messages based on error type
        if (error instanceof RAGEngineError) {
          ctx.log(chalk.red(`Failed to focus on ${project.name}:`));
          ctx.log(chalk.red(`  ${error.message}`));

          // Add actionable hints based on error code
          switch (error.code) {
            case RAGErrorCodes.EMBEDDING_UNAVAILABLE:
              ctx.log(chalk.dim('Hint: Check the embedding provider with: ctx config get embedding.provider'));
              ctx.log(chalk.dim('      Or embed through Ollama: ctx config set embedding.provider ollama'));
              break;
            case RAGErrorCodes.PROJECT_NOT_INDEXED:
              ctx.log(chalk.dim(`Hint: Run: ctx index "${project.path}"  to index this project`));
              break;
            case RAGErrorCodes.CONFIG_ERROR:
              ctx.log(chalk.dim('Hint: Check your config with: ctx config list'));
              ctx.log(chalk.dim('      Reset to defaults with: ctx config reset'));
              break;
            default:
              ctx.log(chalk.dim('Hint: Try /unfocus to clear state, then /focus again'));
          }
        } else {
          // Unknown error - still show something useful
          ctx.log(chalk.red(`Failed to focus on ${project.name}:`));
          ctx.log(chalk.red(`  ${errorMessage(error)}`));
          ctx.log(chalk.dim('Hint: Try /unfocus to clear state, then /focus again'));
        }
        ctx.debug(`Focus error details: ${errorMessage(error)}`);
      }
      return true;
    },
  },
  {
    name: 'unfocus',
    aliases: ['u'],
    description: 'Clear project focus (disable RAG search)',
    handler: async (_args, state, ctx) => {
      if (state.currentProject) {
        ctx.log(chalk.blue(`Unfocused from: ${state.currentProject.name}`));
        state.currentProject = null;
        state.ragEngine = null;
        updatePrompt(state);

        // Update ChatAgent to reflect unfocused state
        state.chatAgent.updateProject(null, state.allProjects, state.routingEngine);
      } else {
        ctx.log(chalk.dim('No project is currently focused'));
      }
      return true;
    },
  },
  {
    name: 'projects',
    aliases: ['p', 'list'],
    description: 'List all indexed projects',
    handler: async (_args, state, ctx) => {
      runMigrations();
      const db = getDb();
      const projects = db
        .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
        .all() as Project[];

      if (projects.length === 0) {
        ctx.log(chalk.yellow('No projects indexed'));
        ctx.log(chalk.dim('Run: ctx index <path>  to index a project'));
        return true;
      }

      ctx.log('');
      ctx.log(chalk.bold('Indexed Projects:'));
      ctx.log('');
      for (const project of projects) {
        const isFocused = state.currentProject?.id === project.id;
        const marker = isFocused ? chalk.green(' *') : '';
        const pathExists = existsSync(project.path);
        const pathStatus = pathExists ? '' : chalk.yellow(' (path missing)');
        ctx.log(`  ${chalk.cyan(project.name)}${marker}${pathStatus}`);
        ctx.log(`    ${chalk.dim(project.path)}`);
      }
      ctx.log('');
      if (state.currentProject) {
        ctx.log(chalk.dim(`* = currently focused`));
      }
      ctx.log('');
      return true;
    },
  },
  {
    name: 'describe',
    aliases: ['desc'],
    description: 'Add description and tags to a project for smart routing',
    usage: '<project-name> ["description"] [--tags tag1,tag2]',
    handler: async (args, _state, ctx) => {
      // No arguments - show usage
      if (args.length === 0 || !args[0]) {
        ctx.log(chalk.yellow('Usage: /describe <project-name> ["description"] [--tags tag1,tag2]'));
        ctx.log('');
        ctx.log(chalk.dim('Examples:'));
        ctx.log(chalk.dim('  /describe my-api "Main REST API server"'));
        ctx.log(chalk.dim('  /describe my-api --tags backend,auth,payments'));
        ctx.log(chalk.dim('  /describe my-api "REST API" --tags backend,api'));
        ctx.log(chalk.dim('  /describe my-api                (show current values)'));
        return true;
      }

      // First arg is always the project name
      const projectName = args[0];
      const project = findProject(projectName);

      if (!project) {
        ctx.log(chalk.red(`Project not found: ${projectName}`));
        ctx.log(chalk.dim('Run /projects to see available projects'));
        return true;
      }

      // Join remaining args for parsing
      const remaining = args.slice(1).join(' ');

      // Extract description (text in quotes)
      let description: string | undefined;
      const descMatch = remaining.match(/"([^"]+)"|'([^']+)'/);
      if (descMatch) {
        description = descMatch[1] ?? descMatch[2];
      }

      // Extract tags (--tags tag1,tag2,tag3 or --tags "tag1, tag2, tag3")
      let tags: string[] | undefined;
      const tagsMatch = remaining.match(/--tags?\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
      if (tagsMatch) {
        const tagsValue = tagsMatch[1] ?? tagsMatch[2] ?? tagsMatch[3] ?? '';
        tags = tagsValue.split(',').map((t) => t.trim()).filter(Boolean);
      }

      // Show-only mode (no description or tags provided)
      if (!description && !tags) {
        const existingTags = safeParseJsonArray(project.tags);
        ctx.log('');
        ctx.log(chalk.bold(`Project: ${project.name}`));
        ctx.log(`  ${chalk.cyan('Path:')}        ${project.path}`);
        ctx.log(`  ${chalk.cyan('Description:')} ${project.description ?? chalk.dim('(none)')}`);
        ctx.log(`  ${chalk.cyan('Tags:')}        ${existingTags.length > 0 ? existingTags.join(', ') : chalk.dim('(none)')}`);
        ctx.log(`  ${chalk.cyan('Files:')}       ${project.file_count}`);
        ctx.log(`  ${chalk.cyan('Chunks:')}      ${project.chunk_count}`);
        ctx.log('');
        return true;
      }

      // Update project metadata
      const db = getDatabase();
      db.updateProjectMetadata(project.id, { description, tags });

      ctx.log(chalk.green(`✓ Updated project: ${project.name}`));
      if (description) {
        ctx.log(`  ${chalk.cyan('Description:')} ${description}`);
      }
      if (tags && tags.length > 0) {
        ctx.log(`  ${chalk.cyan('Tags:')}        ${tags.join(', ')}`);
      }
      ctx.log('');

      return true;
    },
  },
  {
    name: 'clear',
    aliases: ['c'],
    description: 'Clear conversation history',
    handler: async (_args, state, ctx) => {
      state.conversationContext.clear();
      state.chatAgent.clearHistory();
      ctx.log(chalk.blue('Conversation history cleared'));
      return true;
    },
  },
  {
    name: 'share',
    aliases: [],
    description: 'Export conversation to markdown file',
    usage: '[path]',
    handler: handleShareCommand,
  },
  {
    name: 'index',
    aliases: ['i'],
    description: 'Index a project directory for RAG search',
    usage: '<path> [-n name] [--force] | status',
    handler: async (args, state, ctx) => {
      return handleIndexCommand(args, state, ctx);
    },
  },
  {
    name: 'exit',
    aliases: ['quit', 'q'],
    description: 'Exit the chat',
    handler: async (_args, state, ctx) => {
      ctx.log(chalk.dim('Goodbye!'));
      cleanupChatState(state);
      return false; // Signal to exit REPL
    },
  },
];

/**
 * Parse user input to detect REPL commands.
 * Returns null if it's a regular question.
 *
 * @internal Exported for testing purposes
 */
export function parseREPLCommand(
  input: string
): { command: REPLCommand; args: string[] } | null {
  const trimmed = input.trim();

  // Check for "exit" or "quit" without slash
  if (/^(exit|quit)$/i.test(trimmed)) {
    const exitCmd = REPL_COMMANDS.find((c) => c.name === 'exit')!;
    return { command: exitCmd, args: [] };
  }

  // Must start with "/" for other commands
  if (!trimmed.startsWith('/')) {
    return null;
  }

  // Parse "/command arg1 arg2"
  const parts = trimmed.slice(1).split(/\s+/);
  const cmdName = parts[0]?.toLowerCase() ?? '';
  const args = parts.slice(1);

  // Find matching command by name or alias
  const command = REPL_COMMANDS.find(
    (c) => c.name === cmdName || c.aliases.includes(cmdName)
  );

  if (!command) {
    return null; // Unknown command, treat as question
  }

  return { command, args };
}
