# Roadmap

## 0.1 — desktop alpha

Server profiles, host-key verification, local/SSH terminal tabs, directory listing, advisory model and CLI adapters, native command confirmation, operation history, and OS-encrypted secrets.

## 0.2 — reliable daily SSH

- Jump-host chains and commonly used OpenSSH config import.
- Optional system OpenSSH compatibility backend, including hardware-backed identities.
- Per-terminal connection state, explicit reconnect, and optional tmux attachment.
- SFTP downloads/uploads, conflict detection, remote text editing and Diff review.
- Dedicated session workers, improved terminal backpressure, and accessibility/keyboard navigation.
- Better identity management and explicit credential removal/replacement.

## 0.3 — agent task engine

- Local MCP bridge exposing scoped remote tools.
- Official SDK adapters and capability/version detection.
- Enforced restrictions on alternate CLI execution paths before describing any adapter as a controlled agent.
- Durable task events, provider-session restoration, streaming model responses, and bounded context selection.
- Multi-step diagnose → propose → approve → execute → validate workflow.
- Per-resource write locks, configuration backups, and explicit rollback plans.

## Release readiness

Platform-specific SSH Agent tests, signed/notarized installers, release/update service, crash recovery, and high-volume terminal tests. Team collaboration and cloud sync come after local reliability.
