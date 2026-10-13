# Public source and distribution baseline

This maintenance source candidate retains Host package version 1.6.1. Published Host v1.6.1 and Supplier source tags remain unchanged. Candidate generation is distinct from independent acceptance and publication. There is no Windows installer, hosted deployment or npm publication.

## Published source references

| Project | Published source version | Source |
| --- | --- | --- |
| Eremite Host | v1.6.1 | [Eremite](https://github.com/W-SING-HUNG/Eremite) |
| File Converter Core | v1.1.2 | [Eremite-File-Converter-Core](https://github.com/W-SING-HUNG/Eremite-File-Converter-Core) |
| PDF Tools Core | v1.0.0-rc5, prerelease | [Eremite-PDF-Tools-Core](https://github.com/W-SING-HUNG/Eremite-PDF-Tools-Core) |

## Candidate runtime distribution

The Host source contains exactly two fixed runtime archives: `vendor/file-converter/file-converter-core-1.1.3.tgz` and `vendor/pdf-tools/pdf-tools-core-1.0.0-rc5.tgz`. FC 1.1.3 has a corresponding source snapshot and provenance beside the export manifest; the published 1.1.2 source tag does not identify those archive bytes. A source tag or local rebuild alone never proves archive byte identity.

Sharp 0.35.5 and its platform dependencies are installed from npm rather than bundled. PDF rc5 bundles its frozen npm closure and requires external qpdf exactly 12.4.0; qpdf and Microsoft VC binaries are excluded from the source distribution. Pandoc and LibreOffice are external prerequisites. Preserve all third-party licenses and notices for the files actually distributed.

All source packages retain `private: true` as an npm guard; it does not describe GitHub visibility. Host uses Windows x64 and Node >=24.15.0 <25.

## Documentation and acceptance boundary

Public source contains user/developer documentation, contracts and synthetic tests. Internal project summaries, raw engineering evidence, private paths, credentials, build caches and original user data are excluded. Derived support boundaries live in [PUBLIC-STATE](PUBLIC-STATE.md); logs and the manifest accompany the candidate outside its source root. Fresh automated gates and independent acceptance are recorded separately and do not imply new GitHub CI, Tag or Release.
