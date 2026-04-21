# Security Policy

## Threat Model

The HTTP viewer server binds to `127.0.0.1` only and is intended for local use.
It must not be exposed on a public network interface.

The MCP server communicates over stdio and opens no network ports.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅        |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Use [GitHub's private security advisory](https://github.com/1vav/embedded-editor-for-claude-code/security/advisories/new) instead.
We aim to respond within 7 days and publish a fix within 30 days.
