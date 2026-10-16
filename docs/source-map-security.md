# source-map-js security repair — 2026-10-16

Public source baseline: `9d91dac873c85a54161342da472310aedd6b7a1a`. Host package and root lockfile versions remain `1.7.0`. The historical v1.7.0 tag and Release retain their original dependency disposition.

## Dependency and trigger boundary

The installed production dependency path is `next@16.3.8 -> postcss@8.5.23 -> source-map-js@1.2.1`. PostCSS declares `^1.2.1`; `1.2.2` is compatible with that range. The Host now declares an exact `source-map-js: 1.2.2` override and locks the official npm artifact. No other package entry, framework, Supplier archive or application version changes.

[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) classifies versions `>=1.0.0 <1.2.2` as HIGH. The [upstream v1.2.2 release](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2) includes [the official fix](https://github.com/7rulnik/source-map-js/commit/cf76580). Malicious indexed source maps can supply excessive section offsets, causing synchronous work and event-loop denial of service when their mappings are consumed. The patch validates offsets, bounds nested totals, and improves SourceNode/generator handling.

This is a Node dependency shipped in the production tree, used by PostCSS source-map processing in the framework's CSS tooling. Source inspection found no direct source-map-js/SourceNode calls in Host application code. PostCSS can consume previous maps from options or CSS annotations. No uploaded-file-to-vulnerable-call product path was demonstrated; Eremite exploit reachability remains NOT VERIFIED. Production dependency classification alone does not establish a remotely exploitable application route, and lack of a direct application call does not establish safety.

## Local validation

Windows x64, Node `24.15.0`, npm `11.12.1`. All experimental data, temporary files and tool workspaces use disposable isolated roots; real application data is outside this validation.

- Baseline locked installation: PASS; production audit reported exactly one HIGH for this advisory.
- Baseline security regression: expected FAIL because invalid section offsets were accepted.
- Patched clean `npm ci`: PASS; no lockfile drift.
- Focused regression: PASS. A bounded child process exercises invalid line/column values, excessive and nested offsets, a valid indexed map, SourceNode round-trip, distant mappings, generator line gaps, and normal/malicious PostCSS previous-map processing. The test runs in the normal `npm test`/`verify` chain.
- `npm audit --omit=dev` and full `npm audit`: PASS, zero vulnerabilities in both reports.
- `npm ls source-map-js postcss next --all`: PASS, the single source-map-js instance resolves to `1.2.2` through the unchanged Next/PostCSS versions.
- `npm run verify`: PASS, including state governance, typecheck, the complete test chain, optimized production build, Viewer/upload HTTP security regressions and the 535,822,336-byte upload/SHA-256 check. Real external qpdf 12.4.0 five-operation and Sharp integration gates also passed.
- Public-information checks including both new files, fixed archives, and the public-exposure regression: PASS. `git diff --check`: PASS. Lockfile comparison confirms only the source-map-js package entry changes; all other entries and the three Host version values are preserved.

The production build reported that an ancestor lockfile outside this repository was ignored. The installed dependency isolation checks passed; the build used this public repository's own dependency tree. This environment warning does not require a source configuration change.

The upstream patch intentionally rejects malformed or excessive indexed offsets that the old version accepted. No general source-map resource-safety or whole-product zero-risk claim is made. Existing unrelated FOLLOW-UPs remain in the current public summary. This source repair is separate from release publication and independent acceptance.
