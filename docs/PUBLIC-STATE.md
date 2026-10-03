# Current public state

Eremite **v1.6.1** is the current source-first public release.
See the [published release and release notes](https://github.com/W-SING-HUNG/Eremite/releases/tag/v1.6.1)
and the [source repository](https://github.com/W-SING-HUNG/Eremite).

## Supported baseline

Windows x64, Node.js **>=24.15.0 <25** (recommended **24.15.0**), local single-user use.
Other platforms and Node.js major versions are unverified.
There is no Windows installer, hosted deployment or npm publication.

The application stores data locally and binds its supported dev/start entry points
to `127.0.0.1`. Do not expose it to the internet. Local authentication does not
provide an internet deployment security model.

## Current capabilities

Content stores files and links. Projects contain arbitrary-depth Folders; Tags
classify across modules. Actions, Processing, Trash, search, backups and immutable
file versions operate locally. Uploads are limited to 512 MiB per file.

Viewer displays PDF, images, TXT, Markdown, DOCX, ZIP directories and video formats
supported by the browser. DOCX layout is approximate. ZIP preview never extracts
entries. Renderers are read-only; explicit TXT/Markdown saves use the Host file
lifecycle to create a new immutable version.

## Supplier boundary

Host owns UI, policy, authorization, workspace isolation, routing, validation,
persistence, File Lifecycle and Run History. Supplier cores execute bounded
headless requests; their technical registries do not grant Host authorization.

- [File Converter v1.1.2](https://github.com/W-SING-HUNG/Eremite-File-Converter-Core):
  18 supported conversion pairs using Sharp, external Pandoc **>=3.1** and external
  LibreOffice **>=7.6**.
- [PDF Tools v1.0.0-rc5](https://github.com/W-SING-HUNG/Eremite-PDF-Tools-Core):
  prerelease; merge, split, extract, rotate and reorder with external qpdf
  **exactly 12.4.0** on PATH. No bundled qpdf or Microsoft VC runtime.

External executables must be visible on the application process PATH.
Host validates outputs before saving them as Content. Source tags identify source
trees; they do not replace the fixed runtime archives used by Host.

## AI and privacy

AI is optional, OpenAI-compatible and triggered by explicit user requests.
Application Provider keys are stored in Windows Credential Manager. Complete
server process environment configuration is a fallback when no application
Provider profile exists.

Requests may send questions and permitted text context to the configured Provider.
Binary file bytes are not sent as context. AI produces bounded proposals requiring
user confirmation; Host revalidates them before execution. AI does not directly
write business tables or run tools autonomously.

## Data, support and licensing

Use isolated synthetic data for tests. Create backups through the application;
never copy a running SQLite database as a backup.

GitHub Private Vulnerability Reporting is enabled. Use this repository's
[private reporting page](https://github.com/W-SING-HUNG/Eremite/security/advisories/new)
for vulnerabilities. Ordinary bugs and usage questions go to GitHub Issues.

Host-owned content is Apache-2.0. Copyright 2026 翁成航 (Chenghang Weng).
Third-party dependencies and Supplier components retain their own licenses.

See [backup and restore](backup-and-restore.md), [distribution baseline](public-baseline.md),
[security policy](../SECURITY.md), [support](../SUPPORT.md),
[contributing](../CONTRIBUTING.md) and [third-party inventory](../THIRD-PARTY-NOTICES.md).
