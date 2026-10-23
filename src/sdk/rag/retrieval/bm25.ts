/**
 * BM25 Sparse Retriever
 *
 * Pure JavaScript implementation of BM25 (Best Matching 25) for sparse retrieval.
 * No external dependencies - uses built-in tokenization.
 *
 * BM25 is a bag-of-words retrieval function that ranks documents based on
 * query term frequency, document length, and inverse document frequency.
 */

import type {
  Retriever,
  RetrievalResult,
  RetrievalOptions,
  BM25Config,
  BM25Document,
} from './types.js';
import { RetrieverError } from './errors.js';

// ============================================================================
// Default Configuration
// ============================================================================

/** Default BM25 k1 parameter (term frequency saturation) */
const DEFAULT_K1 = 1.2;

/** Default BM25 b parameter (document length normalization) */
const DEFAULT_B = 0.75;

/** Default minimum document frequency */
const DEFAULT_MIN_DOC_FREQ = 1;

/** Default maximum document frequency ratio */
const DEFAULT_MAX_DOC_FREQ_RATIO = 1.0;

// ============================================================================
// Tokenization
// ============================================================================

/**
 * Default tokenizer: lowercase, split on whitespace and punctuation.
 *
 * This is a simple but effective tokenizer for English text.
 * For production use with other languages, consider providing a custom tokenizer.
 */
const defaultTokenizer = (text: string): string[] => {
  return text
    .toLowerCase()
    // Replace punctuation and non-alphanumeric with spaces
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    // Split on whitespace
    .split(/\s+/)
    // Filter empty strings and very short tokens
    .filter((token) => token.length >= 2);
};

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Internal document representation with token statistics.
 */
interface IndexedDocument {
  id: string;
  chunk: BM25Document['chunk'];
  /** Token frequencies in this document */
  termFreqs: Map<string, number>;
  /** Total number of tokens in document */
  length: number;
}

/**
 * Inverted index entry for a term.
 */
interface PostingList {
  /** Document IDs containing this term */
  docIds: Set<string>;
  /** Number of documents containing this term */
  docFreq: number;
  /** Pre-computed IDF value */
  idf: number;
}

// ============================================================================
// BM25 Retriever Implementation
// ============================================================================

/**
 * BM25 sparse retriever for keyword-based search.
 *
 * BM25 excels at:
 * - Exact keyword matching ("PostgreSQL 15.4")
 * - Technical terminology and proper nouns
 * - Queries where specific words MUST appear
 *
 * @example
 * ```typescript
 * const retriever = new BM25Retriever({ k1: 1.2, b: 0.75 });
 *
 * // Build index from documents
 * await retriever.buildIndex([
 *   { id: '1', content: 'PostgreSQL is a database', chunk: {...} },
 *   { id: '2', content: 'MySQL is also a database', chunk: {...} },
 * ]);
 *
 * // Search
 * const results = await retriever.retrieve('PostgreSQL database', { topK: 5 });
 * ```
 */
export class BM25Retriever implements Retriever {
  readonly name = 'BM25Retriever';

  // Configuration
  private readonly k1: number;
  private readonly b: number;
  private readonly tokenizer: (text: string) => string[];
  private readonly minDocFreq: number;
  private readonly maxDocFreqRatio: number;

  // Index state
  private documents: Map<string, IndexedDocument> = new Map();
  private invertedIndex: Map<string, PostingList> = new Map();
  private avgDocLength = 0;
  private isIndexBuilt = false;

  constructor(config: BM25Config = {}) {
    this.k1 = config.k1 ?? DEFAULT_K1;
    this.b = config.b ?? DEFAULT_B;
    this.tokenizer = config.tokenizer ?? defaultTokenizer;
    this.minDocFreq = config.minDocFreq ?? DEFAULT_MIN_DOC_FREQ;
    this.maxDocFreqRatio = config.maxDocFreqRatio ?? DEFAULT_MAX_DOC_FREQ_RATIO;

    // Validate parameters
    if (this.k1 < 0) {
      throw RetrieverError.configError(this.name, 'k1 must be non-negative');
    }
    if (this.b < 0 || this.b > 1) {
      throw RetrieverError.configError(this.name, 'b must be between 0 and 1');
    }
  }

  /**
   * Build the BM25 index from documents.
   *
   * This must be called before retrieve(). The index can be rebuilt
   * by calling this method again with new documents.
   *
   * @param documents - Documents to index
   */
  buildIndex = (documents: BM25Document[]): void => {
    // Reset state
    this.documents.clear();
    this.invertedIndex.clear();
    this.avgDocLength = 0;

    if (documents.length === 0) {
      this.isIndexBuilt = true;
      return;
    }

    // Phase 1: Tokenize and compute term frequencies
    let totalLength = 0;

    for (const doc of documents) {
      const tokens = this.tokenizer(doc.content);
      const termFreqs = new Map<string, number>();

      for (const token of tokens) {
        termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
      }

      this.documents.set(doc.id, {
        id: doc.id,
        chunk: doc.chunk,
        termFreqs,
        length: tokens.length,
      });

      totalLength += tokens.length;
    }

    this.avgDocLength = totalLength / documents.length;

    // Phase 2: Build inverted index with document frequencies
    const docCount = documents.length;
    const termDocFreqs = new Map<string, Set<string>>();

    for (const [docId, indexedDoc] of this.documents) {
      for (const term of indexedDoc.termFreqs.keys()) {
        if (!termDocFreqs.has(term)) {
          termDocFreqs.set(term, new Set());
        }
        termDocFreqs.get(term)!.add(docId);
      }
    }

    // Phase 3: Compute IDF and filter terms by document frequency
    const maxDocFreq = Math.floor(docCount * this.maxDocFreqRatio);

    for (const [term, docIds] of termDocFreqs) {
      const docFreq = docIds.size;

      // Filter by document frequency bounds
      if (docFreq < this.minDocFreq || docFreq > maxDocFreq) {
        continue;
      }

      // IDF formula: log((N - df + 0.5) / (df + 0.5) + 1)
      // This is the "Robertson-Sparck Jones" IDF variant used in BM25
      const idf = Math.log((docCount - docFreq + 0.5) / (docFreq + 0.5) + 1);

      this.invertedIndex.set(term, {
        docIds,
        docFreq,
        idf,
      });
    }

    this.isIndexBuilt = true;
  };

  /**
   * Retrieve documents matching the query using BM25 scoring.
   *
   * @param query - Search query
   * @param options - Retrieval options
   * @returns Sorted results with BM25 scores
   */
  retrieve = async (
    query: string,
    options: RetrievalOptions = {}
  ): Promise<RetrievalResult[]> => {
    // Validate state
    if (!this.isIndexBuilt) {
      throw RetrieverError.indexNotBuilt(this.name);
    }

    // Validate query
    if (!query || query.trim().length === 0) {
      throw RetrieverError.invalidQuery(this.name, 'Query cannot be empty');
    }

    const topK = options.topK ?? 10;
    const minScore = options.minScore ?? 0;

    // Tokenize query
    const queryTerms = this.tokenizer(query);
    if (queryTerms.length === 0) {
      return [];
    }

    // Score all documents containing at least one query term
    const scores = new Map<string, number>();
    const candidateDocs = new Set<string>();

    // Find all candidate documents (union of posting lists)
    for (const term of queryTerms) {
      const posting = this.invertedIndex.get(term);
      if (posting) {
        for (const docId of posting.docIds) {
          candidateDocs.add(docId);
        }
      }
    }

    // Score each candidate document
    for (const docId of candidateDocs) {
      const doc = this.documents.get(docId)!;
      let score = 0;

      for (const term of queryTerms) {
        const posting = this.invertedIndex.get(term);
        if (!posting || !posting.docIds.has(docId)) {
          continue;
        }

        const tf = doc.termFreqs.get(term) ?? 0;
        const idf = posting.idf;

        // BM25 score for this term
        // score = IDF * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * |D|/avgdl))
        const numerator = tf * (this.k1 + 1);
        const denominator =
          tf + this.k1 * (1 - this.b + this.b * (doc.length / this.avgDocLength));
        score += idf * (numerator / denominator);
      }

      if (score > minScore) {
        scores.set(docId, score);
      }
    }

    // Sort by score (descending) and take topK
    const sortedResults = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK);

    // Normalize scores to 0-1 range for consistency with other retrievers
    const maxScore = sortedResults[0]?.[1] ?? 1;
    const normalizer = maxScore > 0 ? maxScore : 1;

    // Convert to RetrievalResult format
    return sortedResults.map(([docId, score]) => {
      const doc = this.documents.get(docId)!;
      return {
        id: docId,
        chunk: doc.chunk,
        score: score / normalizer, // Normalized to 0-1
        // For BM25-only retrieval, we don't populate the full HybridScore
        // That's done by the HybridRetriever
      };
    });
  };

  /**
   * Get the number of indexed documents.
   */
  get documentCount(): number {
    return this.documents.size;
  }

  /**
   * Get the number of unique terms in the index.
   */
  get vocabularySize(): number {
    return this.invertedIndex.size;
  }

  /**
   * Get the average document length.
   */
  get averageDocumentLength(): number {
    return this.avgDocLength;
  }

  /**
   * Check if a term exists in the vocabulary.
   */
  hasTerm = (term: string): boolean => {
    return this.invertedIndex.has(term.toLowerCase());
  };

  /**
   * Get the IDF value for a term.
   * Returns undefined if term not in vocabulary.
   */
  getIDF = (term: string): number | undefined => {
    return this.invertedIndex.get(term.toLowerCase())?.idf;
  };
}
