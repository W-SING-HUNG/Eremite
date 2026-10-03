# Third-party inventory — source-first distribution

This inventory covers the current Host lockfile and accepted Supplier archives.
It records declared licenses and the distribution scope below. Eremite's
root Apache-2.0 LICENSE applies only to owner-controlled Host content. Preserve
each third-party license and required notices when distributing its files.

## Host npm dependencies

Versions/licenses below come from `package-lock.json`. Installation supplies npm
components; the source baseline contains the lockfile and two Supplier tgz files,
not an installed node_modules tree. A packaged build will have a different actual
file inventory. For any separately packaged build, derive transitive dependency notices from
the files actually distributed, including framework and platform optional packages.

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
| `vendor/file-converter/file-converter-core-1.1.2.tgz` | `private: true` prevents accidental npm publication; Apache-2.0 | Host-vendored runtime archive; canonical source: [Eremite-File-Converter-Core](https://github.com/W-SING-HUNG/Eremite-File-Converter-Core) |
| `vendor/pdf-tools/pdf-tools-core-1.0.0-rc5.tgz` | rc5 prerelease; `private: true` prevents accidental npm publication; Apache-2.0 | Host-vendored runtime archive; canonical source: [Eremite-PDF-Tools-Core](https://github.com/W-SING-HUNG/Eremite-PDF-Tools-Core) |

Supplier source repositories remain independent. The Host license does not
amend these embedded artifacts. Host uses these fixed archives; source tags and
local rebuilds do not establish identical artifact bytes. Project attribution is
in NOTICE. Security reporting instructions are in SECURITY.md.

## Native and bundled dependency inventory

| Component | Current distribution boundary | License / distribution note |
| --- | --- | --- |
| Sharp 0.35.4 | npm dependency of File Converter (also used by Next); consumer obtains dependencies from npm | Apache-2.0; license applies to the npm-installed dependency |
| libvips / Sharp native closure | Windows `@img/sharp-win32-x64@0.35.4` is obtained from npm by the consumer | package declares Apache-2.0 AND LGPL-3.0-or-later; preserve the installed package licenses and notices |
| fc-movefile.exe | bundled in File Converter `dist/native/bin/` | owner-controlled helper; attribution in NOTICE; helper source and build script retained in the File Converter source root |
| qpdf 12.4.0 | EXTERNAL PREREQUISITE on PATH; not in rc5 tgz or Host package | Apache-2.0 per upstream distribution; independently installed/licensed by user |
| Microsoft VC runtime DLLs | NOT DISTRIBUTED by rc5; prerequisites of independently obtained external qpdf distribution | Microsoft license terms belong to that external distribution; Host makes no redistribution claim |
| ajv 8.20.0 | bundled PDF Tools node_modules | MIT |
| fast-deep-equal 3.1.3 | bundled PDF Tools node_modules | MIT |
| fast-uri 3.1.8 | bundled PDF Tools node_modules | BSD-3-Clause |
| json-schema-traverse 1.0.0 | bundled PDF Tools node_modules | MIT |
| require-from-string 2.0.2 | bundled PDF Tools node_modules | MIT |

The PDF Supplier contains its Apache-2.0 LICENSE and THIRD-PARTY-NOTICES
for bundled npm components. It ships no qpdf/native binaries, runtime manifest
or vendor licenses. Platform-specific Sharp packages differ;
the lockfile lists packages for other platforms without making them supported.

## External prerequisites (not bundled by Host)

| Component | Required capability version | Upstream licensing reference |
| --- | --- | --- |
| Pandoc | >=3.1, external executable with sandbox | [GPL license](https://github.com/jgm/pandoc/blob/main/COPYRIGHT); user-installed |
| LibreOffice | >=7.6, external headless executable | [Upstream licenses](https://www.libreoffice.org/about-us/licenses/); user-installed |
| Node.js | >=24.15.0 <25 | [Node license](https://github.com/nodejs/node/blob/main/LICENSE); user-installed |

## Maintaining this inventory

The source distribution contains the fixed Supplier runtime archives and
dependency metadata, without an installed node_modules tree. Consumers obtain
Sharp and its native dependencies through npm. This distinction does not replace
any dependency license or notice obligation.

Retain upstream texts and attributions for components actually distributed.
Update this inventory whenever the lockfile or vendored artifact bytes change.
Project attribution is in NOTICE. See [distribution baseline](docs/public-baseline.md)
and [SECURITY.md](SECURITY.md).
