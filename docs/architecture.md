# Architecture

Eremite remains one local Next.js process, one SQLite database and one content-addressed managed-file directory. It deliberately adds no API service, worker, event bus or multi-user coordination.

Production builds always receive a disposable temporary `EREMITE_DATA_DIR`; compiling or collecting route metadata must never migrate or read the user's live `data/`. Only `dev`/`start` use the configured real directory.

Supported npm dev/start entry points explicitly bind to `127.0.0.1`; hostname arguments are validated before Next starts and cannot change that address. Provider connections remain explicit outbound requests. Supported Windows x64 Node runtime is `>=24.15.0 <25`, matching the intersection of Host and accepted Supplier requirements.

## Ownership

| Module | Owns | Stable public boundary |
| --- | --- | --- |
| Inbox | `content_items`, logical `file_assets`, immutable `file_versions`, write journal | Content summary/location, versioned file descriptor, lifecycle operations |
| Projects | `projects`, arbitrary-depth `folders` | Project lifecycle, tree reads, rename/move CAS, breadcrumbs, Trash/restore |
| Tags | `tags` and association tables | Create/rename/merge/delete and object assignment |
| Actions | `actions`, `action_content_items` | Action lifecycle and Project membership |
| Automations | runs plus pinned input/output snapshots | Draft-producing run and immutable observed-version records |
| Search | FTS indexes only | Global/Project/recursive-Folder grouped search |
| Viewer | no tables | Read-only rendering and authenticated fixed/current binary responses |
| AI | conversation, source, activity and bounded proposal tables | Provider-neutral Runtime, durable chat, declarative Tasks, Context and Host-owned Tool contracts |

Cross-module writes are composed only in `src/app/_services`. Platform owns SQLite, writer lease, backup, file IO and GC mechanics; it contains no Project or Trash product rules.

## AI foundation

`src/modules/ai` owns the global AI boundary. Business modules declare an AI Task and enter through `runAITask`; only the Runtime imports Vercel AI SDK generation APIs. The adapter uses the OpenAI-compatible protocol without Provider-specific policy. Application Provider profiles take priority, with API keys in Windows SecretStore; complete server process environment configuration is used only when no profile exists. Configuration is lazy, so normal startup/build and non-AI flows do not require a key.

Ask Eremite persists conversations, request-bound runs, activities and provenance in AI-owned tables. The browser supplies a structured current-page target; Host validates it and reads business data through owner public services. Read adapters include `search_content`, `get_content`, `get_project` and `list_project_actions`, with a 24,000-character context budget and at most five model steps per request. Host-owned adapters can also prepare bounded Action Drafts, Action updates and Native Tool proposals. Confirmation revalidates the persisted proposal and observed revisions before calling existing services; AI never executes a Native Tool or writes business tables directly. The AI allowlist is separate from the Tool Catalog. Binary file bytes are never sent; existing editable text/Markdown can be read as context. There is no autonomous unbounded loop.

The API key is never persisted or returned through the production Task entry or any client boundary. Inside the server-only AI module it flows only from validated configuration into the Provider adapter; telemetry is explicitly disabled, SDK/provider errors are reduced to safe Eremite error codes, and `.env*` files are ignored except the key-free root `.env.example` template.

## File lifecycle

`content_items.id` is the stable user-facing identity. A file content item has one stable logical `file_asset`; its `current_version_id` selects one immutable `file_version`. Each version references a SHA-256 `file_blob`. Multiple assets and versions may share a blob, so logical deletion never directly unlinks a path.

Uploads/replacements stream to same-volume staging while hashing, fsync, verify, hard-link-publish the content-addressed blob, then use a short SQLite transaction and expected current-version CAS. The durable `file_write_operations` journal makes retries idempotent and leaves ambiguous published files for reconciliation/GC. Restore copies version metadata into a new higher-numbered version and switches the head; it never moves the head backward. Current URLs resolve once per request; fixed-version URLs remain immutable. GET/HEAD, single byte ranges, suffix ranges, 416, ETag/If-Range and same-origin security headers share one responder.

Trash preserves logical records and their readable versions. Permanent content deletion removes only that content's asset/versions; a blob is queued only when no version reaches it, waits at least 24 hours, is rechecked under the writer lease, and retries failures with backoff. Backup blocks GC while its snapshot and files are copied.

## Project, Folder and Tag

Project is a non-nested top-level context. Folder is an adjacency-list tree scoped to exactly one Project, with composite foreign keys, live-sibling partial unique indexes, recursive CTE reads and database/service cycle guards. There is no product depth limit. Same-name folders are allowed in different parents but not as live siblings. Folder rename/move uses revision CAS; moving across Projects updates the whole logical subtree and its content Project IDs in one app-layer transaction without changing content/file/version/blob IDs.

A trashed Folder detaches only the subtree root and stores its prior parent; descendants and content become effectively trashed. Restore uses the original live parent when possible, otherwise the Project root, and chooses a deterministic restored name on collision. Permanent subtree deletion requires fresh folder/content counts. Project permanent deletion requires fresh member counts, detaches all content/actions/runs, removes Folder organization, then deletes the Project—never the members.

Tag is normalized many-to-many metadata across Content, Actions and Automation runs, independent of Project and Folder location. The legacy `content_items.tags` text remains a synchronized v1.1 compatibility projection, not the hierarchy source.

## Automation tool platform

Automation capabilities are compile-time built-in Tools. One shared catalog owns Tool metadata; server executors and client launchers attach only by the same stable Tool ID and are protected by registry-parity tests. The Automation shell owns discovery and Run History while each Tool owns validation, execution, and result interpretation.

The built-in Tools are Content-to-Action drafts, File Converter and PDF Tools. The two native external Tools execute through one Host-owned request/response runner with contained temporary workspaces, canonical contracts, fixed package identity and independent output validation. File Converter accepts exactly 18 Host-authorized conversions through Sharp, Pandoc or LibreOffice. PDF Tools accepts merge, split, extract, rotate and reorder through qpdf. Validated outputs enter Inbox only through its public single/batch File Lifecycle services with deterministic per-Run idempotency keys.

Every accepted request has a unique `operation_id` and a server-generated Run ID. The current database-only Tool commits Actions through Actions' public batch service inside one shared Unit of Work, so Action rows, output relations, and the completed Run are all-or-nothing without crossing table ownership. This is request-level idempotency, not a blanket exactly-once guarantee for future external side effects.

`target_id` is the formal Run target. The released `automation_key` column remains a write-only legacy shadow because it is `NOT NULL`; new repository inserts mirror `target_id`, while queries and product rules never read it. Request-bound stale Run recovery is an independent idempotent reconciliation service scoped by each registered executor policy.

## Search and scale

Separate FTS5 trigram tables index Projects, Folders, Content, Actions and Automation runs. SQLite triggers maintain them; a rebuild and drift check are available. Two-character queries use escaped normalized substring matching. Project scope filters all Project members; Folder scope uses a recursive descendant CTE; Tag filters use join tables. Main resources and Folder children use server-side keyset pagination. Folder move destinations are lazy-searched and capped at 50 results rather than preloading a tree.

Performance regression tests construct more than 500,000 source objects and a 64-level path, then check p95 under 250ms for keyset lists, Folder children and Project search on the supported Windows/SQLite runtime. These are test thresholds, not a response-time guarantee for every device or dataset.

## Viewer and editing

Viewer URLs and v1.1 Quick/Full behavior stay stable. Renderers remain read-only. PDF, image, TXT, Markdown, DOCX, ZIP directory and common browser video formats share the Shell; video uses native controls and authenticated Range responses. Full Viewer adds lifecycle UI outside renderers. TXT/Markdown editing is memory-only until save, preserves supported BOM/encoding/newline metadata, warns before navigation with dirty text, retains local text on failure, and uses If-Match plus idempotency keys. Conflicts never overwrite the newer head.
