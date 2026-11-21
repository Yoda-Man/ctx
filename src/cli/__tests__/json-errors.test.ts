/**
 * With --json, errors the CLI reports before or outside a command (an unknown
 * option, a missing argument) come out as JSON on stderr, with a failing code.
 * Runs the real entry point.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const home = mkdtempSync(join(tmpdir(), 'ctx-json-errors-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const ctx = (...args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', join(import.meta.dirname, '../index.ts'), ...args], {
    encoding: 'utf-8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });

describe('ctx --json errors', () => {
  it('reports an unknown option as JSON', () => {
    const run = ctx('--json', 'list', '--bogus');
    expect(run.status).toBe(1);
    expect(JSON.parse(run.stderr)).toMatchObject({ error: "unknown option '--bogus'", code: 1 });
  });

  it('reports a missing argument as JSON', () => {
    const run = ctx('--json', 'search');
    expect(run.status).toBe(1);
    expect(JSON.parse(run.stderr).error).toMatch(/missing required argument/);
  });

  it('leaves the plain-text error to Commander without --json', () => {
    const run = ctx('list', '--bogus');
    expect(run.status).toBe(1);
    expect(run.stderr.trim()).toBe("error: unknown option '--bogus'");
  });

  it('still exits 0 for --version', () => {
    const run = ctx('--json', '--version');
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
