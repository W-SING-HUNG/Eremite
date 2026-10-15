# Emerald Pulse UI

This presentation update retains Eremite's dark-green identity and compact layout while improving Chinese reading, selection/focus feedback and motion consistency. It adds no animation framework, web font or dependency.

## Behavior

- Shared duration/easing tokens, soft loading shimmer, small button/nav feedback and bounded entrances/exits. Reduced-motion removes decorative motion. Exiting surfaces become inert at logical close and nested portals stop intercepting keyboard/focus.
- Microsoft YaHei UI first on Windows, with local fallback fonts; regular/bold roles, neutral Chinese letter spacing, 15px list titles and 16px reading content. Mobile list/action titles use two lines, and long Inspector headings remain bounded while exposing their complete accessible names.
- Ask waiting dots fill backwards before delayed points start. Waiting/Tool transitions retain one indicator shape, while sending, waiting, tool, streaming and stopping retain accurate status text. Markdown remains directly streamed.
- Image loading retains the single original image and existing loaded/zoom/pan lifecycle. Markdown/Text Viewer defaults to the reading token and retains 60%–200% zoom and reset; code scales proportionately.

## Validation and provenance

The 12 UI source files are byte-identical to the locally accepted candidate. Its recorded complete verification, targeted post-correction tests/typecheck/build and real production Chrome checks passed. Final targeted browser checks used 1440×900 and 375×900 as the everyday acceptance sizes, including Inspector accessibility/close controls, Action completion/undo/focus, and actual Viewer font sizes/zoom/reset. Extreme-width reflow was a separate stress check, not an everyday aesthetic standard.

These are local Codex results, not a newly performed independent acceptance or a claim that all external Providers/platforms were tested. The public test fixture retains its existing generated-file restoration; only optional synthetic-data preparation and test response latency hooks are added. Public CI validates integration with the public dependency/Supplier baseline. CI and merge events are available in the associated PR, rather than recorded as a permanently current SHA here.

The regular UI/readability gates constrain semantic color roles, six dark surfaces, 4.5:1 text contrast and stacked highlight peaks. Unreadable or incorrectly semantic metadata colors must fail. Existing tests and thresholds are preserved.

## Supplemental browser harnesses

`tests/emerald-pulse-browser.test.mjs` starts its own disposable production fixture. Use an existing Playwright/Chrome installation and set `EREMITE_PLAYWRIGHT_MODULE`, `EREMITE_BROWSER_EXECUTABLE`, `EREMITE_UI_EVIDENCE_DIR`, plus fresh isolated `EREMITE_DATA_DIR`, `TEMP`/`TMP` and `EREMITE_TOOL_WORKSPACE_DIR`. Build the matching source first, then run it with the repository TypeScript loader. The controlled SSE spacing belongs only to the test transport, never the product.

The typography and closeout browser probes additionally require a caller-prepared synthetic production fixture and `EREMITE_UI_QA_ROOT/runtime.json` containing a loopback `url` and `ids` for `markdown`, `text` and `emptyProject`. Use the existing `startAIChatFixture({ prepare })` hook before its application writer starts. Seed long Chinese resource/action titles, an assistant Markdown message, tagged/path-bearing resources and an empty Project. The closeout probe expects the resource title prefix `中文资料归档与长期阅读体验` and Action prefix `整理本周中文阅读资料`; its `--baseline` captures the same ordered data before the candidate pass. These probes are supplemental acceptance harnesses, not mandatory CI dependencies. Do not point any fixture at live personal data.

## Boundaries

No business, database, API, AI Runtime, Tool policy, File Lifecycle, permission, persistence, package version or Supplier change is part of this update. Existing initialization-time immediate Enter behavior in Ask remains a FOLLOW-UP. Historical private validation documents, local paths, screenshots, logs, databases, caches and QA working directories are not part of the public source delivery.
