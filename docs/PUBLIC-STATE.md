# Eremite public support baseline

This source candidate retains package version 1.6.1. The published v1.6.1 tag remains unchanged. Canonical source: https://github.com/W-SING-HUNG/Eremite.

Last Verified Date: **2026-10-12 (Asia/Shanghai; source-boundary review)**

## Current Version

| Entry | Value | Boundary |
| --- | --- | --- |
| public-host-package | `1.6.1` | Source candidate; compared with package.json and both root lockfile versions. |
| public-node-range | `>=24.15.0 <25` | Windows x64 and Node 24; no other platform or major is accepted. |

## Current Post-release Maintenance — 2026-10-12

| Entry | Status | Boundary |
| --- | --- | --- |
| file-converter-root-destination | RESOLVED | Only omitted/undefined defaults to the source Folder. Explicit null/empty selects Project root; Retry freezes that destination. |
| pdf-tools-root-destination | RESOLVED | Only omitted/undefined defaults to the first source Folder. Explicit null/empty selects Project root for all five operations and split outputs; Retry freezes it. |

Retry creates a new Run and output namespace, preserves parent history and fixed source versions, rejects changed policy/destination, and checks Run state before File Lifecycle commit. Backup verification compares the complete retained blob set, migration checksums and actual hashes, and rejects uncopied non-empty WAL. Original versions remain immutable.

## Current Architecture

Host owns policy, validation, Run history, authorization and persistence through public owner services. AI is optional, request-bound and draft-only until explicit confirmation. Viewer is read-only except explicit TXT/Markdown editing through File Lifecycle; ZIP preview is directory-only; upload limit is 512 MiB. Loopback-only startup and request security checks remain enforced.

| Entry | Status | Boundary |
| --- | --- | --- |
| provider-contract | VERIFIED | Provider-neutral Runtime/chat contracts retain text, structured output and Tool calling behind Host-owned context and explicit confirmation. |

## File Converter Tool Core

| Entry | Status | Boundary |
| --- | --- | --- |
| file-converter-supplier-version | `1.1.3` | Host-vendored archive SHA-256 `566d03e5850d0fd966482f55028f136d809ed902801ecdad097abbc1ad2ba1c6`; Sharp 0.35.5; source provenance is supplied with the export. Public Supplier main remains 1.1.2. |
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

Fresh candidate-bound automated gates and independent acceptance are separate. Independent review of this source candidate is NOT VERIFIED. Existing historical acceptance does not prove this candidate, whole-product absence of defects, real external Provider recovery or screenshot/pixel acceptance.

## In Progress

Candidate validation results are provided beside the export manifest, outside the public source tree. They are not GitHub CI evidence.

## Known Risks

FOLLOW-UP: source-map-js 1.2.1 production-transitive HIGH advisory retains its security classification; Eremite exploit reachability is NOT VERIFIED. No remediation or zero-risk claim is made here. Default arbitrary long LibreOffice profiles and the native initialization cause remain bounded by the explicit short-root mitigation. Backup appVersion metadata retains the historical 1.3.0 value; compatibility depends on format, migration checksums and file integrity.

See [documentation boundary](public-baseline.md), [runtime configuration](tool-runtime.md), [backup](backup-and-restore.md), [security policy](../SECURITY.md) and [third-party inventory](../THIRD-PARTY-NOTICES.md).
