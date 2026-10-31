/**
 * `ctx config reset` deletes the config file, so it always requires --force,
 * in JSON mode (how agents call ctx) as much as in text mode.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandContext } from '../../types.js';

const dir = mkdtempSync(join(tmpdir(), 'ctx-config-reset-'));
const configPath = join(dir, 'config.toml');

vi.mock('../../../config/loader.js', () => ({
  loadConfig: vi.fn(),
  getConfigValue: vi.fn(),
  setConfigValue: vi.fn(),
  listConfig: vi.fn(),
  getConfigPath: () => configPath,
}));

const { createConfigCommand } = await import('../config.js');

function run(json: boolean, ...args: string[]) {
  const ctx: CommandContext = { options: { verbose: false, json }, log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const program = new Command();
  program.addCommand(createConfigCommand(() => ctx));
  return program.parseAsync(['node', 'ctx', 'config', 'reset', ...args]);
}

describe('ctx config reset', () => {
  beforeEach(() => {
    writeFileSync(configPath, 'default_provider = "ollama"\n');
    process.exitCode = undefined;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it.each([false, true])('keeps the config without --force (json: %s)', async (json) => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(json);
    expect(existsSync(configPath)).toBe(true);
    expect(process.exitCode).toBe(1);
    if (json) expect(JSON.parse(stderr.mock.calls[0]![0] as string).error).toBe('confirmation_required');
  });

  it('resets with --force', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await run(true, '--force');
    expect(existsSync(configPath)).toBe(false);
    expect(process.exitCode).toBeUndefined();
  });
});

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
