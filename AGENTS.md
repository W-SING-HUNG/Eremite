# Eremite engineering guide

Eremite is a local-first, single-user personal digital foundation. Prefer small, explicit changes over infrastructure.

## Boundaries

- `src/modules/inbox` owns `content_items`, logical `file_assets`, immutable `file_versions`, file journals and blob reachability rules.
- `src/modules/actions` owns `actions` and `action_content_items`.
- `src/modules/automations` owns `automation_runs`.
- `src/modules/projects` owns top-level `projects` and the arbitrary-depth `folders` tree inside each Project.
- `src/modules/tags` owns Tags and the per-module association tables.
- `src/modules/search` owns only search indexes and read contracts; source entities stay in their owning modules.
- `src/modules/viewer` owns no tables. It may read file descriptors only through Inbox's public service.
- `src/modules/ai` owns provider-neutral AI Runtime, Task, Context and Tool contracts and its `ai_threads`, `ai_messages`, `ai_runs` conversation tables. Only its chat storage layer accesses those tables; Eremite business data must come through Host-owned adapters over public module services.
- Modules may call another module's public service only; they may not query or mutate another module's tables directly.
- `src/modules/search` is a read-model exception: it may read the explicitly indexed metadata and Tag association tables needed for cross-module search, but may never mutate source-module rows. All product writes still go through owner services.
- `src/platform` contains only cross-cutting capabilities. Do not put product rules there.

## Data safety

- Add, never edit or delete, released files in `db/migrations/`.
- Run `npm.cmd run verify` before handing off a change on Windows.
- Do not store files as SQLite blobs. Keep originals under `data/files/` and track their hashes in the database.
- Before a destructive data migration, create and verify a backup.
- AI or automation output is always a draft until explicitly confirmed by the user.
- File Viewer renderers are read-only. They may not rewrite originals, persist converted previews, execute embedded content, or load external document resources automatically.
- Archive preview is directory-only: never extract entries, open nested files, or normalize suspicious paths into filesystem targets.
- File binaries use the authenticated internal upload route, not Server Actions. Keep the 512 MiB streaming limit, staging cleanup, SHA-256 verification and file/database rollback semantics intact.

## Deliberate non-goals

No Docker requirement, PostgreSQL, API service, background worker, event bus, plugins, general external-integration platform, multi-user features, or autonomous agents in V1. AI provider calls are explicit, request-bound and must not become an agent loop.
