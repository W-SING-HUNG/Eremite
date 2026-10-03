# Security policy (public launch preparation)

## Supported Versions

This policy describes Eremite v1.6.1 source-first distribution. A supported
security maintenance version matrix requires its own approval; earlier versions
have no declared maintenance commitment.

## Reporting a Vulnerability

Status: **BLOCKED_PENDING_PUBLIC_REPO_SECURITY_CHANNEL**.

GitHub Private Vulnerability Reporting has not been enabled or verified.
Immediately after public cutover, enable it and verify the reporting channel
before inserting its actual usable instructions. No reporting URL or email
is claimed here.

Do not submit vulnerability details, API keys, credentials, databases, private
files or raw Provider responses in a public Issue. Once a private channel is
available, send affected version, minimal reproduction using synthetic data,
impact and sanitized diagnostics. Share only what is needed to reproduce.
No response SLA or resolution timeline is promised by this skeleton.

## Local security boundary

Eremite is a single-user application running on the local machine. Supported
dev/start scripts bind to IPv4 loopback (127.0.0.1). Do not expose it through a
public interface, reverse proxy or port forwarding. Local authentication is not
a deployment security model for internet hosting. Protect the OS account,
Credential Manager, data directory and backups.

AI is optional and Provider calls are explicit outbound requests. Review what
context you send and your Provider's privacy policy. AI output remains a proposal
until confirmation; Host validation and authentication still apply.
