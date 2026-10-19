# Eremite public support baseline

The public Host source is version 1.7.0, including the completed maintenance, Emerald Pulse V1/V1.1 and Ask initialization Enter repair. The historical v1.6.1 tag remains unchanged. Canonical source: https://github.com/W-SING-HUNG/Eremite.

Last Verified Date: **2026-10-16 (Asia/Shanghai; source-map dependency repair; v1.7.0 release evidence retains its dated scope)**

## Current Version

| Entry | Value | Boundary |
| --- | --- | --- |
| public-host-package | `1.7.0` | Public Host source-first distribution; compared with package.json and both root lockfile versions. Windows x64/Node 24 only; fixed Suppliers unchanged. See v1.7.0 release notes and live GitHub publication evidence. |
| public-node-range | `>=24.15.0 <25` | Windows x64 and Node 24; no other platform or major is accepted. |

## Current Post-release Maintenance — 2026-10-13

| Entry | Status | Boundary |
| --- | --- | --- |
| file-converter-root-destination | RESOLVED | Only omitted/undefined defaults to the source Folder. Explicit null/empty selects Project root. New Retry evidence v2 freezes destination identity and a fixed 64-character SHA-256 over ordered ancestor IDs/names/parents/Projects; historical v1 breadcrumbs remain revalidated without rewriting parent/child input bytes. Retry confirmation preserves v1 paths and uses the existing trusted leaf-name snapshot for v2, explicitly distinguishing Unassigned/Project root/Folder and stating when the full path was not recorded. |
| pdf-tools-root-destination | RESOLVED | Only omitted/undefined defaults to the first source Folder. Explicit null/empty selects Project root for all five operations and split outputs. Retry uses the same bounded v2 path digest and compatible v1 validation; the 65,536-character input limit remains unchanged. Confirmation uses the same v1/v2 display rules without changing server eligibility or reintroducing breadcrumb arrays. |

Retry creates a new Run and output namespace, preserves parent history and fixed source versions, rejects changed policy/destination, and checks Run state before File Lifecycle commit. Failed single-file creation cleans only a newly promoted blob confirmed absent from blob metadata under the writer lease; pre-existing/shared bytes and uncertain references are preserved. Retry Workspace and Retry UI changes require public state review. Backup verification compares the complete retained blob set, migration checksums and actual hashes, and rejects uncopied non-empty WAL. Original versions remain immutable.

## Current UI — Emerald Pulse

The dark-green presentation uses shared motion tokens, restrained emerald/cyan highlights, Skeleton shimmer and bounded overlay/message transitions. Reduced-motion disables decorative animation, while closing overlays become inert immediately and retain keyboard/focus behavior. Waiting and Tool phases share a stable three-dot indicator with accurate phase/status text; streamed Markdown is not buffered.

Chinese-first local fonts, 15px list text and 16px reading text improve everyday reading. Mobile resource/action titles use two lines, Inspector headings have bounded lines and retain full accessible names, and Markdown/Text Viewer zoom derives from the reading token. Existing image loaded/zoom/pan behavior is preserved without duplicate image layers.

The UI source bytes match the locally verified candidate. Local production Chrome checks covered 1440/375px, real button hit targets, complete accessible titles, completion/undo, focus restoration, reading sizes, zoom and reset. Earlier bounded motion/reduced-motion checks also passed. These are local automated checks, not a new independent product acceptance or release claim; public CI establishes integration with this repository's retained Host/Supplier baseline. See [UI scope and validation](emerald-pulse-ui.md).

RESOLVED (2026-10-15): a non-composing Enter during Ask initialization records one explicit send request, then dispatches once after the Provider and selected conversation load successfully. Initialization failure or an unavailable Provider preserves input with feedback. Editing, closing, context changes or selecting another conversation cancels the queued request; obsolete responses cannot overwrite the current selection. Shift+Enter, composition/229, Send, streaming and Stop retain their existing contracts. Created conversations remain usable if history refresh fails, and reopening clears old inline artifact errors. Local production Chrome regression passed all 14 controlled-response scenarios, including composition events. This is a focused composer bug fix with no presentation redesign, schema, Runtime, Tool, Supplier or version change. See [initialization Enter validation](ask-initialization-enter.md).

## Current Architecture

Host owns policy, validation, Run history, authorization and persistence through public owner services. AI is optional, request-bound and draft-only until explicit confirmation. Viewer is read-only except explicit TXT/Markdown editing through File Lifecycle; ZIP preview is directory-only; upload limit is 512 MiB. Loopback-only startup and request security checks remain enforced.

| Entry | Status | Boundary |
| --- | --- | --- |
| provider-contract | VERIFIED | Provider-neutral Runtime/chat retains four read Tools and three controlled proposal Tools behind observed Host context, permissions and explicit confirmation. Application Provider profiles take precedence, with keys in Windows SecretStore; environment credentials apply only when no application profile exists. |

## File Converter Tool Core

| Entry | Status | Boundary |
| --- | --- | --- |
| file-converter-supplier-version | `1.1.3` | Host-vendored archive SHA-256 `566d03e5850d0fd966482f55028f136d809ed902801ecdad097abbc1ad2ba1c6`; Sharp 0.35.5; Supplier Node `>=24 <25` intersects public Host `>=24.15.0 <25`. The archive-pinned native helper SHA-256 `9aa5bd91810dc9c643641a2ea4272fabcb1d579340a9cb0b87ea20750f5fb919` is checked again before each actual invocation. Source provenance is supplied with the export. Public Supplier main remains 1.1.2. |
| file-converter-capabilities | VERIFIED | Exactly 18 Host-authorized conversions: 12 image pairs, three Pandoc and three Office-to-PDF. Only effective defaults are accepted: images balanced; Pandoc/Office standard. Non-default profiles reject before Run/engine/write. |
| file-converter-contract | VERIFIED | Canonical Contract v1.1 / Protocol v1 unchanged, with no request profile field. Host owns output containment, size/SHA/type checks and final persistence. |

Formal invocation and Retry resolve the checked executable again and pass only the bounded environment through existing Supplier hooks. External Pandoc >=3.1 and LibreOffice >=7.6 are required for their conversions. Explicit FFC_PANDOC_PATH / FFC_SOFFICE_PATH or PATH supports custom installations. EREMITE_TOOL_WORKSPACE_DIR selects an existing absolute short directory and rejects redirected/missing roots. Arbitrary long default LibreOffice paths remain FOLLOW-UP.

## PDF Tools Core

| Entry | Status | Boundary |
| --- | --- | --- |
| pdf-tools-supplier-version | `1.0.0-rc5` | Archive SHA-256 `4d39776995930e449238272e01bc0e981d84a3ea93835bd40a7e280309dd3e36`; external qpdf exactly 12.4.0 on absolute process PATH. No bundled qpdf/VC binaries or vendor fallback. |
| pdf-tools-capabilities | VERIFIED | Five operations: merge, split, extract, rotate and reorder; Host validates complete output sets and commits atomically through Inbox. |
| pdf-tools-contract | VERIFIED | Canonical Supplier Protocol v1 unchanged; schema SHA-256 `863662f704b1001fb309741d5b2842a258ac62deba3135534feff4ce6acd38fc`. Actual external qpdf executable hash is recorded per Run. |

## Git / GitHub Source of Truth

Public-information checks cover tracked and non-ignored new files, staged bytes, effective proposed identities, encoded text, nested ZIP/TAR archives, document-container metadata, submitted release/PR text and new commit content/messages/identities in CI. Release events check the name/body after publication; pre-publication text checks remain required. New author/committer addresses require GitHub no-reply identities, with release-account ownership and server-generated metadata checked separately. Legal attribution, supported AI/dependency/model names and synthetic content remain allowed; historical objects, hosting caches and external submission paths have separate limits. See [public information checks](public-information.md).

Public maintenance uses accepted clean export, a reviewed PR, required strict Verify, squash merge and main CI. New-version publication is a separate authorized step. Live refs and CI are queried at GitHub; the SHAs below identify dated PR #2 events, not a permanently current main HEAD.

## Current Next Step

Maintain the v1.7.0 source-first support scope and preserved Host/Supplier boundaries and known FOLLOW-UPs through reviewed, validated changes. Publication evidence belongs to the versioned GitHub Release and its exact tag target. Completed candidate acceptance and CI do not establish whole-product absence of defects, real external Provider recovery or broader screenshot/pixel acceptance.

## In Progress

PR #2's final product candidate completed independent acceptance and public integration for the manifest and events below. Those PASS records do not cover later documentation bytes. v1.7.0 combines the already integrated maintenance, Emerald Pulse and Ask repair; its release gate and security disposition are recorded in [release notes](releases/v1.7.0.md). Documentation corrections establish summary accuracy through governance and CI; future product candidates require their own source-bound validation and acceptance. Known Risks remain open.

## Historical PR #2 acceptance and integration — 2026-10-13

| Evidence | Status | Exact scope |
| --- | --- | --- |
| Independent candidate acceptance | PASS | Earlier historical manifest SHA-256 `aa1c95edf1eef3c30154c56b2342c50716275e73f18363f5f224710408abc74e`, before bounded Retry evidence and the final UI repair; this earlier evidence is preserved, not the final-candidate proof. |
| Earlier PR #2 CI checkpoint | PASS | Historical review Head `aaa1ff108c8f07a7e13c8932f8ee66fcb94a0528`, strict Verify run [38354596332](https://github.com/W-SING-HUNG/Eremite/actions/runs/38354596332); this checkpoint predates the final candidate. |
| Final PR #2 candidate independent acceptance | PASS | A separate validation pass accepted the final candidate with 0 BLOCKER, bound to manifest SHA-256 `ff907a9a745da7642347d45bd2bcf34b41310cbc1c60ab37cd15918a07325757`, including bounded Retry evidence and the v1/v2 Retry UI repair. |
| Final PR #2 Verify | PASS | Final review Head `925d76956349246ad95d0c30d04b0518384dade4`; strict Verify run [38412081417](https://github.com/W-SING-HUNG/Eremite/actions/runs/38412081417) succeeded for that Head and its merge base. |
| PR #2 public maintenance integration | COMPLETED | [PR #2](https://github.com/W-SING-HUNG/Eremite/pull/2) was Squash Merged on 2026-10-13 as event commit [`f6e2836276e9cd074bae8cf1e8e7a12b47b6ee5d`](https://github.com/W-SING-HUNG/Eremite/commit/f6e2836276e9cd074bae8cf1e8e7a12b47b6ee5d). This SHA identifies that merge event, not the main HEAD after future changes. |
| PR #2 post-merge main CI | PASS | CI run [38415818211](https://github.com/W-SING-HUNG/Eremite/actions/runs/38415818211) succeeded for the PR #2 squash event commit above. It does not certify future main commits. |
| New-version publication from PR #2 | NOT EXECUTED | The maintenance integration retained Host `1.6.1`; no new version, tag or Release was created. The existing v1.6.1 release remains the published software baseline. |

Generation checkpoint, 2026-10-13: the bounded Retry-evidence and Retry UI candidate for manifest `ff907a9a745da7642347d45bd2bcf34b41310cbc1c60ab37cd15918a07325757` was marked NOT VERIFIED when exported. That historical marker was superseded by the final candidate validation PASS above; it is not the current acceptance status.

These completed acceptance and integration records apply to the identified PR #2 candidate and commits. Later maintenance does not invalidate those historical events or inherit their acceptance/CI; a future Release requires its own versioned publication evidence.

## Current Dependency Security

RESOLVED in the current source: `next@16.3.8 -> postcss@8.5.23 -> source-map-js` now resolves to `1.2.2`, the upstream patch for HIGH [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). An exact Host override and lockfile retain the compatible PostCSS range without changing framework or Supplier versions. Regression covers invalid/nested section offsets and normal SourceNode, generator and PostCSS mappings. The vulnerable package was production-transitive; Eremite exploit reachability was NOT VERIFIED. This dependency repair does not establish zero risk or change the historical v1.7.0 tag/Release. See [repair scope and validation](source-map-security.md).

## Known Risks

FOLLOW-UP: Default arbitrary long LibreOffice profiles and the native initialization cause remain bounded by the explicit short-root mitigation. Backup appVersion metadata retains the historical 1.3.0 value; compatibility depends on format, migration checksums and file integrity. At 375px with no file selected, Ask may require scrolling below the initial viewport; initial-viewport reachability remains a separate mobile usability FOLLOW-UP.

See [documentation boundary](public-baseline.md), [runtime configuration](tool-runtime.md), [backup](backup-and-restore.md), [security policy](../SECURITY.md) and [third-party inventory](../THIRD-PARTY-NOTICES.md).
