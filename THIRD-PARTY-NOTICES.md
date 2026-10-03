# Third-party inventory — source-first distribution

This inventory covers the current Host lockfile and accepted Supplier archives.
It records declared licenses and the approved distribution scope below. Eremite's
root Apache-2.0 LICENSE applies only to owner-controlled Host content. Preserve
each third-party license and required notices when distributing its files.

## Host npm dependencies

Versions/licenses below come from `package-lock.json`. Installation supplies npm
components; the source baseline contains the lockfile and two Supplier tgz files,
not an installed node_modules tree. A packaged build will have a different actual
file inventory. Full transitive dependency notices must be derived from that
final inventory in Phase 2B/2C, including framework and platform optional packages.

| Component | Locked version | Declared license |
| --- | --- | --- |
| Next (`next`) | 16.3.6 | MIT |
| React / React DOM | 18.3.1 | MIT |
| DOMPurify | 3.4.16 | MPL-2.0 OR Apache-2.0 |
| PDF.js (`pdfjs-dist`) | 6.2.108 | Apache-2.0 |
| docx-preview | 0.4.0 | Apache-2.0 |
| JSZip | 3.10.1 | MIT OR GPL-3.0-or-later |
| iconv-lite | 0.7.0 | MIT |
| AI SDK (`ai`) | 7.0.107 | Apache-2.0 |
| AI SDK OpenAI-compatible adapter | 3.0.53 | Apache-2.0 |
| Zod | 4.6.5 | MIT |
| Lucide React | 0.468.0 | ISC |
| react-markdown | 10.1.0 | MIT |
| remark-gfm | 4.0.1 | MIT |

Development dependencies include TypeScript 5.9.3 (Apache-2.0) and @types/node
24.10.1, @types/react 18.3.12 and @types/react-dom 18.3.1 (MIT). Their inclusion
in any public source/build distribution must also be recorded.

## Supplier artifacts (owner-controlled, separate licensing)

| Artifact currently in Host source | Current package metadata | Public status |
| --- | --- | --- |
| `vendor/file-converter/file-converter-core-1.1.2.tgz` | `private: true` prevents accidental npm publication; Apache-2.0 | Supplier and Host technically accepted; canonical source: [Eremite-File-Converter-Core](https://github.com/W-SING-HUNG/Eremite-File-Converter-Core) |
| `vendor/pdf-tools/pdf-tools-core-1.0.0-rc5.tgz` | rc5 prerelease; `private: true` prevents accidental npm publication; Apache-2.0 | Supplier and Host technically accepted; canonical source: [Eremite-PDF-Tools-Core](https://github.com/W-SING-HUNG/Eremite-PDF-Tools-Core) |

Supplier source repositories remain independent. The Host license does not
amend these embedded artifacts. The technical candidates replace the prior internal packages for Host
acceptance; integration is not public release approval. Owner attribution is
finalized in NOTICE. Private security reporting is enabled; release publication follows its own authorization gate. Real source
repository URLs are now assigned; accepted archives retain their original bytes.

## Native and bundled dependency inventory

| Component | Current distribution boundary | License / outstanding review |
| --- | --- | --- |
| Sharp 0.35.4 | npm dependency of File Converter (also used by Next); consumer obtains dependencies from npm | Apache-2.0; VERIFIED FOR PUBLIC DISTRIBUTION for Supplier tgz + consumer npm dependency installation |
| libvips / Sharp native closure | Windows `@img/sharp-win32-x64@0.35.4` is obtained from npm by the consumer | package declares Apache-2.0 AND LGPL-3.0-or-later; VERIFIED FOR PUBLIC DISTRIBUTION for Supplier tgz + consumer npm dependency installation |
| fc-movefile.exe | bundled in File Converter `dist/native/bin/` | owner-controlled helper; approved attribution in NOTICE; helper source and build script retained in the File Converter source root |
| qpdf 12.4.0 | EXTERNAL PREREQUISITE on PATH; not in rc5 tgz or Host package | Apache-2.0 per upstream distribution; independently installed/licensed by user |
| Microsoft VC runtime DLLs | NOT DISTRIBUTED by rc5; prerequisites of independently obtained external qpdf distribution | Microsoft license terms belong to that external distribution; Host makes no redistribution claim |
| ajv 8.20.0 | bundled PDF Tools node_modules | MIT |
| fast-deep-equal 3.1.3 | bundled PDF Tools node_modules | MIT |
| fast-uri 3.1.8 | bundled PDF Tools node_modules | BSD-3-Clause |
| json-schema-traverse 1.0.0 | bundled PDF Tools node_modules | MIT |
| require-from-string 2.0.2 | bundled PDF Tools node_modules | MIT |

The PDF Supplier contains its Apache-2.0 LICENSE and THIRD-PARTY-NOTICES
for bundled npm components. It ships no qpdf/native binaries, runtime manifest
or vendor licenses. These facts do not prove final public obligations complete. Platform-specific Sharp packages differ;
the lockfile lists packages for other platforms without making them supported.

## External prerequisites (not bundled by Host)

| Component | Required capability version | Upstream licensing reference |
| --- | --- | --- |
| Pandoc | >=3.1, external executable with sandbox | [GPL license](https://github.com/jgm/pandoc/blob/main/COPYRIGHT); user-installed |
| LibreOffice | >=7.6, external headless executable | [Upstream licenses](https://www.libreoffice.org/about-us/licenses/); user-installed |
| Node.js | >=24.15.0 <25 | [Node license](https://github.com/nodejs/node/blob/main/LICENSE); user-installed |

## Remaining gate

The product owner confirmed the Sharp/libvips conclusion above for the
Supplier tgz + consumer obtains dependencies from npm distribution model. This
candidate preserves that conclusion and model. The export contains the accepted
Supplier tgz files and dependency metadata, without installed node_modules.

Retain upstream texts/attributions for the components actually distributed.
Update this inventory whenever lockfile or accepted artifact bytes change.
Owner attribution is finalized as Copyright 2026 翁成航 (Chenghang Weng).
Private security reporting is enabled and documented in SECURITY.md. Repository visibility,
tags and GitHub Releases follow their own authorization gates. See
[finalization checklist](docs/public-baseline.md) for the exact fill-in locations.
