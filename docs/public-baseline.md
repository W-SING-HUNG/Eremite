# Public / internal documentation boundary

Public documentation consists of README, AGENTS, PUBLIC-STATE, architecture,
backup-and-restore, SECURITY and THIRD-PARTY-NOTICES. It describes product
behavior and requirements without machine-specific acceptance records.

Private source records are retained byte-for-byte under `docs/internal/`:
PROJECT-STATE, historical README and folder research. Formal private main retains
its original files. These records are excluded from the clean public baseline.
`.gitattributes` marks the directory `export-ignore` for source archives; this
does **not** hide tracked files from a repository or Git history.

The public baseline must come from a separately reviewed clean export. Exclude
private Git history, internal records, local state, QA logs and rejected/obsolete
artifacts. Retain the accepted File Converter 1.1.2 and PDF Tools rc5 archives
without modifying their bytes. Export provenance and file hashes are recorded
in the accompanying public-export manifest. Do not publish the private engineering
repository or copy its working tree/history into the public baseline.

## Licensing preparation

The unabridged Apache-2.0 LICENSE and root package metadata apply to owner-controlled
Eremite Host content. They do not replace any dependency or Supplier license.
Standard Appendix fields in LICENSE are Apache examples, not Eremite attribution.

Status: **CLOSED — COPYRIGHT_FINALIZED**. The product owner personally approved
the exact attribution: Copyright 2026 翁成航 (Chenghang Weng).
The three projects now have their final owner attribution in NOTICE and README;
all applicable upstream notices and the standard LICENSE text remain unchanged.

## Approved attribution locations

The approved public attribution is 翁成航 (Chenghang Weng), year 2026.
The standard Apache LICENSE Appendix remains unchanged; project attribution is
in NOTICE and README rather than inserted into the standard license text.

| File / location | Completed attribution |
| --- | --- |
| Root `NOTICE`, copyright attribution header | Copyright 2026 翁成航 (Chenghang Weng) |
| `README.md`, License paragraph | Approved copyright line and NOTICE link supplied |
| This document, Licensing preparation status | Copyright attribution completed |
| Supplier public source overlays and their regenerated roots | Approved NOTICE, README and finalization status supplied; accepted tgz files remain unchanged |

Supplier source metadata/documentation is retained under the private engineering
tree's `docs/internal/public-source-overlays/`. The preparation script under
`docs/internal/public-source-preparation/` reapplies it when regenerating the
three clean roots. These private preparation materials are excluded from the
Host public source root; their resulting public metadata is included in the
corresponding Supplier roots.

## Canonical source repositories and versions

Status: **RESOLVED — REPOSITORY_URLS_ASSIGNED**. The source-first projects use
these canonical repositories. Source versions are Eremite v1.6.1, File Converter
1.1.2 and PDF Tools 1.0.0-rc5 (prerelease). Version identity does not assert a tag,
GitHub Release or npm publication.

- Host: https://github.com/W-SING-HUNG/Eremite
- File Converter: https://github.com/W-SING-HUNG/Eremite-File-Converter-Core
- PDF Tools: https://github.com/W-SING-HUNG/Eremite-PDF-Tools-Core

| File / location | Current state / remaining action |
| --- | --- |
| `README.md`, Quick Start and source version | Canonical source URL supplied; Eremite v1.6.1 source-first delivery |
| `package.json`, `repository`, `homepage`, `bugs` metadata | Real URLs supplied; Eremite package version 1.6.1 |
| `package-lock.json`, root package metadata | Root version 1.6.1 matches package.json; URLs synchronized and dependency versions unchanged |
| `SECURITY.md`, Reporting a Vulnerability | GitHub Private Vulnerability Reporting enabled and verified; each project links only to its own reporting page |
| This document, public repository status | Repository URL blocker closed |
| Independent Supplier clean source roots, package/README metadata | Each Supplier's actual source URL supplied in its clean root; original workspaces and accepted tgz bytes remain unchanged |

All packages retain `private: true` to prevent accidental npm publication; this
flag does not describe repository visibility. Source preparation, repository
visibility and release publication follow their separate authorization gates.
The three repositories are public and GitHub Private Vulnerability Reporting is
enabled. Its status was checked through the official GET reporting endpoint,
which returned enabled=true for each repository. Each SECURITY.md supplies the
corresponding repository's own reporting page and sanitized report requirements.
Security-channel closure is complete; no private email or unverified external
reporting address is supplied.
