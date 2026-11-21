/**
 * File Scanner
 *
 * Main file discovery implementation using fast-glob for directory traversal.
 * Discovers files matching supported extensions while respecting gitignore patterns.
 */

import { statSync } from 'node:fs';
import { resolve, relative, extname, basename, normalize, join } from 'node:path';
import fg from 'fast-glob';

import {
  createIgnoreFilter,
  isBinaryFile,
} from './ignore.js';
import {
  DEFAULT_SUPPORTED_EXTENSIONS,
  getLanguageForExtension,
  getTypeForLanguage,
  type FileInfo,
  type FileType,
  type Language,
  type ScanOptions,
  type ScanResult,
  type ScanStats,
} from './types.js';

// Re-export types for consumers
export type { ScanResult };

/**
 * Scan a directory for files to index.
 *
 * Finds the files to index (see listFiles()) and gathers each one's metadata:
 * size, modification time, extension, language and type.
 *
 * @param rootPath - Directory to scan (absolute or relative path)
 * @param options - Scan configuration options
 * @returns Scan result with files and statistics
 *
 * @example
 * ```ts
 * const result = await scanDirectory('/path/to/project', {
 *   maxDepth: 10,
 *   onFile: (file) => console.log(`Found: ${file.relativePath}`),
 * });
 *
 * console.log(`Discovered ${result.stats.totalFiles} files`);
 * ```
 */
export async function scanDirectory(
  rootPath: string,
  options: ScanOptions = {}
): Promise<ScanResult> {
  const startTime = performance.now();
  const absoluteRoot = resolve(rootPath);

  const stats: ScanStats = {
    totalFiles: 0,
    totalSize: 0,
    byLanguage: {} as Record<Language, number>,
    byType: {} as Record<FileType, number>,
    errorsEncountered: 0,
    scanDurationMs: 0,
  };
  const files: FileInfo[] = [];

  let relativePaths: string[];
  try {
    relativePaths = await listFiles(absoluteRoot, options);
  } catch (error) {
    // If the root directory itself is inaccessible, that's a fatal error
    throw new Error(
      `Failed to scan directory: ${absoluteRoot}. ${(error as Error).message}`
    );
  }

  for (const relativePath of relativePaths) {
    const absolutePath = join(absoluteRoot, relativePath);

    let fileInfo: FileInfo;
    try {
      fileInfo = getFileInfo(absolutePath, absoluteRoot);
    } catch (error) {
      stats.errorsEncountered++;
      options.onError?.(absolutePath, error as Error);
      continue;
    }

    files.push(fileInfo);
    stats.totalFiles++;
    stats.totalSize += fileInfo.size;
    stats.byLanguage[fileInfo.language] = (stats.byLanguage[fileInfo.language] ?? 0) + 1;
    stats.byType[fileInfo.type] = (stats.byType[fileInfo.type] ?? 0) + 1;
    options.onFile?.(fileInfo);
  }

  stats.scanDurationMs = Math.round(performance.now() - startTime);

  return {
    rootPath: absoluteRoot,
    files,
    stats,
  };
}

/**
 * The files an index of `rootPath` would read, as paths relative to it: those
 * with a scanned extension or a known name (Dockerfile), at any depth, less
 * dotfiles, ignored files (.gitignore, defaults and `additionalIgnorePatterns`)
 * and binaries. Reads no file metadata, so `ctx check` can use it cheaply.
 */
export async function listFiles(rootPath: string, options: ScanOptions = {}): Promise<string[]> {
  const absoluteRoot = resolve(rootPath);
  const patterns = buildGlobPatterns(options.extensions ?? DEFAULT_SUPPORTED_EXTENSIONS);
  const ignoreFilter = createIgnoreFilter({
    rootPath: absoluteRoot,
    additionalPatterns: options.additionalIgnorePatterns,
    useDefaults: true,
  });

  const entries = await fg(patterns, {
    cwd: absoluteRoot,
    absolute: true,
    dot: false, // Don't match dotfiles (. prefix)
    onlyFiles: true,
    followSymbolicLinks: options.followSymlinks ?? false,
    deep: options.maxDepth ?? Infinity,
    suppressErrors: true, // Don't throw on permission errors
  });

  const paths: string[] = [];
  for (const entry of entries) {
    // fast-glob returns C:/x/y on Windows; use the platform's separators
    const relativePath = relative(absoluteRoot, normalize(entry));
    if (!ignoreFilter(relativePath) && !isBinaryFile(basename(relativePath))) {
      paths.push(relativePath);
    }
  }
  return paths;
}

/**
 * A file's fingerprint as indexed: its size and modification time, which
 * change when it is edited. Stored per file (file_hashes.hash) so `ctx check`
 * can tell which files changed since the last index without reading them.
 */
export function fileFingerprint(size: number, modifiedAt: Date | string): string {
  return `${size}:${new Date(modifiedAt).toISOString()}`;
}

/**
 * Files known by name rather than extension, mapped (by lowercase name) to the
 * extension they are indexed as: a Gemfile is Ruby, a Makefile plain text.
 * Each is scanned when its extension is.
 */
const SPECIAL_FILENAMES: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'txt',
  rakefile: 'rb',
  gemfile: 'rb',
  podfile: 'rb',
  vagrantfile: 'rb',
  brewfile: 'rb',
  procfile: 'yml',
  cakefile: 'txt',
};

/**
 * Build glob patterns for the given extensions.
 * Handles both regular extensions and special filenames.
 *
 * @param extensions - List of extensions to match
 * @returns Array of glob patterns
 */
function buildGlobPatterns(extensions: string[]): string[] {
  const patterns: string[] = [];

  // Standard extension pattern
  if (extensions.length === 1) {
    patterns.push(`**/*.${extensions[0]}`);
  } else if (extensions.length > 0) {
    patterns.push(`**/*.{${extensions.join(',')}}`);
  }

  // Add special filename patterns for requested extensions
  const extensionSet = new Set(extensions.map((e) => e.toLowerCase()));
  for (const [filename, ext] of Object.entries(SPECIAL_FILENAMES)) {
    if (extensionSet.has(ext)) {
      // Match at any depth: **/Dockerfile, Dockerfile
      patterns.push(`**/${filename}`);
      patterns.push(`**/${filename.charAt(0).toUpperCase()}${filename.slice(1)}`);
    }
  }

  return patterns;
}

/**
 * Get file information for a single file.
 *
 * @param absolutePath - Absolute path to the file
 * @param rootPath - Root directory for relative path calculation
 * @returns File metadata
 */
function getFileInfo(absolutePath: string, rootPath: string): FileInfo {
  // Get file stats
  const stat = statSync(absolutePath);

  // Extract extension (without dot)
  let ext = extname(absolutePath).toLowerCase();
  if (ext.startsWith('.')) {
    ext = ext.slice(1);
  }

  // Files known by name (Dockerfile, Gemfile) take their mapped extension
  if (ext === '') {
    ext = SPECIAL_FILENAMES[basename(absolutePath).toLowerCase()] ?? '';
  }

  // Detect language and type
  const language = getLanguageForExtension(ext);
  const type = getTypeForLanguage(language);

  return {
    path: absolutePath,
    relativePath: relative(rootPath, absolutePath),
    extension: ext,
    language,
    type,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}
