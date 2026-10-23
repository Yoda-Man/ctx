/**
 * Document Loader Types
 *
 * Core interfaces for the RAG document loading system.
 * All document loaders must implement the DocumentLoader interface.
 */

// ============================================================================
// Document Types
// ============================================================================

/**
 * Metadata extracted from a document.
 *
 * Common fields are strongly typed; loaders can add custom fields
 * via the index signature.
 */
export interface DocumentMetadata {
  /** Document title, if available */
  title?: string;
  /** Document author, if available */
  author?: string;
  /** When the document was created */
  createdAt?: Date;
  /** When the document was last modified */
  modifiedAt?: Date;
  /** MIME type of the source (e.g., "application/pdf") */
  mimeType?: string;
  /** Number of pages (for paginated documents) */
  pageCount?: number;
  /** Approximate word count */
  wordCount?: number;
  /** Allow loader-specific custom fields */
  [key: string]: unknown;
}

/**
 * A loaded document ready for processing.
 *
 * Documents are the output of loaders and the input to chunkers.
 */
export interface Document {
  /** Unique identifier for this document */
  id: string;
  /** The text content of the document */
  content: string;
  /** Extracted metadata */
  metadata: DocumentMetadata;
  /** Original source path or identifier */
  source: string;
}

// ============================================================================
// Loader Configuration
// ============================================================================

/**
 * Options for loading documents.
 */
export interface LoadOptions {
  /**
   * Base directories allowed for file loading.
   * Required for path-based sources to prevent traversal attacks.
   */
  allowedDirectories?: string[];
  /** Whether to follow symlinks (default: false) */
  followSymlinks?: boolean;
  /** Encoding for text files (default: 'utf-8') */
  encoding?: BufferEncoding;
  /** Maximum file size in bytes (default: 10MB) */
  maxFileSize?: number;
  /** Loader-specific options */
  [key: string]: unknown;
}

// ============================================================================
// Loader Interface
// ============================================================================

/**
 * Interface for document loaders.
 *
 * Loaders are responsible for:
 * 1. Detecting if they can handle a source (canLoad)
 * 2. Loading and parsing the source into Documents (load)
 *
 * @example
 * ```typescript
 * const loader: DocumentLoader = new MarkdownLoader();
 *
 * if (loader.canLoad('readme.md')) {
 *   const docs = await loader.load('readme.md', {
 *     allowedDirectories: ['/app/docs']
 *   });
 * }
 * ```
 */
export interface DocumentLoader {
  /** Human-readable name of this loader */
  readonly name: string;

  /** File extensions this loader supports (e.g., ['.md', '.markdown']) */
  readonly supportedFormats: string[];

  /**
   * Check if this loader can handle the given source.
   *
   * For file paths, checks the extension.
   * For buffers, may inspect magic bytes.
   *
   * @param source - File path or buffer to check
   * @returns true if this loader can handle the source
   */
  canLoad(source: string | Buffer): boolean;

  /**
   * Load and parse a document from the source.
   *
   * @param source - File path or buffer to load
   * @param options - Loading options (required for file paths)
   * @returns Array of documents (some formats yield multiple docs)
   * @throws {LoaderError} If loading fails
   * @throws {PathTraversalError} If path validation fails
   */
  load(source: string | Buffer, options?: LoadOptions): Promise<Document[]>;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for loader failures.
 */
export type LoaderErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'FILE_NOT_FOUND'
  | 'FILE_TOO_LARGE'
  | 'PARSE_ERROR'
  | 'ENCODING_ERROR'
  | 'PERMISSION_DENIED'
  | 'LOADER_ERROR'
  | 'SERVICE_UNAVAILABLE';

/**
 * Details about a loader error.
 */
export interface LoaderErrorDetails {
  /** Machine-readable error code */
  code: LoaderErrorCode;
  /** Name of the loader that failed */
  loaderName: string;
  /** Source that was being loaded */
  source: string;
  /** Underlying cause, if any */
  cause?: Error;
}
