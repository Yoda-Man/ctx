import { describe, it, expect } from 'vitest';

import { INDEX_VERSION, staleIndexReason } from '../index-version.js';

describe('staleIndexReason', () => {
  const project = { name: 'api', path: '/code/api' };

  it('is null for an index at the current version', () => {
    expect(staleIndexReason({ ...project, index_version: INDEX_VERSION })).toBeNull();
  });

  it('names the re-index command for an older or unrecorded version', () => {
    for (const index_version of [null, INDEX_VERSION - 1]) {
      const reason = staleIndexReason({ ...project, index_version });
      expect(reason).toContain('ctx index "/code/api" --name "api" --force');
    }
  });
});

describe('index_version in the database', () => {
  it('is recorded when indexing finishes, not when a project is created or edited', async () => {
    const { runMigrations } = await import('../migrate.js');
    const { getDb } = await import('../connection.js');
    const { DatabaseOperations } = await import('../operations.js');
    runMigrations();
    const ops = new DatabaseOperations(getDb());
    const versionOf = (id: string) =>
      (getDb().prepare('SELECT index_version FROM projects WHERE id = ?').get(id) as { index_version: number | null })
        .index_version;

    const name = `iv-${Date.now()}`;
    const id = ops.upsertProject({ name, path: '/code/iv' });
    expect(versionOf(id)).toBeNull();
    ops.upsertProject({ id, name, path: '/code/iv', description: 'edited' });
    expect(versionOf(id)).toBeNull();

    ops.updateProjectStats(id, { fileCount: 1, chunkCount: 1 });
    expect(versionOf(id)).toBe(INDEX_VERSION);

    ops.deleteProject(id);
  });
});
