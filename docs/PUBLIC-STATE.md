# Eremite public support baseline

This source candidate retains package version 1.6.1. The published v1.6.1 tag remains unchanged. Canonical source: https://github.com/W-SING-HUNG/Eremite.

Last Verified Date: **2026-10-13 (Asia/Shanghai; source-boundary review)**

## Current Version

| Entry | Value | Boundary |
| --- | --- | --- |
| public-host-package | `1.6.1` | Source candidate; compared with package.json and both root lockfile versions. |
| public-node-range | `>=24.15.0 <25` | Windows x64 and Node 24; no other platform or major is accepted. |

## Current Post-release Maintenance — 2026-10-12

| Entry | Status | Boundary |
| --- | --- | --- |
| file-converter-root-destination | RESOLVED | Only omitted/undefined defaults to the source Folder. Explicit null/empty selects Project root. New Retry evidence v2 freezes destination identity and a fixed 64-character SHA-256 over ordered ancestor IDs/names/parents/Projects; historical v1 breadcrumbs remain revalidated without rewriting parent/child input bytes. Retry confirmation preserves v1 paths and uses the existing trusted leaf-name snapshot for v2, explicitly distinguishing Unassigned/Project root/Folder and stating when the full path was not recorded. |
| pdf-tools-root-destination | RESOLVED | Only omitted/undefined defaults to the first source Folder. Explicit null/empty selects Project root for all five operations and split outputs. Retry uses the same bounded v2 path digest and compatible v1 validation; the 65,536-character input limit remains unchanged. Confirmation uses the same v1/v2 display rules without changing server eligibility or reintroducing breadcrumb arrays. |

Retry creates a new Run and output namespace, preserves parent history and fixed source versions, rejects changed policy/destination, and checks Run state before File Lifecycle commit. Failed single-file creation cleans only a newly promoted blob confirmed absent from blob metadata under the writer lease; pre-existing/shared bytes and uncertain references are preserved. Retry Workspace and Retry UI changes require public state review. Backup verification compares the complete retained blob set, migration checksums and actual hashes, and rejects uncopied non-empty WAL. Original versions remain immutable.

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

Publication uses accepted clean export, public sync branch, PR, required Verify, squash merge and main CI. Source candidate generation does not authorize those stages. Historical public source release last checked 2026-10-04; live refs and CI are queried at GitHub.

## Current Next Step

Fresh candidate-bound automated gates and independent acceptance are separate. Independent review of this bounded Retry-evidence and Retry UI candidate is NOT VERIFIED. Completed acceptance below applies only to its identified historical manifest, not to these new modifications, whole-product absence of defects, real external Provider recovery or screenshot/pixel acceptance.

## In Progress

Candidate validation results are provided beside the export manifest, outside the public source tree. They are not GitHub CI evidence.

## Historical accepted candidate and PR evidence — 2026-10-13

| Evidence | Status | Exact scope |
| --- | --- | --- |
| Independent candidate acceptance | PASS | Accepted manifest SHA-256 `aa1c95edf1eef3c30154c56b2342c50716275e73f18363f5f224710408abc74e`, before the bounded Retry-evidence changes in this source tree. |
| Current public PR CI checkpoint | PASS | PR #2 Head `aaa1ff108c8f07a7e13c8932f8ee66fcb94a0528`, strict Verify run [38354596332](https://github.com/W-SING-HUNG/Eremite/actions/runs/38354596332); this does not verify the subsequently modified candidate. |
| Public main integration and publication | NOT PERFORMED | Last observed public main `51826c005f156dd30c534d342dd3c016f2393e9d` does not contain that PR Head; published Host v1.6.1 remains unchanged. Candidate acceptance and PR CI do not constitute a merge, tag or release. |

This dated checkpoint records completed acceptance and observed PR CI separately. The revised candidate's independent acceptance remains NOT VERIFIED, and its GitHub CI has not been executed.

## Known Risks

FOLLOW-UP: source-map-js 1.2.1 production-transitive HIGH advisory retains its security classification; Eremite exploit reachability is NOT VERIFIED. No remediation or zero-risk claim is made here. Default arbitrary long LibreOffice profiles and the native initialization cause remain bounded by the explicit short-root mitigation. Backup appVersion metadata retains the historical 1.3.0 value; compatibility depends on format, migration checksums and file integrity. At 375px with no file selected, Ask may require scrolling below the initial viewport; initial-viewport reachability remains a separate mobile usability FOLLOW-UP.

See [documentation boundary](public-baseline.md), [runtime configuration](tool-runtime.md), [backup](backup-and-restore.md), [security policy](../SECURITY.md) and [third-party inventory](../THIRD-PARTY-NOTICES.md).
