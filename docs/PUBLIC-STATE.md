# Eremite public support baseline

This describes Eremite source version v1.6.1 and its source-first support scope.
Canonical source: https://github.com/W-SING-HUNG/Eremite.
Source version identity does not assert that a tag or GitHub Release exists.

## Supported environment and capabilities

Windows x64, Node.js >=24.15.0 <25 (recommended 24.15.0), local single-user use.
Both accepted Suppliers require >=24 <25; the Host minimum is 24.15.0, so the
published range is their intersection. Other platforms/Node majors have not been
accepted. There is no installer or hosted deployment support.

Content includes files and links; Projects contain arbitrary-depth Folders;
Tags classify across modules. Actions, Processing, Trash, immutable file
versions, backups and search operate locally. Viewer is read-only except for
explicit TXT/Markdown editing through the Host file lifecycle. ZIP preview only
lists its directory. Uploads are limited to 512 MiB per file.

## Supplier and AI boundaries

Supplier Core source stays in independent repositories. Host owns UI, routing,
input policy, Run History, validation, database writes and file lifecycle.
File Converter 1.1.2 has 18 accepted conversions, using Sharp, external Pandoc >=3.1
and external LibreOffice >=7.6. Custom executable installations must be on PATH.
PDF Tools 1.0.0-rc5 retains its prerelease identity and supports five operations
with external qpdf 12.4.0 on the process
PATH. rc5 contains no qpdf or Microsoft VC runtime binaries and has no vendor
fallback. Missing or mismatched qpdf makes the capability unavailable. Output
becomes Content only after Host acceptance.

AI is optional, request-bound and OpenAI-compatible. The application stores
Provider keys in Windows Credential Manager. Complete server environment
configuration is a fallback only when no application Provider profile exists.
Host adapters read business context through owner services; AI can create
bounded proposals requiring explicit confirmation. There is no autonomous
agent or direct AI business-table access. Provider requests may leave the device.

## Validation and remaining release work

Clean local install, typecheck, automated contracts and production build form the
engineering baseline. Real conversion engines, Windows SecretStore, isolated
first-run/backup/AI browser acceptance and independent review remain separate
evidence. Tests use disposable synthetic data; real user data is excluded.

Private security reporting is available through enabled GitHub Private
Vulnerability Reporting; the reporting instructions are in SECURITY.md.
Release publication follows its own authorization gates, covering source
provenance, license obligations, distribution notices and reviewed source content.
File Converter 1.1.2, PDF Tools rc5 and Host
integration have completed independent technical acceptance. Sharp/libvips is
VERIFIED FOR PUBLIC DISTRIBUTION for Supplier tgz + consumer obtains dependencies
from npm, as confirmed by the product owner. Canonical source repositories are
recorded in the documentation boundary below. Copyright attribution is finalized as
Copyright 2026 翁成航 (Chenghang Weng). Private security reporting is enabled;
source-first delivery does not imply npm publication or a GitHub Release.

See [documentation boundary](public-baseline.md), [security policy](../SECURITY.md),
[third-party inventory](../THIRD-PARTY-NOTICES.md) and [backup](backup-and-restore.md).
