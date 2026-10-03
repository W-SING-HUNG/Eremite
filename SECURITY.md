# Security policy

## Supported Versions

This policy covers Eremite v1.6.1 source-first distribution. Earlier versions
have no declared security maintenance commitment.

## Reporting a Vulnerability

GitHub Private Vulnerability Reporting is enabled.

Report security vulnerabilities privately through this repository's
**Security → Advisories → Report a vulnerability**, or use
[Report a vulnerability](https://github.com/W-SING-HUNG/Eremite/security/advisories/new).

Do not disclose sensitive vulnerability details in public Issues. Do not submit
API keys, credentials, databases, private files or raw Provider responses.
Include the affected version, a minimal synthetic reproduction, impact and
sanitized diagnostics. Share only what is needed to reproduce.
No response SLA or resolution timeline is promised.

## Local security boundary

Eremite is a single-user application running on the local machine. Supported
dev/start scripts bind to IPv4 loopback (127.0.0.1). Do not expose it through a
public interface, reverse proxy or port forwarding. Local authentication is not
a deployment security model for internet hosting. Protect the OS account,
Credential Manager, data directory and backups.

AI is optional and Provider calls are explicit outbound requests. Review what
context you send and your Provider's privacy policy. AI output remains a proposal
until confirmation; Host validation and authentication still apply.
