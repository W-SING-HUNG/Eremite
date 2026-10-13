# Native tool runtime configuration

Host owns discovery, containment, policy and persistence. Supplier contracts and validated archives remain fixed.

## Short workspace

Set server-only EREMITE_TOOL_WORKSPACE_DIR to an explicitly created existing absolute directory on a suitable short local path. Host rejects missing, relative and redirected/reparse roots; it never silently falls back from invalid configuration. Each invocation receives a fresh private contained workspace. Without the setting Host uses the operating system temporary directory; arbitrary long LibreOffice Profile paths remain a known FOLLOW-UP. This mitigation does not establish a portable native path-length threshold.

## Executable discovery

File Converter uses one server-only resolver for readiness and formal invocation. It checks existing FFC_SOFFICE_PATH / FFC_PANDOC_PATH absolute settings, standard install locations and absolute PATH entries. C: and D: installations can use explicit settings or PATH. Every invocation/Retry rechecks the selected real executable, pins it through existing Supplier hooks and provides an allowlisted environment. Client availability and errors expose no local executable path or Provider secret.

PDF rc5 requires external qpdf exactly 12.4.0 on absolute process PATH, validates the canonical schema hash and records the actual executable SHA-256. It contains no qpdf/VC runtime binaries and has no vendor fallback.

## Isolated verification

Use a fresh disposable EREMITE_DATA_DIR, TEMP, TMP and short EREMITE_TOOL_WORKSPACE_DIR for each complete QA run; never use real data. Run shared-temp native suites serially. test:tool-workspace:real covers genuine long-path failure followed by short-root Retry. test:file-converter-dependencies:real covers PATH-only/custom executable resolution, controlled child environment, lost dependencies and recovery. Missing prerequisites fail rather than skip.

## File Converter FAB layout reproduction

Run npm.cmd run test:file-converter:layout from the repository root after a matching production build. Provide an independently installed Playwright module via EREMITE_PLAYWRIGHT_MODULE and a Chromium-compatible executable via EREMITE_BROWSER_EXECUTABLE, or an installed Chrome channel. Resolve actual installation locations on both C: and D:; these paths are external QA inputs, not repository dependencies. Use fresh isolated data/temp/tool directories and no Provider configuration. No global environment setting or browser download is required by the test.

This supplemental browser gate is separate from test/verify/CI. It exercises production pages at 375/869/1440 by 780 CSS px, initial/scrolled geometry, 27 actual pointer hits using elementFromPoint, Ask open/close, bottom navigation and Actions/PDF positioning. The fixture closes its own server/browser and deletes its disposable database. It supplements engine/Receipt tests and does not imply independent acceptance.
