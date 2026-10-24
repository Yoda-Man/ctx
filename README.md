<p align="center">
  <img src="docs/assets/ctx-logo.svg" alt="ctx" width="440">
</p>

<p align="center">
  <strong>Semantic search and grounded answers across all your codebases, from the terminal.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/yodaman-ctx"><img src="https://img.shields.io/npm/v/yodaman-ctx.svg" alt="npm version"></a>
  <a href="https://github.com/Yoda-Man/ctx/actions/workflows/ci.yml"><img src="https://github.com/Yoda-Man/ctx/actions/workflows/ci.yml/badge.svg?branch=dev" alt="CI"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/yodaman-ctx.svg" alt="Node.js"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="MIT License"></a>
</p>

`ctx` indexes your projects once, then answers questions about them: find code
by what it does, not by what it is called, and ask questions that come back
with the files and lines they are based on. Everything runs on your machine:
local embeddings for search, and a local model through Ollama for answers. No
code, question or answer is ever sent to a cloud service.

It is the search engine behind [YodaMan](https://github.com/Yoda-Man/yodaman),
and works just as well on its own.

<p align="center">
  <img src="docs/assets/screenshot-search.svg" alt="ctx search: hybrid results with file, line and score" width="820">
</p>

## Highlights

| | |
|---|---|
| **Hybrid search** | Dense vectors and BM25 keyword search, merged with Reciprocal Rank Fusion, then reranked by a BGE cross-encoder. |
| **Grounded answers** | `ctx ask` and `ctx chat` retrieve first, then answer with citations to the files and lines used. |
| **Across projects** | Index any number of codebases and search one of them or all at once; `ctx chat` routes each question to the projects it is about. |
| **Code-aware chunks** | Tree-sitter splits TypeScript, JavaScript and Python by function and class, not by line count. |
| **Local by default** | BGE embeddings run on your machine; models are cached in `~/.ctx/models` and survive reinstalls. |
| **Private** | Answers come from a local Ollama model; ctx has no cloud provider and needs no API key. |
| **Built to be scripted** | Every command except the interactive `ctx chat` has `--json` output, made for agents and tools such as YodaMan. |
| **Measured, not guessed** | `ctx eval` scores retrieval against a golden dataset (MRR, hit rate, precision, NDCG) and tracks regressions. |
| **Current** | Every dependency is on its latest release, checked in CI and before every publish. |

## Install

```bash
npm install -g yodaman-ctx --allow-scripts=better-sqlite3,protobufjs,sharp,tree-sitter,tree-sitter-javascript,tree-sitter-python,tree-sitter-typescript,onnxruntime-node
```

Requires **Node.js 22.12** or later. The `--allow-scripts` list lets npm 11.20
and later build ctx's native parts (SQLite, the tree-sitter parsers, the ONNX
runtime); earlier npm builds them anyway and ignores the flag.

The first search downloads the embedding and reranker models (about 600 MB)
into `~/.ctx/models`; after that, everything runs offline.

## Quick start

```bash
# 1. Index a project
ctx index ~/code/my-app --name my-app

# 2. Search it by meaning
ctx search "where are sessions refreshed" -p my-app

# 3. Ask a question, answered from the code with citations
ctx ask "How does the authentication flow work?" -p my-app

# 4. Or talk it through
ctx chat
```

For answers, run [Ollama](https://ollama.com) with a model pulled (see
[Local models only](#local-models-only)). Search needs no model at all.

<p align="center">
  <img src="docs/assets/screenshot-ask.svg" alt="ctx ask: an answer with numbered sources" width="820">
</p>

## How it works

```
 index   files ──► tree-sitter chunks ──► local BGE embeddings ──► SQLite (~/.ctx)

 search  query ──┬─► dense vectors ─┐
                 └─► BM25 keywords ─┴─► rank fusion ──► BGE reranker ──► results

 ask     results ──► context assembly ──► local model (Ollama) ──► answer with sources
```

## Commands

### `ctx index <path>`

Index a project directory for semantic search.

```bash
ctx index ./my-project --name "backend-api"
ctx index ~/code/frontend --name "frontend" --tags "react,typescript"
ctx index . --force  # Re-index, replacing existing data
```

| Option | Description |
|--------|-------------|
| `--name, -n` | Project name (defaults to directory name) |
| `--tags, -t` | Comma-separated tags, shown by `ctx list` and used by `ctx chat` to route questions |
| `--force` | Replace existing index for this project |
| `--ignore` | Comma-separated gitignore-style patterns to exclude |

### `ctx list`

List all indexed projects with statistics.

```bash
ctx list
```

Shows each project's name, path, file and chunk counts, and when it was last updated.

### `ctx search <query>`

Perform hybrid semantic search across indexed projects.

```bash
ctx search "error handling"
ctx search "database connection" --project backend-api
ctx search "authentication" --top 20 --rerank
```

| Option | Description |
|--------|-------------|
| `--project, -p` | Limit search to specific project |
| `--top, -k` | Number of results (default: 10) |
| `--rerank, -r` | Rerank with the BGE cross-encoder (on by default through `search.rerank`) |

### `ctx ask <question>`

Ask a question and get a RAG-powered answer with citations.

```bash
ctx ask "How does the payment processing work?"
ctx ask "What API endpoints handle user auth?" --project backend
ctx ask "Explain the caching strategy" --top-k 15 --json
```

| Option | Description |
|--------|-------------|
| `--project, -p` | Limit context to specific project |
| `--top-k, -k` | Number of chunks to retrieve (default: 5) |
| `--context-only` | Return retrieved context without LLM generation |
| `--json` | Output structured JSON response |

### `ctx chat`

Start an interactive REPL for multi-turn conversations.

```bash
ctx chat
```

**REPL Commands:**

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/focus <project>` | Focus RAG search on a specific project |
| `/unfocus` | Clear project focus |
| `/projects` | List all indexed projects |
| `/describe <name> ["description"] [--tags a,b]` | Add a description and tags that `ctx chat` uses to route questions |
| `/clear` | Clear conversation history |
| `/share [path]` | Export conversation to markdown |
| `/index <path> [-n name] [--force]` | Index a project within the chat session (`/index status` shows progress) |
| `/exit` | Exit the chat |

#### TUI Mode

On TTY terminals, `ctx chat` launches in **TUI mode** by default: a three-region terminal layout with independent scrolling:

| Region | Description |
|--------|-------------|
| **Chat area** | Scrollable message history and streaming LLM responses |
| **Status bar** | Model name, working directory and git branch, context gauge, turn counter, current activity |
| **Input area** | readline-powered input with tab completion |

Use `--no-tui` to fall back to the classic readline REPL (also used automatically when stdout is not a TTY, e.g., piping):

```bash
ctx chat --no-tui
```

### `ctx config`

Manage configuration settings.

```bash
ctx config list              # Show all settings
ctx config get default_model # Get specific setting
ctx config set default_model qwen3.5:9b  # Update setting
```

### `ctx status`

Show storage statistics and system health.

<p align="center">
  <img src="docs/assets/screenshot-status.svg" alt="ctx status: projects, chunks, models and storage" width="820">
</p>

```bash
ctx status
```

Displays database size, total chunks, project count, and embedding model info.

### `ctx check <project>`

Pre-flight health check for a project's index readiness.

```bash
ctx check backend-api
ctx check backend-api --json
```

Checks that the project exists, has indexed chunks, the source path is on disk, and the embedding model matches current config. Returns `ready: true/false` in JSON mode. Exit code `1` when not ready.

### `ctx remove <name>`

Delete an indexed project and all its data. Requires `--force` to confirm.

```bash
ctx remove old-project --force
ctx remove old-project --force --json
```

| Option | Description |
|--------|-------------|
| `--force, -f` | Confirm deletion (required) |

### `ctx eval`

Evaluation and observability commands for measuring and monitoring retrieval quality. See the [Eval & Observability Guide](./docs/eval-observability.md) for full documentation.

```bash
# Manage golden dataset
ctx eval golden add --project my-project
ctx eval golden generate --project my-project --count 5
ctx eval golden list --project my-project

# Run evaluation
ctx eval run --project my-project

# View results
ctx eval report --project my-project
ctx eval traces --since 7d
```

| Subcommand | Description |
|------------|-------------|
| `eval run` | Run batch evaluation against golden dataset |
| `eval report` | Show eval run history with trend arrows |
| `eval traces` | List recent interaction traces |
| `eval golden list` | List golden dataset entries |
| `eval golden add` | Add a golden entry manually |
| `eval golden capture` | Promote traces to golden entries |
| `eval golden generate` | Generate golden entries using LLM |

## Configuration

Configuration is stored in `~/.ctx/config.toml`. The database is stored in `~/.ctx/context.db`.

### Environment Variables

```bash
# Optional: where Ollama runs (default http://localhost:11434)
export OLLAMA_HOST=http://localhost:11434
```

### Config File

```toml
# ~/.ctx/config.toml

# LLM settings
default_model = "llama3.2"     # any model you have pulled in Ollama
default_provider = "ollama"     # always ollama: ctx uses local models only

# Embedding settings (local by default)
[embedding]
provider = "huggingface"
model = "BAAI/bge-large-en-v1.5"
batch_size = 32
timeout_ms = 120000              # Embedding timeout (default: 2 min)
# fallback_provider = "ollama"   # Fallback if primary fails
# fallback_model = "mxbai-embed-large"  # must also give 1024 dimensions

# Search settings
[search]
top_k = 10
rerank = true  # Use BGE cross-encoder

# RAG pipeline settings (optional - these are defaults)
[rag]
max_tokens = 4000       # Max tokens of code context given to the model
final_k = 5             # Chunks included in the context
ordering = "sandwich"   # Context ordering: sandwich, chronological, relevance

# Indexing settings (optional)
[indexing]
ignore_patterns = ["*.generated.ts", "migrations/**"]  # Additional gitignore-style patterns

# Evaluation settings (optional)
[eval]
golden_path = "~/.ctx/eval"
default_k = 5

[eval.thresholds]
mrr = 0.7
hit_rate = 0.85
precision_at_k = 0.6

# Observability settings (optional)
[observability]
enabled = true
sample_rate = 1.0
```

## Local models only

ctx is private by design: your code, questions and answers never leave your
machine. Embeddings and reranking run in process, and answers come from a
local model through [Ollama](https://ollama.com). There is no cloud provider
to configure and no API key to set.

```bash
ollama pull qwen3.5:9b
ctx config set default_model qwen3.5:9b
```

Any model you have pulled works; `ollama list` shows them. Set `OLLAMA_HOST` if
Ollama is not at `http://localhost:11434`.

## Development

```bash
# Clone and install
git clone https://github.com/Yoda-Man/ctx.git
cd ctx
npm install

# Build
npm run build

# Run tests
npm test

# Run CLI locally
npm run start -- index ./test-project
```

### Project Structure

```
src/
├── cli/            # Commands + TUI (controller, chat-area, status-line, input)
├── agent/          # RAG engine, ReAct chat agent, query routing, tools
├── search/         # Hybrid search: dense, BM25, fusion, reranking
├── indexer/        # File scanning, chunking (Tree-sitter), embedding pipeline
├── database/       # SQLite schema, operations, migrations
├── eval/           # Golden datasets, batch evaluation, metrics
├── observability/  # Whether to record an interaction locally
├── providers/      # The local Ollama model
├── sdk/            # The parts of the ContextAI SDK ctx uses (vendored)
├── config/         # TOML config loading with Zod validation
├── errors/         # Custom error classes and handler
└── utils/          # Logging, path validation, table formatting
```

## Use with YodaMan

[YodaMan](https://github.com/Yoda-Man/yodaman) runs every search through ctx,
then ranks the results with its Graphify knowledge graph and tags them with
OpenSpec specs. YodaMan installs ctx for you (`yodaman setup`, or Repair on its
Dashboard) and works with the same `~/.ctx` index, so projects indexed here are
searchable there.

## Agent Integration

Every command except the interactive `ctx chat` supports `--json` for structured output, making ctx a first-class tool for AI agents (Claude Code, Codex, OpenCode, etc.). See the [Agent Integration Guide](./docs/agent-integration.md) for JSON response schemas, recommended workflows, and error handling.

## Evaluation & Observability

Measure retrieval quality with golden datasets and track every interaction with built-in observability. See the [Eval & Observability Guide](./docs/eval-observability.md) for setup, configuration, and the full command reference.

## Contributing

Issues and pull requests are welcome at
[github.com/Yoda-Man/ctx](https://github.com/Yoda-Man/ctx). Open pull requests
against `dev`; CI runs the type check, tests and build on Node 22, 24 and 26,
and fails if any dependency is behind its latest release.

## License

[MIT](LICENSE). Copyright (c) 2026 YodaMan.

