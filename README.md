# AxonSSH

A local-first desktop workspace for SSH servers, terminals, and AI-assisted operations. Built with Electron, React, and TypeScript; inspired by the task-oriented layouts of Codex Desktop and Claude Desktop.

> **v0.1.0 alpha:** real SSH and local terminals, encrypted credential storage, model-assisted command proposals, and optional local CLI adapters. Every command submitted through the application's remote execution entry point requires native confirmation.

![AxonSSH desktop workspace](docs/screenshot.png)

中文：AxonSSH 是一款本地优先的 SSH 桌面工作台，包含真实终端、服务器管理、SFTP 目录浏览、内置运维建议助手和可选 Codex / Claude Code 接入。初版支持逐条审批执行远程命令；尚未实现自主多步运维、文件编辑与断线恢复。

## Quick start

Requires Node.js **22.12 or newer**, npm, and native build tools for `node-pty`.

```bash
git clone https://github.com/Yuna-Celisse/AxonSSH.git
cd AxonSSH
npm ci
npm run dev
```

Native prerequisites: macOS Xcode Command Line Tools; Windows Python and Visual Studio C++ Build Tools; Linux Python, make, GCC/G++, and Electron's GTK/NSS runtime libraries. The install hook rebuilds native modules for Electron.

```bash
npm run typecheck
npm test
npm run test:desktop
npm run build
npm run dist
```

`npm run dist` packages for the current operating system. Output goes to `release/`. Local development builds are unsigned; OS signing and notarization are not configured yet.

Desktop integration tests require a display; on Linux CI, run `xvfb-run -a npm run test:desktop`. They launch the real Electron application with a temporary profile and local SSH/model fixtures, and intercept native dialogs only inside the test process.

## Implemented

- Server profiles with groups, search, password/private-key/SSH-agent authentication, edit and delete.
- Native host-key confirmation on first connection and pinned SHA-256 host keys; changed keys are rejected.
- Real SSH PTY and local terminal tabs, xterm rendering, resize, terminal search, and maximize.
- Independent SSH `exec` channels for approved commands, separate stdout/stderr, exit status, bounded output, and a 60-second timeout.
- SFTP directory browsing, including parent navigation and explicit path input.
- Built-in advisory assistant using an OpenAI-compatible Chat Completions endpoint. Supports local HTTP endpoints and remote HTTPS endpoints.
- Structured command proposals, exact target/command binding, single-use approval tokens, and a native confirmation dialog before execution.
- Optional Codex CLI and Claude Code detection, advisory chat adapters, cancellation, and native interactive CLI terminal launch.
- SQLite persistence (SQL.js) and OS-backed Electron `safeStorage` encryption; secrets are never returned through the renderer API.
- Local operation history, including unknown status after transport errors or timeout.
- A browser-only UI preview that explicitly disables SSH, terminal, model, and credential operations.

## First session

1. Add a server. SSH Agent is recommended; private-key paths support `~`.
2. Open its terminal. Verify the host fingerprint through a trusted channel before accepting.
3. In **Settings & models**, configure an API base URL (for example `https://api.openai.com/v1`), model, and API key. The default model name is editable.
4. Ask for diagnostic steps. The assistant does **not** have live server data and cannot automatically run commands.
5. Review a proposed command, click **Approve and execute**, and confirm its exact target and contents in the native dialog.
6. Use **Add to next analysis** to explicitly include command output in a subsequent model request.

Tasks are independent prompts in this alpha. The visible conversation is not automatically resent; include relevant previous output explicitly. Chat transcripts are currently held in memory, while server profiles, settings, and command history persist.

## Codex CLI / Claude Code

Install and authenticate the CLI separately using its own official instructions. AxonSSH detects executables in `PATH`, `~/.local/bin`, `~/.npm-global/bin`, and common macOS package-manager locations. CLI installation does not establish authentication readiness.

- **Codex advisory chat:** runs `codex -a never exec --json --sandbox read-only --skip-git-repo-check`. Parses completed agent-message JSONL events. This is the existing CLI's non-interactive mode, not an integration with the experimental app-server protocol.
- **Claude advisory chat:** runs `claude -p … --output-format stream-json --verbose --tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}'`. Built-in tools and MCP servers are disabled for this path.
- **Native CLI terminal:** starts the installed CLI in a local PTY. Its own permissions and authentication apply; this mode is not restricted by AxonSSH's remote-command approval layer.
- Chat adapters need compatible CLI versions and are best effort. They do not support provider-session restoration, bidirectional tool approval, or MCP remote tools yet. On Windows, `.cmd`/`.bat` installations use the native terminal; the chat adapter currently requires an `.exe`.

The Codex read-only sandbox restricts filesystem writes according to Codex and the host platform. It does not mean that all reads or network activity are forbidden. CLI prompts are not a security boundary. No SSH credentials are passed to either chat adapter.

## Data and permissions

The database is `axonssh.sqlite` inside Electron's per-user application data directory (`app.getPath('userData')`). Server and API secrets are encrypted with the system backend. On Linux, a usable Secret Service/KWallet backend is required for secret storage; AxonSSH refuses the `basic_text` fallback. SSH Agent profiles need no stored secret.

Model requests contain your task and the selected server's name/address/username. Terminal history, files, and command results are not automatically sent. Review and redact output before explicitly adding it to a prompt. Model and CLI providers have their own authentication and data policies.

Changing the model-provider origin clears the previously stored API key unless a new key is supplied. HTTP redirects are rejected to avoid carrying authorization to another endpoint.

## Alpha limitations

- No jump hosts, full OpenSSH config import, system OpenSSH backend, port forwarding, or multi-host automation.
- No file download/upload/editing, Monaco Diff, or remote configuration rollback yet; the file panel is read-only directory browsing.
- No durable remote-session recovery. Disconnecting SSH closes the session; reconnecting does not restore its shell. No automatic retries for command execution.
- Closing an `exec` channel on timeout/disconnect does not guarantee the remote process is terminated. Check the server before retrying.
- The remote command channel has no interactive stdin; use the SSH terminal for interactive `sudo`, prompts, and long-running work.
- Terminal display has bounded buffers and can omit output under excessive load. It is not a complete session recorder.
- No MCP bridge, persistent agent tasks, automatic multi-step agent loop, or cross-engine session migration yet.
- API responses use non-streaming Chat Completions in this version; compatible providers must return text content.
- No account sync, telemetry, auto-update service, or signed releases configured.

## Architecture and references

See [docs/architecture.md](docs/architecture.md) for process boundaries and [docs/roadmap.md](docs/roadmap.md) for the next milestones.

Design references: [Wave Terminal](https://github.com/wavetermdev/waveterm), [Tabby](https://github.com/Eugeny/tabby), and [Electerm](https://github.com/electerm/electerm). Foundational libraries: [xterm.js](https://github.com/xtermjs/xterm.js), [node-pty](https://github.com/microsoft/node-pty), [ssh2](https://github.com/mscdex/ssh2), and [SQL.js](https://github.com/sql-js/sql.js). AxonSSH is a new implementation and does not copy those applications' UI source.

## License

[Apache-2.0](LICENSE), preserving the repository's original license. Dependencies retain their own licenses.
