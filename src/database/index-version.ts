/**
 * Index version: what a project's stored chunks and vectors were built with.
 *
 * Bump INDEX_VERSION when a change makes existing indexes give wrong or worse
 * results until re-indexed (how chunks are split, how vectors are made).
 * Changes to search alone (BM25 tokenizing, fusion) need no bump: those
 * indexes are built from the stored chunks when a search starts.
 *
 * History:
 * - none: indexed before ctx recorded a version
 * - 2: 1.3.0, BGE vectors use CLS pooling (were mean-pooled)
 * - 3: Go and Rust files are split by top-level item (were split by size)
 */
export const INDEX_VERSION = 3;

/**
 * Why a project's index is stale, or null if it is current.
 */
export function staleIndexReason(project: {
  name: string;
  path: string;
  index_version: number | null;
}): string | null {
  if (project.index_version !== null && project.index_version >= INDEX_VERSION) {
    return null;
  }
  const built =
    project.index_version === null
      ? 'by a ctx version that did not record its index format'
      : `with index version ${project.index_version}`;
  return (
    `Project "${project.name}" was indexed ${built}; the current version is ${INDEX_VERSION}, ` +
    `so search results may be poor. Re-index it: ctx index "${project.path}" --name "${project.name}" --force`
  );
}
