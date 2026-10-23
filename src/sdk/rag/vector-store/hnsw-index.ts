/**
 * HNSW (Hierarchical Navigable Small World) Index
 *
 * A graph-based approximate nearest neighbor (ANN) index that achieves
 * O(log n) search time instead of O(n) brute-force.
 *
 * How it works:
 * 1. Vectors are organized in multiple layers (like a skip list)
 * 2. Higher layers have fewer nodes and longer-range connections
 * 3. Search starts at top layer, greedily navigates down
 * 4. At each layer, finds local minimum before descending
 * 5. Bottom layer contains all nodes for final precise search
 *
 * References:
 * - Malkov & Yashunin, "Efficient and robust approximate nearest neighbor search
 *   using Hierarchical Navigable Small World graphs" (2018)
 *
 * @packageDocumentation
 */

import { euclideanDistance } from '../embeddings/utils.js';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration options for the HNSW index.
 */
export interface HNSWConfig {
  /**
   * Maximum number of bi-directional connections per node per layer.
   *
   * Higher M = better recall, more memory, slower insert.
   * - M=4-8: Low memory, good for small datasets
   * - M=12-16: Balanced (recommended)
   * - M=24-48: High recall, large datasets
   *
   * @default 16
   */
  M?: number;

  /**
   * Size of dynamic candidate list during construction.
   *
   * Higher efConstruction = better graph quality, slower insert.
   * - efConstruction=100: Fast construction
   * - efConstruction=200: Balanced (recommended)
   * - efConstruction=400: High quality graph
   *
   * @default 200
   */
  efConstruction?: number;

  /**
   * Size of dynamic candidate list during search.
   *
   * Higher efSearch = better recall, slower search.
   * Must be >= k (number of neighbors requested).
   * - efSearch=16-64: Fast search
   * - efSearch=100: Balanced (recommended)
   * - efSearch=200+: High recall
   *
   * @default 100
   */
  efSearch?: number;
}

/**
 * Resolved HNSW configuration with defaults applied.
 */
interface ResolvedHNSWConfig {
  M: number;
  efConstruction: number;
  efSearch: number;
  mL: number; // Level generation factor: 1 / ln(M)
  maxM0: number; // Max connections at layer 0 (2 * M)
}

/**
 * Result from HNSW search operation.
 */
export interface HNSWSearchResult {
  /** Vector identifier */
  id: string;
  /** Distance to query (lower = closer) */
  distance: number;
}

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Internal node representation in the HNSW graph.
 */
interface HNSWNode {
  /** Unique identifier */
  id: string;
  /** The vector data */
  vector: number[];
  /** Maximum layer this node exists on */
  level: number;
  /** Adjacency lists per layer: neighbors[layer] = Set of neighbor IDs */
  neighbors: Map<string, number>[]; // neighbor ID -> distance
}

/**
 * Priority queue item for beam search.
 */
interface Candidate {
  id: string;
  distance: number;
}

// ============================================================================
// HNSW Index Implementation
// ============================================================================

/**
 * HNSW (Hierarchical Navigable Small World) Index
 *
 * Approximate nearest neighbor index with O(log n) search complexity.
 *
 * @example
 * ```typescript
 * // Create index for 384-dimensional vectors
 * const index = new HNSWIndex(384, {
 *   M: 16,           // 16 connections per node
 *   efConstruction: 200,  // Build quality
 *   efSearch: 100    // Search quality
 * });
 *
 * // Insert vectors
 * index.insert('vec-1', [0.1, 0.2, ...]);
 * index.insert('vec-2', [0.3, 0.4, ...]);
 *
 * // Search for 5 nearest neighbors
 * const results = index.search(queryVector, 5);
 * // [{id: 'vec-1', distance: 0.15}, {id: 'vec-2', distance: 0.23}, ...]
 * ```
 */
export class HNSWIndex {
  /** Vector dimensions */
  readonly dimensions: number;

  /** Resolved configuration */
  private readonly config: ResolvedHNSWConfig;

  /** All nodes by ID */
  private nodes: Map<string, HNSWNode> = new Map();

  /** Entry point node ID (highest level node) */
  private entryPointId: string | null = null;

  /** Current maximum layer in the graph */
  private currentMaxLayer: number = -1;

  /**
   * Create a new HNSW index.
   *
   * @param dimensions - Dimension of vectors to index
   * @param config - HNSW parameters (M, efConstruction, efSearch)
   */
  constructor(dimensions: number, config: HNSWConfig = {}) {
    if (dimensions <= 0) {
      throw new Error(`HNSW dimensions must be positive, got: ${dimensions}`);
    }

    this.dimensions = dimensions;

    const M = config.M ?? 16;
    this.config = {
      M,
      efConstruction: config.efConstruction ?? 200,
      efSearch: config.efSearch ?? 100,
      mL: 1 / Math.log(M), // Level generation factor
      maxM0: 2 * M, // Layer 0 allows 2x connections
    };
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Insert a vector into the index.
   *
   * @param id - Unique identifier for the vector
   * @param vector - The embedding vector
   * @throws Error if vector dimensions don't match
   */
  insert = (id: string, vector: number[]): void => {
    // Validate dimensions
    if (vector.length !== this.dimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.dimensions}, got ${vector.length}`
      );
    }

    // Check for duplicate
    if (this.nodes.has(id)) {
      // Update existing node's vector
      const existing = this.nodes.get(id)!;
      existing.vector = vector;
      return;
    }

    // Generate random level for this node
    const level = this.randomLevel();

    // Create the node
    const node: HNSWNode = {
      id,
      vector,
      level,
      neighbors: Array.from({ length: level + 1 }, () => new Map()),
    };

    // Handle first insertion
    if (this.entryPointId === null) {
      this.nodes.set(id, node);
      this.entryPointId = id;
      this.currentMaxLayer = level;
      return;
    }

    // Get entry point for search
    let currentNodeId = this.entryPointId;

    // Phase 1: Greedy descent from top to node's level + 1
    // Just navigate, don't add connections
    for (let lc = this.currentMaxLayer; lc > level; lc--) {
      currentNodeId = this.greedyClosest(vector, currentNodeId, lc);
    }

    // Phase 2: Insert at each layer from node's level down to 0
    for (let lc = Math.min(level, this.currentMaxLayer); lc >= 0; lc--) {
      // Find ef_construction nearest neighbors at this layer
      const neighbors = this.searchLayer(
        vector,
        currentNodeId,
        this.config.efConstruction,
        lc
      );

      // Select which neighbors to connect (simple: take M closest)
      const maxConnections = lc === 0 ? this.config.maxM0 : this.config.M;
      const selectedNeighbors = this.selectNeighbors(neighbors, maxConnections);

      // Add bidirectional edges
      for (const neighbor of selectedNeighbors) {
        // Add edge from new node to neighbor
        node.neighbors[lc]!.set(neighbor.id, neighbor.distance);

        // Add edge from neighbor to new node (bidirectional)
        const neighborNode = this.nodes.get(neighbor.id)!;
        if (neighborNode.neighbors[lc]) {
          neighborNode.neighbors[lc]!.set(id, neighbor.distance);

          // Prune neighbor's connections if exceeding max
          if (neighborNode.neighbors[lc]!.size > maxConnections) {
            this.pruneConnections(neighborNode, lc, maxConnections);
          }
        }
      }

      // Use closest neighbor as entry for next layer
      if (neighbors.length > 0) {
        currentNodeId = neighbors[0]!.id;
      }
    }

    // Add node to index
    this.nodes.set(id, node);

    // Update entry point if new node has higher level
    if (level > this.currentMaxLayer) {
      this.entryPointId = id;
      this.currentMaxLayer = level;
    }
  };

  /**
   * Search for k nearest neighbors to the query vector.
   *
   * @param query - Query embedding vector
   * @param k - Number of neighbors to return
   * @returns Array of results sorted by distance (ascending)
   * @throws Error if query dimensions don't match
   */
  search = (query: number[], k: number): HNSWSearchResult[] => {
    // Validate dimensions
    if (query.length !== this.dimensions) {
      throw new Error(
        `Query dimension mismatch: expected ${this.dimensions}, got ${query.length}`
      );
    }

    // Handle empty index
    if (this.entryPointId === null || this.nodes.size === 0) {
      return [];
    }

    // Ensure ef >= k
    const ef = Math.max(this.config.efSearch, k);

    // Phase 1: Greedy descent from top to layer 1
    let currentNodeId = this.entryPointId;
    for (let lc = this.currentMaxLayer; lc > 0; lc--) {
      currentNodeId = this.greedyClosest(query, currentNodeId, lc);
    }

    // Phase 2: Search at layer 0 with ef candidates
    const candidates = this.searchLayer(query, currentNodeId, ef, 0);

    // Return top k results
    return candidates.slice(0, k).map((c) => ({
      id: c.id,
      distance: c.distance,
    }));
  };

  /**
   * Delete a vector from the index.
   *
   * Note: HNSW deletion is complex. This implementation uses a "soft delete"
   * approach - the node is removed but graph edges may become stale.
   * For best results, rebuild the index periodically.
   *
   * @param id - Vector identifier to delete
   * @returns true if the vector was deleted, false if not found
   */
  delete = (id: string): boolean => {
    const node = this.nodes.get(id);
    if (!node) {
      return false;
    }

    // Remove edges from neighbors pointing to this node
    for (let lc = 0; lc <= node.level; lc++) {
      const neighbors = node.neighbors[lc];
      if (neighbors) {
        for (const neighborId of neighbors.keys()) {
          const neighborNode = this.nodes.get(neighborId);
          if (neighborNode && neighborNode.neighbors[lc]) {
            neighborNode.neighbors[lc]!.delete(id);
          }
        }
      }
    }

    // Remove the node
    this.nodes.delete(id);

    // Handle entry point deletion
    if (this.entryPointId === id) {
      // Find new entry point (node with highest level)
      let maxLevel = -1;
      let newEntryPoint: string | null = null;

      for (const [nodeId, n] of this.nodes) {
        if (n.level > maxLevel) {
          maxLevel = n.level;
          newEntryPoint = nodeId;
        }
      }

      this.entryPointId = newEntryPoint;
      this.currentMaxLayer = maxLevel;
    }

    return true;
  };

  /**
   * Get the number of vectors in the index.
   */
  size = (): number => {
    return this.nodes.size;
  };

  /**
   * Check if a vector exists in the index.
   *
   * @param id - Vector identifier
   */
  has = (id: string): boolean => {
    return this.nodes.has(id);
  };

  /**
   * Clear all vectors from the index.
   */
  clear = (): void => {
    this.nodes.clear();
    this.entryPointId = null;
    this.currentMaxLayer = -1;
  };

  /**
   * Get the current configuration (for debugging/logging).
   */
  getConfig = (): Readonly<ResolvedHNSWConfig> => {
    return { ...this.config };
  };

  /**
   * Update the search ef parameter (can be adjusted per-search).
   *
   * @param efSearch - New efSearch value
   */
  setEfSearch = (efSearch: number): void => {
    this.config.efSearch = efSearch;
  };

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Generate a random level for a new node.
   *
   * Uses exponential distribution: -log(random) * mL
   * Higher levels are exponentially rarer.
   */
  private randomLevel(): number {
    const random = Math.random();
    // Avoid log(0)
    const r = random === 0 ? Number.MIN_VALUE : random;
    return Math.floor(-Math.log(r) * this.config.mL);
  }

  /**
   * Compute distance between a query and a stored node.
   */
  private distance(query: number[], nodeId: string): number {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return Infinity;
    }
    return euclideanDistance(query, node.vector);
  }

  /**
   * Greedy search to find closest node at a given layer.
   *
   * Used during insertion to navigate to node's level.
   */
  private greedyClosest(
    query: number[],
    entryId: string,
    layer: number
  ): string {
    let currentId = entryId;
    let currentDist = this.distance(query, currentId);

    while (true) {
      let changed = false;

      const currentNode = this.nodes.get(currentId);
      if (!currentNode || !currentNode.neighbors[layer]) {
        break;
      }

      // Check all neighbors at this layer
      for (const neighborId of currentNode.neighbors[layer]!.keys()) {
        const neighborDist = this.distance(query, neighborId);
        if (neighborDist < currentDist) {
          currentId = neighborId;
          currentDist = neighborDist;
          changed = true;
        }
      }

      // Local minimum found
      if (!changed) {
        break;
      }
    }

    return currentId;
  }

  /**
   * Search layer using beam search (ef candidates).
   *
   * Returns up to ef nearest neighbors at the given layer.
   */
  private searchLayer(
    query: number[],
    entryId: string,
    ef: number,
    layer: number
  ): Candidate[] {
    const visited = new Set<string>();
    const entryDist = this.distance(query, entryId);

    // Candidates: nodes to explore (sorted by distance, ascending)
    // Using array + sort (simple) instead of heap for clarity
    const candidates: Candidate[] = [{ id: entryId, distance: entryDist }];

    // Results: best nodes found (sorted by distance, ascending)
    const results: Candidate[] = [{ id: entryId, distance: entryDist }];

    visited.add(entryId);

    while (candidates.length > 0) {
      // Get closest candidate
      const current = candidates.shift()!;

      // Get farthest result
      const farthestResult = results[results.length - 1]!;

      // If closest candidate is farther than farthest result, we're done
      if (current.distance > farthestResult.distance && results.length >= ef) {
        break;
      }

      // Explore current node's neighbors
      const currentNode = this.nodes.get(current.id);
      if (!currentNode || !currentNode.neighbors[layer]) {
        continue;
      }

      for (const neighborId of currentNode.neighbors[layer]!.keys()) {
        if (visited.has(neighborId)) {
          continue;
        }
        visited.add(neighborId);

        const neighborDist = this.distance(query, neighborId);
        const farthestInResults = results[results.length - 1]!;

        // Add to candidates if closer than farthest result (or we have room)
        if (neighborDist < farthestInResults.distance || results.length < ef) {
          candidates.push({ id: neighborId, distance: neighborDist });
          results.push({ id: neighborId, distance: neighborDist });

          // Keep results sorted and limited to ef
          results.sort((a, b) => a.distance - b.distance);
          if (results.length > ef) {
            results.pop();
          }

          // Keep candidates sorted
          candidates.sort((a, b) => a.distance - b.distance);
        }
      }
    }

    return results;
  }

  /**
   * Select neighbors from candidates using the heuristic algorithm.
   *
   * The heuristic promotes diversity by preferring neighbors that are
   * closer to the new node than to already-selected neighbors.
   * This creates more "shortcuts" in the graph and improves recall.
   *
   * Algorithm (from HNSW paper, Algorithm 4):
   * 1. Sort candidates by distance (closest first)
   * 2. For each candidate (in order of distance):
   *    - Check if it's closer to the node than to ALL selected neighbors
   *    - If yes, add to selection
   * 3. Stop when we have M neighbors
   */
  private selectNeighbors(
    candidates: Candidate[],
    maxConnections: number
  ): Candidate[] {
    if (candidates.length <= maxConnections) {
      return candidates;
    }

    // Sort by distance (closest first)
    const sorted = [...candidates].sort((a, b) => a.distance - b.distance);
    const selected: Candidate[] = [];

    for (const candidate of sorted) {
      if (selected.length >= maxConnections) {
        break;
      }

      // Check if this candidate is "diverse" enough
      // It's diverse if it's not too close to any already-selected neighbor
      let isDiverse = true;

      for (const existing of selected) {
        // Compute distance between candidate and existing selection
        const candidateNode = this.nodes.get(candidate.id);
        const existingNode = this.nodes.get(existing.id);

        if (candidateNode && existingNode) {
          const distBetweenSelected = euclideanDistance(
            candidateNode.vector,
            existingNode.vector
          );

          // If candidate is closer to an existing selection than to the query point,
          // it's not diverse enough (it's in the "shadow" of an existing neighbor)
          if (distBetweenSelected < candidate.distance) {
            isDiverse = false;
            break;
          }
        }
      }

      if (isDiverse) {
        selected.push(candidate);
      }
    }

    // If heuristic didn't find enough, fill with closest remaining
    if (selected.length < maxConnections) {
      const selectedIds = new Set(selected.map((s) => s.id));
      for (const candidate of sorted) {
        if (selected.length >= maxConnections) break;
        if (!selectedIds.has(candidate.id)) {
          selected.push(candidate);
        }
      }
    }

    return selected;
  }

  /**
   * Prune a node's connections to stay within max limit.
   *
   * Keeps the closest maxConnections neighbors.
   */
  private pruneConnections(
    node: HNSWNode,
    layer: number,
    maxConnections: number
  ): void {
    const neighbors = node.neighbors[layer];
    if (!neighbors || neighbors.size <= maxConnections) {
      return;
    }

    // Sort by distance and keep closest
    const sorted = [...neighbors.entries()].sort((a, b) => a[1] - b[1]);
    const toRemove = sorted.slice(maxConnections);

    for (const [neighborId] of toRemove) {
      neighbors.delete(neighborId);
    }
  }
}
