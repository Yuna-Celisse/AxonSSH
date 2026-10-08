# Architecture

```text
React renderer
    │ typed, explicitly enumerated IPC through a sandboxed preload
Electron main process
    ├── Store → SQL.js SQLite → atomic database replacement
    │             └── OS safeStorage encryption for secrets
    ├── SSHService → ssh2 shell / exec / SFTP
    ├── LocalTerminals → node-pty
    ├── Approvals → target-bound, expiring, single-use command tickets
    └── AgentService → model HTTP API / local CLI JSONL subprocess
```

The renderer cannot access Node.js, credentials, or arbitrary IPC channels. Main-process handlers validate payloads and verify the calling window/frame. New windows and navigations are denied. The renderer uses a content security policy and renders model output as plain text, not HTML.

Remote command execution is separate from the interactive SSH terminal. The renderer first registers a proposal; the main process snapshots its exact server ID and command. Execution consumes that ticket and presents a native dialog containing the resolved host, port, username, and command. Only the native affirmative response proceeds to SSH `exec`. Changing or disconnecting a server revokes pending tickets. Commands are serialized per server and are never retried automatically.

Host verification uses SHA-256 of the server's public key. A newly accepted fingerprint is persisted only after authentication succeeds. Existing fingerprints must match exactly. Changing the target host or port clears its pin and stored credential.

Terminal output is batched every 24 ms with a bounded pending buffer, a bounded renderer replay buffer, and a 5,000-line xterm scrollback. This alpha drops excess display output instead of attempting complete logging. Commands retain up to approximately 1 MiB of decoded text; excess output is marked as truncated.

SQLite runs in the main process through SQL.js to avoid another native addon. Writes export to a private temporary file and atomically replace the database. This is appropriate for the alpha's small profile/history dataset; a native SQLite service and dedicated I/O worker should replace it if write volume grows. Main-process SSH and PTY orchestration should likewise move to dedicated workers before scaling to many simultaneous sessions.

The built-in assistant is advisory: it returns text and suggested commands. There is no autonomous tool loop or implicit terminal-context collection. External CLI adapters likewise do not receive a remote execution bridge. Interactive CLI terminals retain the user's native CLI privileges.

Provider requests have cancellation and a three-minute deadline. External subprocess output is bounded. CLI protocol compatibility is intentionally isolated in `AgentService`, so a later official SDK/app-server adapter can replace it without changing the server, approval, or terminal layers.
