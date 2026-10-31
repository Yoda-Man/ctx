/**
 * `ctx chat`'s slash commands, against a real (temporary) database.
 *
 * Only what would load models or need Ollama is stubbed: the RAG engine and the
 * embedding provider (a deterministic fake). Indexing runs the real pipeline.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../../config/paths.js', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const os = require('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-chat-commands-'));
  (globalThis as Record<string, unknown>).__chatCommandsRoot = root;
  return {
    CTX_DIR: root,
    MODELS_DIR: path.join(root, 'models'),
    DB_PATH: path.join(root, 'context.db'),
    getCtxDir: () => root,
    getDbPath: () => path.join(root, 'context.db'),
    getConfigPath: () => path.join(root, 'config.toml'),
  };
});

vi.mock('../../../agent/rag-engine.js', () => ({
  createRAGEngine: vi.fn(async () => ({ dispose: vi.fn() })),
}));

vi.mock('../../../indexer/embedder/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../indexer/embedder/index.js')>();
  const { createMockEmbeddingProvider } = await import('../../__tests__/integration/setup.js');
  return {
    ...original,
    createEmbeddingProvider: vi.fn(async () => ({ provider: createMockEmbeddingProvider(), model: 'mock', dimensions: 1024 })),
  };
});

const { parseREPLCommand } = await import('../chat-commands.js');
const { getDatabase, runMigrations, getDb } = await import('../../../database/index.js');
const { createRAGEngine } = await import('../../../agent/rag-engine.js');
const { RAGEngineError, RAGErrorCodes } = await import('../../../agent/types.js');
const { createEmbeddingProvider } = await import('../../../indexer/embedder/index.js');
const { DEFAULT_CONFIG } = await import('../../../config/defaults.js');
import type { ChatState } from '../chat-state.js';
import type { CommandContext } from '../../types.js';

const scratch = mkdtempSync(join(tmpdir(), 'ctx-chat-projects-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync((globalThis as Record<string, unknown>).__chatCommandsRoot as string, { recursive: true, force: true });
});

let logs: string[];
let errors: string[];
const ctx: CommandContext = {
  options: { verbose: false, json: false },
  log: (m: string) => logs.push(strip(m)),
  debug: () => {},
  error: (m: string) => errors.push(strip(m)),
  warn: (m: string) => logs.push(strip(m)),
};
// oxlint-disable-next-line no-control-regex -- removing chalk's colour codes
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const output = () => logs.join('\n');

function chatState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    currentProject: null,
    conversationContext: { clear: vi.fn() } as unknown as ChatState['conversationContext'],
    ragEngine: null,
    llmProvider: { streamChat: vi.fn() } as unknown as ChatState['llmProvider'],
    providerInfo: { name: 'ollama', model: 'qwen3.5:9b' },
    config: { ...DEFAULT_CONFIG },
    allProjects: [],
    chatAgent: { updateProject: vi.fn(), clearHistory: vi.fn() } as unknown as ChatState['chatAgent'],
    ...overrides,
  };
}

async function run(input: string, state = chatState()): Promise<boolean> {
  const parsed = parseREPLCommand(input);
  if (!parsed) throw new Error(`not a command: ${input}`);
  return parsed.command.handler(parsed.args, state, ctx);
}

function addProject(name: string, path = join(scratch, name)): string {
  mkdirSync(path, { recursive: true });
  return getDatabase().upsertProject({ name, path });
}

beforeEach(() => {
  logs = [];
  errors = [];
  runMigrations();
  getDb().exec('DELETE FROM chunks; DELETE FROM projects;');
  vi.mocked(createRAGEngine).mockClear();
});

describe('/help', () => {
  it('lists every command and keeps the chat open', async () => {
    expect(await run('/help')).toBe(true);
    for (const name of ['help', 'focus', 'unfocus', 'projects', 'describe', 'clear', 'share', 'index', 'exit']) {
      expect(output()).toContain(`/${name}`);
    }
  });
});

describe('/focus', () => {
  it('explains its usage when no project is named', async () => {
    await run('/focus');
    expect(output()).toContain('Usage: /focus <project-name>');
  });

  it('reports an unknown project', async () => {
    await run('/focus nope');
    expect(output()).toContain('Project not found: nope');
  });

  it('focuses a project and tells the agent', async () => {
    addProject('shop');
    const state = chatState();

    await run('/focus shop', state);

    expect(state.currentProject?.name).toBe('shop');
    expect(state.ragEngine).not.toBeNull();
    expect(state.chatAgent!.updateProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'shop' }), [], undefined);
    expect(output()).toContain('Focused on: shop');
  });

  it('warns when the focused project folder is gone', async () => {
    addProject('moved', join(scratch, 'moved'));
    rmSync(join(scratch, 'moved'), { recursive: true });

    await run('/focus moved');
    expect(output()).toContain('Warning: Project path no longer exists');
  });

  it('leaves the state alone and gives a hint when the engine cannot start', async () => {
    addProject('shop');
    vi.mocked(createRAGEngine).mockRejectedValueOnce(new RAGEngineError(RAGErrorCodes.EMBEDDING_UNAVAILABLE, 'no model'));
    const state = chatState();

    await run('/focus shop', state);

    expect(state.currentProject).toBeNull();
    expect(output()).toContain('Failed to focus on shop');
    expect(output()).toContain('ctx config get embedding.provider');
  });
});

describe('/unfocus', () => {
  it('clears the focus', async () => {
    addProject('shop');
    const state = chatState();
    await run('/focus shop', state);

    await run('/unfocus', state);

    expect(state.currentProject).toBeNull();
    expect(state.ragEngine).toBeNull();
    expect(output()).toContain('Unfocused from: shop');
  });

  it('says so when nothing is focused', async () => {
    await run('/unfocus');
    expect(output()).toContain('No project is currently focused');
  });
});

describe('/projects', () => {
  it('points to ctx index when there are none', async () => {
    await run('/projects');
    expect(output()).toContain('No projects indexed');
  });

  it('lists projects, marking the focused one and missing folders', async () => {
    addProject('shop');
    addProject('gone', join(scratch, 'gone'));
    rmSync(join(scratch, 'gone'), { recursive: true });
    const state = chatState();
    await run('/focus shop', state);
    logs = [];

    await run('/projects', state);

    expect(output()).toMatch(/shop \*/);
    expect(output()).toContain('gone (path missing)');
  });
});

describe('/describe', () => {
  it('shows a project when given no description or tags', async () => {
    addProject('shop');
    await run('/describe shop');
    expect(output()).toContain('Project: shop');
    expect(output()).toContain('Description: (none)');
  });

  it('saves a quoted description and tags', async () => {
    addProject('shop');

    await run('/describe shop "Checkout and refunds" --tags payments, backend');

    const saved = getDatabase().getProjectByName('shop')!;
    expect(saved.description).toBe('Checkout and refunds');
    expect(JSON.parse(saved.tags!)).toEqual(['payments']); // tags end at the first space unless quoted
    expect(output()).toContain('Updated project: shop');
  });

  it('accepts quoted tags with spaces', async () => {
    addProject('shop');
    await run('/describe shop --tags "payments, backend"');
    expect(JSON.parse(getDatabase().getProjectByName('shop')!.tags!)).toEqual(['payments', 'backend']);
  });
});

describe('/clear and /exit', () => {
  it('/clear empties the conversation and the agent history', async () => {
    const state = chatState();
    expect(await run('/clear', state)).toBe(true);
    expect(state.conversationContext.clear).toHaveBeenCalled();
    expect(state.chatAgent!.clearHistory).toHaveBeenCalled();
  });

  it('/exit and plain "exit" end the chat and release the engine', async () => {
    const dispose = vi.fn();
    const state = chatState({ ragEngine: { dispose } as unknown as ChatState['ragEngine'] });

    expect(await run('/exit', state)).toBe(false);
    expect(dispose).toHaveBeenCalled();
    expect(await run('exit')).toBe(false);
  });
});

describe('/index', () => {
  // TUI mode waits for indexing to finish, which keeps these tests deterministic.
  const tui = () => ({ setPrompt: vi.fn(), prompt: vi.fn(), addInfoMessage: vi.fn(), setIndexingStatus: vi.fn() });

  function sampleProject(name: string, files: Record<string, string>): string {
    const dir = join(scratch, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content);
    return dir;
  }
  const code = (fn: string) => `export function ${fn}(a: number, b: number): number {\n  // ${fn} adds two numbers for the ${fn} test\n  return a + b;\n}\n`;

  it('explains its usage with no path', async () => {
    await run('/index');
    expect(output()).toContain('Usage: /index <path>');
  });

  it('indexes a folder and focuses the new project', async () => {
    const dir = sampleProject('fresh', { 'math.ts': code('add') });
    const state = chatState({ tui: tui() as unknown as ChatState['tui'] });

    await run(`/index ${dir} -n fresh`, state);

    expect(errors).toEqual([]);
    expect(getDatabase().getProjectByName('fresh')!.chunk_count).toBeGreaterThan(0);
    expect(state.currentProject?.name).toBe('fresh');
  });

  it('lets the agent search a project indexed in a chat that started with none', async () => {
    const dir = sampleProject('first', { 'math.ts': code('add') });
    const state = chatState({ tui: tui() as unknown as ChatState['tui'], routingEngine: null });

    await run(`/index ${dir} -n first`, state);

    expect(state.routingEngine).toBeTruthy();
    expect(state.allProjects.map((p) => p.name)).toEqual(['first']);
    expect(state.chatAgent.updateProject).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'first' }),
      state.allProjects,
      state.routingEngine
    );
  });

  it('refuses to re-index without --force', async () => {
    const dir = sampleProject('twice', { 'math.ts': code('add') });
    await run(`/index ${dir}`, chatState({ tui: tui() as unknown as ChatState['tui'] }));

    await run(`/index ${dir}`, chatState({ tui: tui() as unknown as ChatState['tui'] }));
    expect(errors.at(-1)).toContain('Project already indexed: twice');
  });

  it('keeps the existing index when a forced re-index fails', async () => {
    const dir = sampleProject('keep', { 'math.ts': code('add') });
    await run(`/index ${dir}`, chatState({ tui: tui() as unknown as ChatState['tui'] }));
    const before = getDatabase().getProjectByName('keep')!.chunk_count;
    vi.mocked(createEmbeddingProvider).mockRejectedValueOnce(new Error('model failed to load'));

    await run(`/index ${dir} --force`, chatState({ tui: tui() as unknown as ChatState['tui'] }));

    expect(errors.at(-1)).toContain('model failed to load');
    const rows = getDb().prepare('SELECT COUNT(*) AS n FROM chunks c JOIN projects p ON p.id = c.project_id WHERE p.name = ?').get('keep') as { n: number };
    expect(rows.n).toBe(before);
  });

  it('re-indexes a project whose folder moved, under the same name', async () => {
    const oldDir = sampleProject('specs-old', { 'math.ts': code('add') });
    await run(`/index ${oldDir} -n specs`, chatState({ tui: tui() as unknown as ChatState['tui'] }));
    const newDir = sampleProject('specs-new', { 'math.ts': code('add'), 'more.ts': code('sum') });

    await run(`/index ${newDir} -n specs --force`, chatState({ tui: tui() as unknown as ChatState['tui'] }));

    expect(errors).toEqual([]);
    const project = getDatabase().getProjectByName('specs')!;
    expect(project.path).toBe(realpathSync(newDir)); // ctx stores the resolved path
    expect(project.file_count).toBe(2);
  });
});
