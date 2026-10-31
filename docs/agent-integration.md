# Agent Integration Guide

How to use Context Expert (`ctx`) as a tool from AI agents (Claude Code, Codex, OpenCode, etc.).

Every command supports `--json` for structured output except the interactive ones (`ctx chat` and `ctx eval golden capture`). Always use `--json` when calling `ctx` programmatically.

> **Note:** `ctx chat` is designed for interactive human use. Agents should use `ctx ask --json` or `ctx search --json` for programmatic access.

## Quick Start

```bash
npm install -g yodaman-ctx                                     # 1. Install
ctx status --json                                                      # 2. Verify installation
ctx index /path/to/project --name "my-project" --json                  # 3. Index a project
ctx list --json                                                        # 4. Discover indexed projects
ctx check my-project --json                                            # 5. Validate readiness
ctx ask "How does auth work?" --context-only --project my-project --json  # 6. Get RAG context (no model call)
ctx search "auth middleware" --project my-project --json               # 7. Raw hybrid search
```

The `--context-only` flag on `ctx ask` returns XML-formatted code context without making an LLM call — ideal for agents that have their own LLM and just need relevant code snippets injected into their prompt.

---

## Setup

### Requirements

1. Install: `npm install -g yodaman-ctx`
2. For `ctx ask` answers, run [Ollama](https://ollama.com) with a model pulled
   (search and `--context-only` need none). ctx uses local models only, so no
   code or question leaves the machine:
   ```bash
   ollama pull qwen3.5:9b
   ctx config set default_model qwen3.5:9b
   ```
3. Index at least one project:
   ```bash
   ctx index /path/to/project --name "my-project"
   ```

### Verify Installation

```bash
ctx status --json
```

Returns version, database stats, and provider config. If this works, you're ready.

## Recommended Workflow

```
1. ctx status --json          # System health
2. ctx list --json            # Available projects
3. ctx check <project> --json # Pre-flight validation
4. ctx ask "..." --context-only --json --project <name>  # Get context (no model call)
   # or
   ctx ask "..." --json --project <name>  # Full RAG + LLM answer
```

## Command Reference

### `ctx status --json`

System health and version info.

```json
{
  "version": "1.2.0",
  "nodeVersion": "v24.11.0",
  "platform": "darwin",
  "projects": 3,
  "totalChunks": 5432,
  "database": {
    "path": "/Users/you/.ctx/context.db",
    "size": 134217728,
    "sizeFormatted": "128 MB"
  },
  "embedding": {
    "provider": "huggingface",
    "model": "BAAI/bge-large-en-v1.5"
  },
  "llm": {
    "provider": "ollama",
    "model": "qwen3.5:9b"
  },
  "config": {
    "path": "/Users/you/.ctx/config.toml"
  }
}
```

---

### `ctx list --json`

List all indexed projects with metadata.

```json
{
  "count": 2,
  "projects": [
    {
      "id": "uuid-1",
      "name": "backend-api",
      "path": "/home/user/projects/backend",
      "tags": ["typescript", "api"],
      "fileCount": 150,
      "chunkCount": 1200,
      "indexedAt": "2026-01-15T10:00:00.000Z",
      "updatedAt": "2026-01-20T15:30:00.000Z",
      "embeddingModel": "BAAI/bge-large-en-v1.5",
      "embeddingDimensions": 1024,
      "description": "Express API with auth and payments"
    }
  ]
}
```

Key fields for agents:
- `embeddingModel` / `embeddingDimensions` — verify compatibility before querying
- `chunkCount` — 0 means project needs indexing
- `description` — useful for routing queries to the right project

---

### `ctx check <project> --json`

Pre-flight health check. Use before `ctx ask` to avoid wasted LLM calls.

```json
{
  "ready": true,
  "project": {
    "name": "backend-api",
    "path": "/home/user/projects/backend",
    "id": "uuid-1"
  },
  "chunkCount": 1200,
  "embeddingModel": "BAAI/bge-large-en-v1.5",
  "embeddingDimensions": 1024,
  "description": "Express API with auth and payments",
  "issues": [],
  "staleness": {
    "filesChanged": 0,
    "needsReindex": false,
    "pathExists": true
  }
}
```

**`ready` field**: `true` when no error-level issues exist. Warnings (stale files, model mismatch) don't block readiness.

**Exit code**: `1` when `ready` is `false`.

**Possible issues**:

| Severity | Condition | Meaning |
|----------|-----------|---------|
| `error` | `chunkCount === 0` | Project has no indexed content |
| `error` | `pathExists === false` | Source directory was moved/deleted |
| `warning` | Embedding model mismatch | Config model differs from indexed model |
| `warning` | `filesChanged > 0` | Files modified since last index |

---

### `ctx index <path> --json`

Index a project directory for semantic search. Required before any queries can be made against a project.

```bash
ctx index /path/to/project --name "my-project" --json
ctx index /path/to/project --name "my-project" --force --ignore "*.test.ts,fixtures/**" --json
```

| Option | Description |
|--------|-------------|
| `--name, -n` | Project name (defaults to directory name) |
| `--tags, -t` | Comma-separated tags for organization |
| `--force` | Re-index even if project already exists |
| `--ignore` | Comma-separated gitignore-style patterns to exclude |

**Output format**: NDJSON (one JSON object per line). Parse line-by-line, not as a single JSON blob.

**Event progression**:

```
{"type":"model_loading","timestamp":"...","data":{"status":"Loading model..."}}
{"type":"stage_start","timestamp":"...","stage":"scanning","data":{"total":0}}
{"type":"stage_progress","timestamp":"...","stage":"scanning","data":{"processed":1,"total":0,"currentFile":"README.md"}}
{"type":"stage_complete","timestamp":"...","stage":"scanning","data":{"processed":150,"total":150,"durationMs":120}}
{"type":"stage_start","timestamp":"...","stage":"chunking","data":{"total":150}}
{"type":"stage_complete","timestamp":"...","stage":"chunking","data":{"processed":150,"total":150,"durationMs":340}}
{"type":"stage_start","timestamp":"...","stage":"embedding","data":{"total":1200}}
{"type":"stage_progress","timestamp":"...","stage":"embedding","data":{"processed":32,"total":1200}}
{"type":"stage_complete","timestamp":"...","stage":"embedding","data":{"processed":1200,"total":1200,"durationMs":8500}}
{"type":"stage_start","timestamp":"...","stage":"storing","data":{"total":1200}}
{"type":"stage_complete","timestamp":"...","stage":"storing","data":{"processed":1200,"total":1200,"durationMs":200}}
{"type":"complete","timestamp":"...","data":{"result":{...}}}
```

The final `complete` event contains the full pipeline result with project stats. Agents can monitor `stage_start`, `stage_progress` and `stage_complete` events for progress tracking, or simply wait for the `complete` event.

**Exit code**: `0` on success, `1` on failure (project already exists without `--force`, invalid path, etc.).

---

### `ctx ask <question> --json`

Full RAG pipeline: retrieves context, generates LLM answer with citations.

```bash
ctx ask "How does authentication work?" --project backend-api --json
```

```json
{
  "question": "How does authentication work?",
  "answer": "Authentication uses JWT tokens...",
  "sources": [
    {
      "index": 1,
      "filePath": "src/auth/middleware.ts",
      "lineStart": 45,
      "lineEnd": 67,
      "score": 0.92,
      "language": "typescript",
      "fileType": "code"
    }
  ],
  "metadata": {
    "projectSearched": "backend-api",
    "retrievalMs": 150,
    "assemblyMs": 25,
    "generationMs": 2300,
    "totalMs": 2475,
    "tokensUsed": {
      "promptTokens": 800,
      "completionTokens": 150,
      "totalTokens": 950
    },
    "model": "qwen3.5:9b",
    "provider": "ollama"
  }
}
```

**Empty results**: Returns `"answer": null`, `"sources": []`, `"model": null`.

| Option | Description |
|--------|-------------|
| `--project, -p` | Limit to a specific project |
| `--top-k, -k` | Number of chunks to retrieve (default: 5, max: 20) |

---

### `ctx ask <question> --context-only --json`

Retrieves RAG context **without making an LLM call**. Use this when the calling agent has its own LLM and just needs the relevant code context.

```bash
ctx ask "How does authentication work?" --context-only --project backend-api --json
```

```json
{
  "question": "How does authentication work?",
  "context": "<sources>\n  <source id=\"1\" file=\"src/auth/middleware.ts\" lines=\"45-67\" score=\"0.92\">\n    // code content\n  </source>\n</sources>",
  "estimatedTokens": 500,
  "sources": [
    {
      "index": 1,
      "filePath": "src/auth/middleware.ts",
      "lineStart": 45,
      "lineEnd": 67,
      "score": 0.92,
      "language": "typescript",
      "fileType": "code"
    }
  ],
  "metadata": {
    "projectSearched": "backend-api",
    "retrievalMs": 150,
    "assemblyMs": 25,
    "totalMs": 180
  }
}
```

Key differences from full `ctx ask`:
- No `answer` field — returns `context` (XML-formatted) instead
- No `generationMs`, `tokensUsed`, `model`, or `provider` in metadata
- No model call: only the query is embedded, locally

The `context` field contains XML that can be injected directly into your own LLM prompt.

---

### `ctx search <query> --json`

Raw hybrid search without LLM generation. Returns matching code chunks.

```bash
ctx search "authentication middleware" --project backend-api --json
```

```json
{
  "query": "authentication middleware",
  "count": 5,
  "projectsSearched": ["backend-api"],
  "results": [
    {
      "score": 0.92,
      "filePath": "src/auth/middleware.ts",
      "lineStart": 45,
      "lineEnd": 67,
      "content": "export function authenticate(req, res, next) { ... }",
      "language": "typescript",
      "fileType": "code"
    }
  ]
}
```

When more than one project is searched (no `--project`), each result also has `projectId` and `projectName`.

| Option | Description |
|--------|-------------|
| `--project, -p` | Limit to a specific project |
| `--top, -k` | Number of results (default: 10) |
| `--rerank, -r` | Apply BGE cross-encoder reranking |

---

### `ctx remove <name> --force --json`

Delete a project index. **Requires `--force`** in both text and JSON modes.

```bash
ctx remove old-project --force --json
```

**Success** (exit code 0):
```json
{
  "success": true,
  "project": {
    "id": "uuid-1",
    "name": "old-project",
    "path": "/home/user/projects/old"
  },
  "deleted": {
    "chunks": 500,
    "fileHashes": 150
  },
  "storageFreed": 1024000
}
```

**Without `--force`** (exit code 1, written to stderr):
```json
{
  "error": "confirmation_required",
  "action": "remove",
  "project": {
    "name": "old-project",
    "path": "/home/user/projects/old",
    "chunkCount": 500,
    "fileCount": 150
  },
  "hint": "Use --force to confirm deletion"
}
```

---

### `ctx config` subcommands

```bash
ctx config get default_model --json     # {"key":"default_model","value":"qwen3.5:9b"}
ctx config set search.top_k 20 --json   # {"success":true,"key":"search.top_k","value":20}
ctx config list --json                  # {"default_model":"...","embedding.provider":"..."}
ctx config path --json                  # {"path":"/Users/you/.ctx/config.toml"}
ctx config reset --force --json         # {"success":true,"message":"Configuration reset to defaults"}
```

`config reset` deletes your configuration, so like `remove` it requires `--force`; without it, it exits 1 with `{"error":"confirmation_required",...}` on stderr.

---

## Eval Commands

Eval commands follow the same `--json` pattern. Use them for quality gates in agent workflows.

### `ctx eval run --project <name> --json`

Run batch evaluation against a golden dataset. Use as a quality gate after modifying search or indexing code.

```json
{
  "run_id": "a1b2c3d4-...",
  "project_name": "my-project",
  "timestamp": "2026-02-17T10:30:00.000Z",
  "query_count": 10,
  "metrics": {
    "mrr": 0.850,
    "precision_at_k": 0.700,
    "recall_at_k": 0.800,
    "hit_rate": 0.900,
    "ndcg": 0.820,
    "map": 0.780
  },
  "thresholds": { "mrr": 0.7, "hit_rate": 0.85, "precision_at_k": 0.6 },
  "passed": true,
  "comparison": {
    "previous_run_id": "e5f6g7h8-...",
    "metric_changes": {
      "mrr": 0.050,
      "precision_at_k": 0.010,
      "recall_at_k": 0.000,
      "hit_rate": -0.020,
      "ndcg": 0.030,
      "map": 0.020
    }
  },
  "regressions": [],
  "improvements": ["MRR"]
}
```

Key fields for agents:
- `passed` — `true` when all threshold metrics meet or exceed targets
- `regressions` — metric names that dropped by > 5 percentage points
- `comparison.metric_changes` — signed deltas vs previous run (positive = improvement)

---

### `ctx eval report --project <name> --json`

Get trend analysis across recent eval runs.

```json
{
  "project_name": "my-project",
  "run_count": 5,
  "current_run_id": "a1b2c3d4-...",
  "previous_run_id": "e5f6g7h8-...",
  "trends": [
    {
      "metric": "mrr",
      "current": 0.85,
      "previous": 0.80,
      "delta": 0.05,
      "direction": "stable",
      "is_regression": false,
      "is_improvement": false
    }
  ],
  "has_regressions": false,
  "has_improvements": false
}
```

Use `has_regressions` for automated quality gates. The `trends` array provides per-metric detail.

---

### `ctx eval traces --json`

List recent interaction traces. Useful for debugging search quality issues.

```bash
ctx eval traces --project my-project --limit 5 --since 7d --type ask --json
```

```json
{
  "count": 5,
  "traces": [
    {
      "id": "uuid",
      "project_id": "uuid",
      "query": "How does auth work?",
      "timestamp": "2026-02-17T10:30:00.000Z",
      "retrieved_files": ["src/auth/middleware.ts"],
      "top_k": 5,
      "latency_ms": 150,
      "answer": "Authentication uses JWT...",
      "retrieval_method": "fusion",
      "feedback": null,
      "metadata": {
        "model": "ollama/qwen3.5:9b",
        "retrievalMs": 150,
        "assemblyMs": 1,
        "generationMs": 2300,
        "tokensUsed": { "prompt": 800, "completion": 150, "total": 950 }
      },
      "langfuse_trace_id": null,
      "trace_type": "ask"
    }
  ]
}
```

| Option | Description |
|--------|-------------|
| `--project, -p` | Filter by project name |
| `--limit, -l` | Maximum traces (default: 20) |
| `--since, -s` | Recency filter: `7d`, `24h`, `2w` |
| `--type, -t` | Trace type: `ask`, `search`, `chat` |

---

### `ctx eval golden list --project <name> --json`

List golden dataset entries for a project.

```json
{
  "count": 10,
  "entries": [
    {
      "id": "uuid",
      "query": "How does authentication work?",
      "expectedFilePaths": ["src/auth/middleware.ts"],
      "tags": ["auth"],
      "source": "manual"
    }
  ]
}
```

`expectedAnswer` and `tags` appear only on entries that have them.

For full eval documentation, see the [Eval & Observability Guide](./eval-observability.md).

---

## Error Handling

All errors write JSON to **stderr** (not stdout) when `--json` is active.

```json
{
  "error": "Project not found: nonexistent",
  "code": 1,
  "hint": "Run: ctx list  to see available projects"
}
```

With `--verbose --json`, a `stack` field is added:

```json
{
  "error": "Project not found: nonexistent",
  "code": 1,
  "hint": "Run: ctx list  to see available projects",
  "stack": "CLIError: Project not found...\n    at resolveProject..."
}
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error, confirmation required, or project not ready |
| `2` | Configuration error (for example an invalid `~/.ctx/config.toml`) |
| `5` | Database error |

`ctx eval run` exits `0` even when a quality threshold fails; check its `passed` field.

Check both exit code and parse stdout/stderr for complete status.

## Example: CLAUDE.md Snippet

Add this to your project's `CLAUDE.md` to give Claude Code access to your indexed codebases:

```markdown
## Context Expert

Cross-project semantic search and RAG-powered Q&A via `ctx` CLI.

### Quick Reference
- System health: `ctx status --json`
- List projects: `ctx list --json`
- Index a project: `ctx index /path/to/project --name "name" --json`
- Validate readiness: `ctx check my-project --json`
- Get RAG context: `ctx ask "question" --context-only --project my-project --json`
- Search code: `ctx search "query" --project my-project --json`
- Full Q&A: `ctx ask "question" --project my-project --json`
- Run evaluation: `ctx eval run --project my-project --json`
- Eval trends: `ctx eval report --project my-project --json`
- View traces: `ctx eval traces --project my-project --json`
- Golden entries: `ctx eval golden list --project my-project --json`

### Key Flags
- `--context-only` — Returns XML-formatted code context without LLM call (inject directly into your prompt)
- `--ignore "pattern1,pattern2"` — Exclude files during indexing (gitignore syntax)
- `--force` — Re-index a project, replacing existing data

### Recommended Workflow
1. `ctx check <project> --json` — Verify project is ready
2. `ctx ask "question" --context-only --project <name> --json` — Get context
3. Use the `context` field from the response as RAG context in your own prompt
4. After code changes: `ctx eval run --project <name> --json` — Check `passed: true`
```
