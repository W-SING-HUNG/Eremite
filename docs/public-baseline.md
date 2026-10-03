# Public source and distribution baseline

The public repositories contain source, tests, contracts and user/developer
documentation. Eremite runs locally from source; no Windows installer, hosted
deployment or npm package is currently provided.

## Repositories and versions

| Project | Current version | Source |
| --- | --- | --- |
| Eremite Host | v1.6.1 | [Eremite](https://github.com/W-SING-HUNG/Eremite) |
| File Converter Core | v1.1.2 | [Eremite-File-Converter-Core](https://github.com/W-SING-HUNG/Eremite-File-Converter-Core) |
| PDF Tools Core | v1.0.0-rc5, prerelease | [Eremite-PDF-Tools-Core](https://github.com/W-SING-HUNG/Eremite-PDF-Tools-Core) |

Eremite's [v1.6.1 GitHub Release](https://github.com/W-SING-HUNG/Eremite/releases/tag/v1.6.1)
provides its release notes. Both Supplier repositories have source version tags.
A source tag identifies the source tree; it is not a compiled runtime package.

## Runtime distribution

The Host source contains two fixed Supplier runtime archives:

- `vendor/file-converter/file-converter-core-1.1.2.tgz`
- `vendor/pdf-tools/pdf-tools-core-1.0.0-rc5.tgz`

These archives supply compiled capability code used by Host. Building a Supplier
source tag creates a separate artifact; it does not replace the Host-vendored
archive or establish byte identity with it. Public documentation changes do not
update documentation embedded in those fixed archives.

File Converter's Sharp dependency and platform packages are obtained through npm
during dependency installation. The PDF Tools archive contains its npm runtime
dependencies. Pandoc, LibreOffice and qpdf are external prerequisites installed
separately by the user. PDF Tools requires qpdf exactly 12.4.0 and redistributes
neither qpdf nor Microsoft VC runtime binaries.

All three source packages retain `private: true` to prevent accidental npm
publication. That flag does not describe GitHub repository visibility.

## Supported use and security

The Host supports Windows x64 with Node.js >=24.15.0 <25; 24.15.0 is recommended.
Suppliers require Node.js >=24 <25. The supported Host deployment is local and
single-user, with application scripts bound to `127.0.0.1`.

GitHub Private Vulnerability Reporting is enabled in each repository. Report a
vulnerability to the repository that owns the affected component, using its
SECURITY.md instructions. Do not disclose sensitive details in public Issues.

## Licensing

Owner-controlled source is Apache-2.0. The standard [LICENSE](../LICENSE) text
remains unmodified; project attribution is in [NOTICE](../NOTICE).

Copyright 2026 翁成航 (Chenghang Weng).

Supplier archives, npm dependencies and native components retain their own
licenses and notices. Preserve the notices for files actually distributed.
See the [third-party inventory](../THIRD-PARTY-NOTICES.md).

For setup and capabilities, start with the [README](../README.md) and
[current public state](PUBLIC-STATE.md). Contribution and support instructions
are in [CONTRIBUTING.md](../CONTRIBUTING.md) and [SUPPORT.md](../SUPPORT.md).
