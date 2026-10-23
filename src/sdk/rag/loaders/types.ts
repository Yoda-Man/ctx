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
interface DocumentMetadata {
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
