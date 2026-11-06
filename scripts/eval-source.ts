/**
 * Real-model retrieval eval over ctx's own source.
 *
 * Indexes this repository with the configured embedding model (BGE by
 * default) and scores `ctx eval run` against fixtures/eval/ctx-source-golden.json:
 * 56 questions (identifiers, paraphrases, docs) with the files that answer them.
 *
 * Unlike run-ci-eval.ts (a mock search for CI), this measures real search
 * quality, so run it before and after a change to search or indexing.
 *
 * It runs in a temporary home folder, so ~/.ctx is not touched; models
 * already in ~/.ctx/models are linked in, not downloaded again.
 *
 * Usage (after `npm run build`):
 *   npx tsx scripts/eval-source.ts            # prints the metrics as JSON
 *   npx tsx scripts/eval-source.ts --keep     # keeps the temp home for inspection
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = 'ctx-source';
const ignore = '**/__tests__/**,fixtures/**,docs/assets/**,package-lock.json';

const home = mkdtempSync(join(tmpdir(), 'ctx-eval-source-'));
const env = { ...process.env, HOME: home, USERPROFILE: home };

const ctx = (...args: string[]) => {
  const result = spawnSync(process.execPath, [join(root, 'dist', 'cli.js'), ...args], {
    cwd: root,
    env,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`ctx ${args.join(' ')} failed (${result.status}):\n${result.stderr}`);
  }
  return result.stdout;
};

try {
  if (!existsSync(join(root, 'dist', 'cli.js'))) throw new Error('Run `npm run build` first');

  mkdirSync(join(home, '.ctx', 'eval', project), { recursive: true });
  const models = join(homedir(), '.ctx', 'models');
  if (existsSync(models)) symlinkSync(models, join(home, '.ctx', 'models'), 'junction');
  cpSync(join(root, 'fixtures', 'eval', 'ctx-source-golden.json'), join(home, '.ctx', 'eval', project, 'golden.json'));

  ctx('index', root, '--name', project, '--ignore', ignore, '--force');
  const output = JSON.parse(ctx('eval', 'run', '--project', project, '--json')) as { metrics: unknown };
  console.log(JSON.stringify(output.metrics, null, 2));
} finally {
  if (process.argv.includes('--keep')) console.error(`Temp home kept: ${home}`);
  else rmSync(home, { recursive: true, force: true });
}
