# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-10-30

### Added
- **Linting with oxlint**, type-aware (it runs on TypeScript 7's own engine,
  which ESLint's TypeScript support cannot yet use), in CI and before every
  publish: `npm run lint`. Dev dependencies only.
- **Tests are type-checked** (`npm run typecheck`, in CI and before every
  publish). They were excluded before and had drifted: 165 errors, including
  mocks of options and config fields that no longer exist.
- **Tests run in a temporary home folder**, so they can't read or write a
  developer's real `~/.ctx` (one test that mocked the database path but not
  the connection wrote 2,500 chunks into it).

### Changed
- **Re-index your projects after upgrading** (`ctx index <path> --force`):
  code and Markdown are now split differently (see Fixed), and line numbers
  in older indexes can be off.
- **Search scores run from 0 to 1** again: 1 means ranked first by both
  keyword and vector search, about 0.5 first by one of them. Without the
  reranker they showed raw fusion values near 0.03, and a `minScore` above
  that dropped every result.
- **Requires Node.js 24** (was 22.12), for unpdf 2, which reads PDFs and no
  longer runs on Node 22. CI tests Node 24 and 26.
- **Reranking is opt-in:** `ctx search --rerank`. On 42 questions over two
  projects, each scored by whether the chunk holding the answer came back,
  hybrid search alone put the answer first more often (45% against 26%; mean
  reciprocal rank 0.56 against 0.45). The cross-encoder helped prose answers
  but ranked Markdown tables and code low. `ctx search`, `ask` and `chat` no
  longer rerank, and the first search no longer downloads the 280 MB reranker.
  The `search.rerank` setting is retired: the `rerank = true` line every
  generated config.toml carries is ignored without a warning.
- Dependencies: @huggingface/transformers 4.3.2, marked 18.1.2, unpdf 2.1.0.
- One shared `errorMessage()` / `toError()` helper replaces 33 hand-written
  copies, and error messages no longer print `[object Object]` for a thrown
  value that is not an Error.
- `ctx chat`'s code is split by job: commands, `/index`, questions, shared
  state, and the session itself. 21 new tests cover the slash commands against
  a real database.

### Removed
- **The `dotenv` dependency.** Node reads `.env` itself (`process.loadEnvFile`,
  Node 20.12+); values already in the environment still win, and a missing
  `.env` is still fine. 17 runtime dependencies remain.
- **Trace feedback**, which nothing could set: the "Fb" column in
  `ctx eval traces` was always empty and filtering traces by feedback never
  matched. The `feedback` column stays in the database, always null.
- The chat status bar's agent "mode", which was set once and never shown,
  descriptions for seven tools ctx's agent does not have, and a source list in
  the chat window that nothing filled (`ctx chat` prints citations itself).
- Rethrow-only `try`/`catch` blocks, unused imports and helpers in tests, and
  an unused database row schema.
- **Adaptive RAG** (about 1,400 lines). In `ctx chat` it labelled each
  search query and skipped retrieval for "simple" ones: any query of four
  words or fewer, such as "auth middleware" or "Why?". The agent writes
  short keyword queries, and it only searches when it has decided it needs
  to, so those searches came back empty.
- **The HNSW index**, used only for projects of 250,000 chunks or more. ctx
  builds its search index in every process, so HNSW was rebuilt on every
  search (8.3 seconds for 3,714 vectors), held a second copy of every vector,
  and a narrow `--language` or `--file-type` filter could return few or no
  results. Exact search scans 58,728 vectors in 43 ms.
- The agent's retry and circuit-breaker layer (four files). It only ran when
  given a setting that ctx never passed.
- `ctx chat`'s old question path, kept as a fallback for when the agent could
  not start; the agent always starts, so it never ran. Also tests that only
  checked `process.stdout.write` itself, and one that ran its own SQL instead
  of the method it named.

### Fixed
- **Code indexing kept only functions and classes.** Constants, exported
  values, module setup and `if __name__ == "__main__":` blocks were in no
  chunk, so ctx could not find them; chunks also lost their `export` keyword
  and their doc comments, and nested functions were indexed twice. Each file
  is now split at its top-level statements: a definition with its comments,
  decorators and `export`, and the code between definitions, so every line
  is indexed once. On 42 code questions over ctx and a Python game, 23
  answers were in no chunk at all; now every one is, and the answer is in
  the top 5 results for 69% of questions instead of 21%.
- **Files in other languages (Go, Rust, Java and the rest) lost their code**
  when they had a block comment: only the comments were indexed. The whole
  file is now indexed.
- **Markdown headings were indexed apart from their text**, so a table or
  list was found without its title, and each paragraph became its own chunk.
  A document is now split by section, heading included. On 50 mixed
  questions the answer is in the top 5 for 78% instead of 60%; for answers in
  a table, 94% instead of 83%.
- **Searching many projects took about 30 seconds** the first time in a
  session (27 s across 14 projects and 58,700 chunks; 16 s to load one
  23,000-chunk project), long enough for `ctx chat` to give up. Chunks were
  read with paging that re-read every earlier row. The same search now takes
  5 s, and that project loads in 0.6 s.
- **Piped input to `ctx chat`** (`echo "question" | ctx chat --no-tui`)
  failed with "readline was closed": every line ran at once, so `/exit` or
  the end of input closed the chat under a question still being answered.
  Lines now run in order, including a question typed while one is answered.
- **The index summary said "Database size: +0 B"**: new data waits in
  SQLite's write-ahead log, which wasn't counted. `ctx status` now counts it
  too.
- **One failed embedding call while chunking a document aborted the whole
  index.** That document is now split by size instead, with a warning.
- A text repeated within one embedding batch was embedded twice.
- **The first `ctx index` on a new install failed** with "no such table:
  projects": it looked for an existing project before creating the database
  tables.
- **`ctx chat` answers from the focused project.** A question that did not
  say "this project" ignored `/focus`. ctx asked the model to pick projects;
  a local model often took longer than the 5 second limit, and ctx then
  searched every indexed project. With a dozen projects that took about 50
  seconds, past the 30 second tool limit, so the answer had no sources.
  General questions now stay in the focused project (in one test, 8 sources in
  0.25 seconds instead of none in 48). Naming another project or asking about
  all of them still searches those.
- The agent is told which project is focused, or which projects exist, so
  "what is this project?" searches instead of asking which project.
- A search that fails now says why in the chat, instead of
  "Found 0 sources".
- **`--rerank` works.** The BGE cross-encoder was given the query without the
  document, so every result scored the same (0.73) and the order never
  changed, while still costing a model pass per result. It now scores each
  query and document pair, and the reported scores reflect relevance.
- The embedding cache keyed vectors by a 32-bit hash of the text, so two
  texts could share one vector (the first collision appeared after about
  10,500 snippets). It now keys by the text itself.
- Long docs sections are chunked correctly:
  - Text with no full stops, such as a large table or list, became one chunk
    of any size. It is now split at line breaks, and a single huge line by
    length, without cutting an emoji in half.
  - Merging a small last piece could push a chunk over the size limit.
  - Chunks lost their line breaks (sentences were joined with spaces), which
    flattened code and tables in docs and could give a chunk the wrong line
    numbers.
- Repeated text gets its own line numbers: a chunk whose text also appeared
  earlier in the file was given the earlier copy's lines.
- `/index` in `ctx chat`:
  - A forced re-index that fails no longer leaves the project empty. The old
    index stays searchable until the new one is ready, as with `ctx index`.
  - Re-indexing a project whose folder moved no longer fails on its name.
  - The chat now searches a project it just indexed. Before, the agent kept
    the previous focus, and a chat started with nothing indexed could not
    search at all until restarted.
- The docs: the index event list gains `stage_progress`, the exit codes add 2
  (configuration) and 5 (database), the `eval run`, `eval traces` and
  `golden list` examples show the fields ctx actually returns, unfocused
  `ctx chat` turns are no longer said to be recorded, and the CI recipe no
  longer needs a script that is not in the package. The TUI decision record
  describes the status bar as it is and links the right specifications.

## [1.1.0] - 2026-10-26

### Added
- **Word and PDF documents are indexed.** `.docx` files are converted to
  Markdown (headings, lists and tables kept) and `.pdf` files to their text,
  on this machine, before indexing, so specs written in either can be searched
  and answer `ctx ask`. A document with no text, such as a scanned PDF, is
  reported with a warning rather than skipped silently. The file limit applies to the converted text,
  not to the file. New dependencies: `mammoth`, `turndown`, `unpdf`.

### Changed
- Files up to 750 KB are indexed (was 500 KB); larger ones are still skipped
  with a warning.

### Fixed
- **`ctx index` kept running for two minutes after it had finished.** Every
  embedding batch started a timeout timer (`embedding.timeout_ms`, 120 s by
  default) that was never cleared, so the process waited for the last one
  before exiting. Indexing three PDFs took 121 s from start to exit; it now
  takes 10 s. This also held up YodaMan, which waits for `ctx index` to exit.
- **Re-indexing a project from a different folder failed after doing all the
  work.** `ctx index <new folder> --name <existing project> --force` chunked
  and embedded every file, then stopped on "UNIQUE constraint failed:
  projects.name". Projects are now matched by name as well as folder: with
  `--force` the project is re-indexed from the new folder, and without it ctx
  says so before indexing starts.

## [1.0.0] - 2026-10-23

First release of `yodaman-ctx`, YodaMan's fork of `@contextexpert/cli` 1.4.0
(the entries below that are its history). The `ctx` command and the `~/.ctx`
index and database are unchanged. ctx is now private by design: it answers
only with a local Ollama model, and nothing is sent to a cloud service.

### Fixed
- **`ctx ask` failed with "Failed to connect to Ollama server: Cannot read
  properties of undefined (reading 'content')" while Ollama was running.**
  Ollama reports a failure mid-stream as a line with `error` and no `message`
  (`{"error":"EOF"}`, seen with qwen3.5:9b when a prompt contains
  `<tool_call>`); reading `message.content` on it threw, and every `TypeError`
  was reported as a connection failure. The stream now ends with Ollama's own
  message ("Ollama stopped generating: EOF"), and only fetch's network
  failures count as connection errors.
- **`ctx ask` cited every source at line 0**, with no language and file type
  "unknown", in its answers and in `--context-only` JSON, and the XML context
  had no line range. The line range, language and file type were dropped on
  the way from search results to sources; sources now carry them, and each
  `<source>` has `location="lines 42-67"`.
- `ctx chat`'s `/share` export linked to a repository that does not exist.
- **`[observability] enabled = false` did not stop recording.** The setting
  was never read, so every `ask`, `search` and `chat` was still written to
  the local trace table. It now turns recording off.
- **`ctx config reset --json` deleted the configuration without `--force`.**
  It now requires `--force` in every mode, as `ctx remove` does, and without
  it reports `confirmation_required`.
- Every command printed `◇ injected env (0) from .env` (dotenv's notice) to
  stderr, and `ctx --help` linked to a placeholder repository.
- **Several ctx processes started together each downloaded the same model.**
  Every one fetched hundreds of MB into its own temp file; five at once split
  the bandwidth and none finished. The first now downloads while the others
  wait and then load it from disk, via a per-model lock in
  `~/.ctx/models/.locks` (taken over if its process has exited). A model
  already on disk takes no lock, so parallel searches never wait.
- **A reranker model that could not load failed the whole search.** Reranking
  only refines the order, so when its model cannot load (offline, or a
  download cut off: "Failed to load model ...: terminated") ctx now warns once
  and returns results in their search order.
- **ctx crashed on start after a fresh install.** OpenTelemetry api 1.10
  (2026-10-20) made a fresh install resolve telemetry packages that require it
  alongside ones that reject it, and the crash happened at startup even with
  tracing off. Fixed by removing cloud tracing (below).
- **Models were re-downloaded after every reinstall.** They are now stored in
  `~/.ctx/models`, not inside the package folder.
- A config test read the real `~/.ctx/config.toml` and failed on any machine
  whose config set a model.

### Removed
- **Cloud models: Anthropic (Claude), OpenAI and OpenAI-compatible APIs**,
  with the `@anthropic-ai/sdk` and `openai` packages, the `/provider` command
  in `ctx chat` and the fallback between providers. Answers come from a local
  Ollama model (`default_model`, default `llama3.2`). A config that still names
  a cloud `default_provider` is ignored with a warning, together with its
  model, and the `[llm]` fallback section is ignored. API keys are no longer
  read, and `~/.ctx/providers.json` is no longer used (it may hold API keys
  in plain text; delete it if you no longer need them).
- **`ctx eval run --ragas`**, which sent questions, answers and code to OpenAI
  to judge answer quality, with the `eval.python_path` and `eval.ragas_model`
  settings. Retrieval metrics are unchanged.
- **`[rag] retrieve_k` and `enhance_query`**, which did nothing: retrieval
  always used `final_k`, and no query enhancer was ever set up. The engine
  stages behind them (query enhancement, a second reranker, LLM
  verification) never ran and are gone too; search reranking is unchanged.
  The settings are ignored with a warning if still in a config.
- **The session cost in `ctx chat`'s status bar**, always $0.00 with local
  models.
- **The tracer layer** that `ask`, `search` and `chat` called on every run:
  with cloud tracing gone it did nothing. Local recording to SQLite is
  unchanged. The Langfuse column in `ctx eval traces` output, always empty,
  is gone too.
- **Unused code**: everything the code never calls, found by the compiler,
  knip and a reference scan of every class member, including the vendored
  SDK's unused error factories, stats getters and options.
- **Langfuse cloud tracing** and its dependencies (`@langfuse/otel`,
  `@langfuse/tracing`, `@opentelemetry/sdk-node`). Traces are recorded to
  local SQLite only. Langfuse keys in an existing config are ignored with a
  warning; the `langfuse_trace_id` column stays, so no migration is needed.

### Changed
- **Every dependency is at its latest version**: zod 4, commander 15, chalk 6,
  ora 9, marked 18, dotenv 18, better-sqlite3 13, tree-sitter 0.25.1,
  TypeScript 7, vitest 5, tsup 9.
- **`@huggingface/transformers` replaces `@xenova/transformers`** for local
  embeddings and reranking, with the same quantized weights (`q8`) so existing
  indexes stay comparable.
- **The ContextAI SDK parts ctx uses are included** in `src/sdk/` (MIT, same
  author), replacing the unmaintained `@contextaisdk/*` packages.
- Requires Node.js 22.12 or later. Builds and tests with npm instead of pnpm.

## [1.4.0] - 2026-02-17

### Added

#### Evaluation System
- **Golden Dataset Management** — Create, list, and manage golden test datasets for retrieval quality evaluation (`ctx eval golden add/list/capture/generate`) (#117, #131)
- **Batch Evaluation Runner** — Run retrieval quality evaluation against golden datasets with 6 IR metrics: MRR, Precision@K, Recall@K, Hit Rate, NDCG, MAP (#115, #116)
- **Eval Run Command** — `ctx eval run --project <name>` with formatted results table, regression detection, and `--json` output (#130)
- **Eval Report & Trends** — View eval run history with per-metric trend arrows and regression detection (`ctx eval report`) (#132)
- **RAGAS Integration** — Optional Python/RAGAS bridge for answer quality metrics: faithfulness, relevancy, context precision, context recall (#123)
- **RAGAS/DeepEval Export** — Export eval data to RAGAS and DeepEval JSON formats for external framework consumption (#124)
- **Eval Aggregator** — Cross-run trend computation with 5% regression threshold detection (#118)
- **CI Eval Workflow** — GitHub Actions workflow for automated retrieval quality checks on PRs and weekly schedule (#125)
- **CI Threshold Checker** — Quality gate script for CI pipelines with configurable thresholds via environment variables (#126)
- **Eval Test Fixtures** — Fixture-based eval for CI without external dependencies (#127)
- **E2E Integration Test** — Full eval cycle integration test covering golden dataset through report (#128)

#### Observability
- **Always-On Local Traces** — Automatic recording of every ask/search/chat interaction to SQLite `eval_traces` table (#119)
- **Langfuse v4 Cloud Sync** — Optional OpenTelemetry-based tracing to Langfuse cloud with zero-overhead noop fallback (#122)
- **RAG Pipeline Instrumentation** — Child spans for RAG engine search with query/topK/results metadata (#120)
- **Trace Type Filtering** — Filter traces by command origin (ask, search, chat) with `--type` flag
- **Langfuse Trace Linking** — Cross-reference local SQLite traces with Langfuse cloud traces via `langfuse_trace_id` column
- **Trace Sampling** — Configurable `sample_rate` (0.0-1.0) for local trace recording

#### Database
- **Eval Tables Migration** — `eval_traces`, `eval_runs`, `eval_results` tables with foreign key cascades and indexes (#112, #113)
- **Eval CRUD Operations** — `insertTrace`, `getTraces`, `insertEvalRun`, `getEvalRuns`, `insertEvalResult`, `getEvalResults` with Zod validation

#### Configuration
- **`[eval]` Config Section** — `golden_path`, `default_k`, `thresholds` (mrr, hit_rate, precision_at_k), `python_path`, `ragas_model` (#114, #129)
- **`[observability]` Config Section** — `enabled`, `sample_rate`, `langfuse_public_key`, `langfuse_secret_key`, `langfuse_host` (#114, #129)

#### Documentation
- **Eval & Observability Guide** — Comprehensive standalone documentation at `docs/eval-observability.md`
- **README Updates** — Eval commands, configuration, environment variables, and project structure
- **Agent Integration Updates** — JSON schemas for eval commands in `docs/agent-integration.md`

### Dependencies

- Added `@langfuse/otel` ^4.6.1
- Added `@langfuse/tracing` ^4.6.1
- Added `@opentelemetry/sdk-node` ^0.212.0

## [1.3.1] - 2026-02-11

### Changed

- **Claude Code-style Status Bar** - Restyled TUI status bar with model name, working directory (`~/path`), git branch with dirty indicator (`main*`), turn counter, and phase icons in activity text (#93)
- Cost display uses compact 2-decimal format (`$0.02` instead of `$0.0234`)
- Removed mode indicator (`[PLAN]`/`[EXEC]`/`[WAIT]`) from status bar

### Added

- Git status utility (`getGitInfo`) for branch and dirty state detection
- Regression tests for tickets #104 and #108

## [1.3.0] - 2026-02-10

### Added

- **LLM-Based Query Routing** - Intelligent project routing for multi-project environments using LLM fallback when heuristics are uncertain (#106)
- **AdaptiveRAG Pipeline** - Query-classification-aware search optimization via ContextAI SDK's AdaptiveRAG (#107)
  - SIMPLE queries (greetings) skip retrieval entirely, saving ~200-400ms
  - FACTUAL queries use standard pipeline (topK=5, rerank=true)
  - COMPLEX queries get enhanced search (topK=10, query enhancement)
- **Result Caching** - LRU cache (50 entries, 5-min TTL) on RAGEngineImpl for repeated queries
- **Classification Display** - Query classification tags shown in both REPL and TUI tool result output

### Changed

- Single-project guard skips LLM routing calls when only one project is indexed (optimization)

## [1.2.0] - 2026-02-06

### Added

- **ReAct Chat Agent** - Autonomous reasoning agent that decides when to search, replacing the manual RAG→LLM pipeline
- **Real-time Streaming** - Token-by-token response streaming with reasoning chain visualization in both REPL and TUI modes
- **`retrieve-knowledge` Tool** - RAG-as-a-tool with getter/closure pattern for agent-driven context retrieval
- **Source Citations** - Displayed after agent responses in both REPL and TUI modes
- **Agent Phase Status** - TUI status bar shows agent phases and tool descriptions during execution

### Fixed

- Add user-visible warnings when ChatAgent creation fails
- Wrap REPL agent streaming in try/finally to prevent AbortController leak
- Add agent abort tier to TUI SIGINT handler (3-tier: cancel agent → cancel indexing → exit)
- Graceful max-iterations handling (return last thought instead of error)

## [1.1.0] - 2026-02-06

### Added

- **TUI Chat Mode** - Full terminal UI for `ctx chat` with DECSTBM scroll regions, fixed status bar, and streaming cursor rendering
- **`ctx check` Command** - Pre-flight validation for agent integration workflows
- **`--context-only` Flag** - Retrieve RAG context from `ctx ask` without LLM cost
- **`--ignore` Flag** - Custom ignore patterns via CLI flag and `config.toml` setting
- **Background Indexing** - Real-time progress display with blocking input and status line updates
- **Agent Integration Guide** - Documentation for using ctx as a tool from AI agents (`docs/agent-integration.md`)
- `.env` support for local development testing

### Fixed

- LLM ignoring RAG context in multi-turn conversations
- Empty results handling in `ctx ask --context-only`
- Indexer cancellation bugs and test failures
- Event loop yields to prevent UI freeze during indexing
- Throttled indexing progress updates to prevent input lag
- Provider fallback model access TypeScript error

### Changed

- Skip SemanticChunker and reduce batch size for background indexing (performance)
- Remove CLAUDE.md and AGENTS.md from version control

## [1.0.2] - 2026-02-03

### Fixed

- Inject CLI version from `package.json` at build time via tsup define

## [1.0.1] - 2026-02-03

### Fixed

- Address code review feedback for atomic re-indexing (staging table cleanup, error handling)

## [1.0.0] - 2026-02-03

### Added

#### Multi-Project Search
- **MultiProjectVectorStoreManager** - Cross-project vector search
- **MultiProjectBM25StoreManager** - Cross-project BM25 keyword search
- **MultiProjectFusionService** - Hybrid search combining vector + BM25 results
- **projectId Metadata** - Chunk attribution for cross-project result tracking
- Description column added to projects schema

#### Smart Query Routing
- **RoutingRAGEngine** - Unified routing + search engine
- Automatic query classification for multi-project search
- Project attribution preserved after reranking

#### Chat Enhancements
- `/index` REPL command for in-session indexing
- `/index status` command for indexing progress
- Tab completion, `@file` references, and `/share` export
- Improved empty-database UX messaging

#### Indexer
- **Atomic Re-indexing** - Staging table pattern for safe index rebuilds

### Fixed

- Replaced fragile `for-await` readline with event-based pattern
- TypeScript errors breaking CI
- Project attribution lost after reranking
- Query routing type errors and false positive classification

## [0.1.0] - 2026-02-01

### Added

#### CLI Commands
- `ctx init` - Initialize a new context-expert project with configuration wizard
- `ctx index` - Index codebase files with progress tracking and incremental updates
- `ctx search` - Search indexed content with semantic and keyword matching
- `ctx ask` - Query the codebase using natural language with AI-powered responses

#### Core Features
- **ContextAI SDK Integration** - Full RAG pipeline with embeddings, retrieval, and reranking
- **SQLite Vector Storage** - Local-first vector database using better-sqlite3 with BLOB storage
- **Tree-sitter Code Parsing** - Intelligent code chunking for 8 languages:
  - TypeScript, JavaScript, Python, Go, Rust, Java, C, C++
- **Markdown Processing** - Smart chunking with heading hierarchy preservation
- **Configurable Providers** - Support for local embeddings (Xenova) and Anthropic Claude

#### Developer Experience
- Tab completion support for bash/zsh/fish shells
- Colorized terminal output with progress spinners
- Comprehensive error messages with actionable suggestions
- TOML-based configuration (`~/.ctx/config.toml`)

#### Testing & Quality
- 42 test files with vitest
- Coverage thresholds for critical modules (80%+)
- Type-safe codebase with strict TypeScript

### Known Limitations

- **Local embeddings only** - Cloud embedding providers not yet supported
- **Single project scope** - No multi-project workspace support
- **No incremental reranking** - Full rerank on each query
- **Memory usage** - Large codebases may require significant RAM during indexing

[unreleased]: https://github.com/draco28/ContextExpert/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/draco28/ContextExpert/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/draco28/ContextExpert/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/draco28/ContextExpert/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/draco28/ContextExpert/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/draco28/ContextExpert/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/draco28/ContextExpert/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/draco28/ContextExpert/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/draco28/ContextExpert/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/draco28/ContextExpert/releases/tag/v0.1.0
