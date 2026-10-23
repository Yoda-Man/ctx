/**
 * Vendored from @contextaisdk/rag (MIT, github.com/draco28/contextai); see ../LICENSE.
 * Only what ctx uses is kept. Exported from where each name is defined.
 */
export { AdaptiveRAG } from './adaptive/adaptive-rag.js';
export type { AdaptiveRAGResult } from './adaptive/types.js';
export type { AssembledContext, OrderingStrategy, SourceAttribution } from './assembly/types.js';
export { XMLAssembler } from './assembly/xml-assembler.js';
export { LRUCacheProvider } from './cache/lru-cache.js';
export { RecursiveChunker } from './chunking/recursive-chunker.js';
export { SemanticChunker } from './chunking/semantic-chunker.js';
export { CachedEmbeddingProvider } from './embeddings/cache.js';
export { HuggingFaceEmbeddingProvider } from './embeddings/huggingface-provider.js';
export { OllamaEmbeddingProvider } from './embeddings/ollama-provider.js';
export type { EmbeddingProvider, EmbeddingResult } from './embeddings/types.js';
export { RAGEngineImpl } from './engine/rag-engine.js';
export type { RAGResult, RAGSearchMetadata, RAGTimings } from './engine/types.js';
export type { Document } from './loaders/types.js';
export { BGEReranker } from './reranker/bge-reranker.js';
export { BM25Retriever } from './retrieval/bm25.js';
export { DenseRetriever } from './retrieval/dense-retriever.js';
export { DEFAULT_RRF_K, reciprocalRankFusion } from './retrieval/rrf.js';
export type { RankingList } from './retrieval/rrf.js';
export type { BM25Document, RetrievalOptions, RetrievalResult, Retriever } from './retrieval/types.js';
export { InMemoryVectorStore } from './vector-store/memory-store.js';
export type { Chunk, MetadataFilter, SearchOptions } from './vector-store/types.js';
