import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Activity as ActivityIcon,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Command,
  Cpu,
  Folder,
  FolderOpen,
  Globe,
  KeyRound,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Search,
  Server as ServerIcon,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import type {
  Activity,
  AgentResult,
  CliInfo,
  CommandResult,
  Engine,
  FileEntry,
  Server,
  ServerInput,
  Settings,
} from "../shared/types";
import TerminalPane from "./TerminalPane";
import { forgetTerminal, startTerminalHub } from "./terminalHub";
import { isPreview } from "./preview";

type Tab = { id: string; title: string; serverId?: string; closed?: boolean };
type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  result?: AgentResult;
  serverId?: string;
};
function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': Error: /,
    "",
  );
}
export default function App() {
  const [servers, setServers] = useState<Server[]>([]),
    [selected, setSelected] = useState<string>();
  const [query, setQuery] = useState(""),
    [view, setView] = useState<"workspace" | "activity">("workspace");
  const [modal, setModal] = useState<"server" | "settings" | null>(null),
    [editing, setEditing] = useState<Server>();
  const [tabs, setTabs] = useState<Tab[]>([]),
    [activeTab, setActiveTab] = useState<string>();
  const [connected, setConnected] = useState<Set<string>>(new Set()),
    [connecting, setConnecting] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]),
    [input, setInput] = useState(""),
    [engine, setEngine] = useState<Engine>("builtin");
  const [taskId, setTaskId] = useState<string>(),
    [cli, setCli] = useState<CliInfo[]>([]);
  const [error, setError] = useState(""),
    [activity, setActivity] = useState<Activity[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]),
    [filePath, setFilePath] = useState("."),
    [showFiles, setShowFiles] = useState(false);
  const [terminalSearch, setTerminalSearch] = useState(""),
    [terminalLarge, setTerminalLarge] = useState(false);
  const [busyCommand, setBusyCommand] = useState<string>(),
    [results, setResults] = useState<Record<string, CommandResult>>({});
  const scrollEnd = useRef<HTMLDivElement>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const selectedServer = servers.find((s) => s.id === selected);
  const report = (e: unknown) => setError(errorText(e));
  const reload = async () => setServers(await window.axon.servers.list());
  useEffect(() => {
    startTerminalHub();
    void reload().catch(report);
    void window.axon.agent.detect().then(setCli).catch(report);
    return window.axon.onEvent((event) => {
      if (event.type === "agent:delta")
        setMessages((current) =>
          current.map((m) =>
            m.id === event.id ? { ...m, text: m.text + event.data } : m,
          ),
        );
      if (event.type === "terminal:closed") {
        const target = tabsRef.current.find((t) => t.id === event.id);
        if (
          target?.serverId &&
          !tabsRef.current.some(
            (t) =>
              t.id !== event.id && t.serverId === target.serverId && !t.closed,
          )
        )
          setConnected((previous) => {
            const next = new Set(previous);
            next.delete(target.serverId!);
            return next;
          });
        setTabs((current) => {
          return current.map((t) =>
            t.id === event.id ? { ...t, closed: true } : t,
          );
        });
      }
    });
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === "1") {
        event.preventDefault();
        setView("workspace");
      }
      if (event.key === ",") {
        event.preventDefault();
        setModal("settings");
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    scrollEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  useEffect(() => {
    setFilePath(".");
    setFiles([]);
    setShowFiles(false);
  }, [selected]);
  async function openTerminal(server?: Server) {
    setError("");
    if (server) setConnecting(server.id);
    try {
      const id = await window.axon.terminal.open(server?.id);
      setTabs((current) => [
        ...current,
        { id, title: server?.name ?? "本地终端", serverId: server?.id },
      ]);
      setActiveTab(id);
      if (server) {
        setSelected(server.id);
        setConnected((current) => new Set(current).add(server.id));
        await reload();
      }
    } catch (e) {
      report(e);
    } finally {
      setConnecting(undefined);
    }
  }
  async function launchCli(name: "codex" | "claude") {
    try {
      const id = await window.axon.terminal.launch(name);
      setTabs((current) => [
        ...current,
        { id, title: name === "codex" ? "Codex CLI" : "Claude Code" },
      ]);
      setActiveTab(id);
    } catch (e) {
      report(e);
    }
  }
  async function closeTab(tab: Tab) {
    try {
      if (!tab.closed) await window.axon.terminal.close(tab.id);
      forgetTerminal(tab.id);
      setTabs((current) => current.filter((t) => t.id !== tab.id));
      if (activeTab === tab.id)
        setActiveTab(tabs.find((t) => t.id !== tab.id)?.id);
    } catch (e) {
      report(e);
    }
  }
  async function disconnect() {
    if (!selected) return;
    try {
      await window.axon.servers.disconnect(selected);
      setConnected((current) => {
        const next = new Set(current);
        next.delete(selected);
        return next;
      });
    } catch (e) {
      report(e);
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!input.trim() || taskId) return;
    const id = crypto.randomUUID(),
      message = input.trim();
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: message,
        serverId: selected,
      },
      { id, role: "assistant", text: "", serverId: selected },
    ]);
    setInput("");
    setTaskId(id);
    setError("");
    try {
      const result = await window.axon.agent.run({
        taskId: id,
        engine,
        message,
        serverId: selected,
      });
      setMessages((current) =>
        current.map((m) =>
          m.id === id ? { ...m, text: result.text, result } : m,
        ),
      );
    } catch (e) {
      setMessages((current) =>
        current.map((m) => (m.id === id ? { ...m, text: errorText(e) } : m)),
      );
    } finally {
      setTaskId(undefined);
    }
  }
  async function execute(serverId: string, command: string, key: string) {
    if (busyCommand) return;
    setBusyCommand(key);
    setError("");
    try {
      await window.axon.servers.connect(serverId);
      const approval = await window.axon.remote.propose(serverId, command);
      const result = await window.axon.remote.execute(approval);
      setResults((current) => ({ ...current, [key]: result }));
      await reload();
    } catch (e) {
      report(e);
    } finally {
      setBusyCommand(undefined);
    }
  }
  async function loadFiles(path: string) {
    if (!selected) return;
    try {
      await window.axon.servers.connect(selected);
      setFiles(await window.axon.remote.files(selected, path));
      setFilePath(path);
      setShowFiles(true);
      await reload();
    } catch (e) {
      report(e);
    }
  }
  async function showActivity() {
    setView("activity");
    try {
      setActivity(await window.axon.activity.list());
    } catch (e) {
      report(e);
    }
  }
  const visibleServers = servers.filter((s) =>
    `${s.name} ${s.host} ${s.group}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const groups = [...new Set(visibleServers.map((s) => s.group || "未分组"))];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Command size={21} />
          </div>
          <span>
            Axon<span className="brand-light">SSH</span>
          </span>
          <span className="version">α</span>
        </div>
        <button
          className="workspace-switch"
          onClick={() => {
            setView("workspace");
            setSelected(undefined);
          }}
        >
          <div className="workspace-icon">
            <TerminalIcon size={17} />
          </div>
          <span>
            我的工作空间<small>Local workspace</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="sidebar-actions">
          <button
            className={view === "workspace" ? "nav-item active" : "nav-item"}
            onClick={() => setView("workspace")}
          >
            <Sparkles size={17} />
            智能工作台<span className="shortcut">⌘ 1</span>
          </button>
          <button
            className={view === "activity" ? "nav-item active" : "nav-item"}
            onClick={showActivity}
          >
            <ActivityIcon size={17} />
            执行记录<span className="count">{activity.length || "—"}</span>
          </button>
        </div>
        <div className="sidebar-heading">
          服务器{" "}
          <button
            aria-label="添加服务器"
            onClick={() => {
              setEditing(undefined);
              setModal("server");
            }}
          >
            <Plus size={16} />
          </button>
        </div>
        <label className="server-search">
          <Search size={14} />
          <input
            placeholder="搜索名称或主机…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="server-list">
          {groups.map((group) => (
            <div key={group}>
              <div className="group-label">
                <ChevronDown size={12} />
                {group}
                <span>
                  {
                    visibleServers.filter(
                      (s) => (s.group || "未分组") === group,
                    ).length
                  }
                </span>
              </div>
              {visibleServers
                .filter((s) => (s.group || "未分组") === group)
                .map((server) => (
                  <button
                    key={server.id}
                    className={`server-row ${selected === server.id ? "selected" : ""}`}
                    onClick={() => {
                      setSelected(server.id);
                      setView("workspace");
                    }}
                  >
                    <ServerIcon size={16} />
                    <span>
                      {server.name}
                      <small>{server.host}</small>
                    </span>
                    <i
                      className={
                        connected.has(server.id)
                          ? "status-dot online"
                          : "status-dot"
                      }
                    />
                  </button>
                ))}
            </div>
          ))}
          {!servers.length && (
            <div className="sidebar-empty">
              <ServerIcon size={24} />
              <p>连接你的第一台服务器</p>
              <button
                onClick={() => {
                  setEditing(undefined);
                  setModal("server");
                }}
              >
                添加服务器 <Plus size={13} />
              </button>
            </div>
          )}
          {servers.length > 0 && !visibleServers.length && (
            <p className="muted sidebar-no-results">没有匹配的服务器</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-note">
            <ShieldCheck size={14} />
            <span>数据保存在本机</span>
            <i className="status-dot online" />
          </div>
          <button className="nav-item" onClick={() => setModal("settings")}>
            <SettingsIcon size={17} />
            设置与模型
          </button>
          <div className="profile">
            <span className="avatar">A</span>
            <div>
              个人工作空间<small>AxonSSH · v0.1.0</small>
            </div>
            <MoreHorizontal size={17} />
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span>工作空间</span>
            <ChevronRight size={14} />
            <strong>
              {view === "activity"
                ? "执行记录"
                : (selectedServer?.name ?? "智能工作台")}
            </strong>
          </div>
          <div className="topbar-right">
            {isPreview && <span className="badge warning">浏览器界面预览</span>}
            <span className="badge">
              <ShieldCheck size={12} />
              本地优先
            </span>
            <button
              className="icon-button"
              aria-label="设置"
              onClick={() => setModal("settings")}
            >
              <SettingsIcon size={17} />
            </button>
          </div>
        </header>
        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button aria-label="关闭错误" onClick={() => setError("")}>
              <X size={15} />
            </button>
          </div>
        )}
        {view === "activity" ? (
          <div className="activity-view">
            <div className="section-eyebrow">OPERATIONS</div>
            <h1>执行记录</h1>
            <p className="muted">
              记录经过确认的远程命令，保存在本机。未知退出状态的命令不会自动重试。
            </p>
            {!activity.length ? (
              <div className="empty-record">
                <ActivityIcon size={32} />
                <h3>还没有执行记录</h3>
                <p>在工作台执行命令后，记录会显示在这里。</p>
              </div>
            ) : (
              <div className="activity-table">
                <div className="activity-row table-heading">
                  <span>命令 / 服务器</span>
                  <span>退出状态</span>
                  <span>时间</span>
                </div>
                {activity.map((a) => (
                  <div className="activity-row" key={a.id}>
                    <div>
                      <code>{a.command}</code>
                      <small>
                        {servers.find((s) => s.id === a.serverId)?.name ??
                          "已删除服务器"}{" "}
                        · {a.durationMs} ms
                      </small>
                    </div>
                    <span
                      className={`badge ${a.code === 0 ? "success" : "warning"}`}
                    >
                      {a.code === null ? "未知" : `exit ${a.code}`}
                    </span>
                    <small>{new Date(a.createdAt).toLocaleString()}</small>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {selectedServer && (
              <div className="server-toolbar">
                <div>
                  <ServerIcon size={17} />
                  <strong>{selectedServer.name}</strong>
                  <span>
                    {selectedServer.username}@{selectedServer.host}:
                    {selectedServer.port}
                  </span>
                  <span
                    className={`badge ${connected.has(selectedServer.id) ? "success" : ""}`}
                  >
                    {connected.has(selectedServer.id) ? "会话已打开" : "未连接"}
                  </span>
                </div>
                <div>
                  <button
                    className="text-button"
                    onClick={() => loadFiles(filePath)}
                  >
                    <FolderOpen size={14} />
                    文件
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      setEditing(selectedServer);
                      setModal("server");
                    }}
                  >
                    编辑
                  </button>
                  {connected.has(selectedServer.id) && (
                    <button
                      className="icon-button"
                      title="断开连接"
                      onClick={disconnect}
                    >
                      <Unplug size={15} />
                    </button>
                  )}
                  <button
                    className="small-primary"
                    disabled={!!connecting}
                    onClick={() => openTerminal(selectedServer)}
                  >
                    {connecting === selectedServer.id ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <TerminalIcon size={14} />
                    )}
                    打开终端
                  </button>
                </div>
              </div>
            )}
            <div
              className={`work-content ${terminalLarge ? "terminal-expanded" : ""}`}
            >
              <div className="conversation">
                {!messages.length ? (
                  <div className="welcome">
                    <div className="section-eyebrow">
                      <span className="tiny-line" /> YOUR SERVERS. YOUR
                      WORKSPACE.
                    </div>
                    <div className="welcome-symbol">
                      <Command size={31} />
                    </div>
                    <h1>从连接，到解决问题。</h1>
                    <p className="welcome-description">
                      终端、服务器与智能体，在同一个工作空间。
                      <br />
                      让繁琐的运维，变成清晰的下一步。
                    </p>
                    <div className="welcome-buttons">
                      <button
                        className="primary-button"
                        onClick={() => {
                          setEditing(undefined);
                          setModal("server");
                        }}
                      >
                        <Plus size={16} />
                        添加服务器
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => openTerminal()}
                      >
                        <TerminalIcon size={16} />
                        打开本地终端
                      </button>
                    </div>
                    <div className="suggestion-grid">
                      {[
                        {
                          icon: ActivityIcon,
                          title: "排查服务异常",
                          subtitle: "分析问题，生成诊断命令",
                          prompt:
                            "帮我排查服务器服务异常。先提供不修改系统的诊断步骤和命令。",
                        },
                        {
                          icon: Cpu,
                          title: "检查服务器状态",
                          subtitle: "了解 CPU、内存与磁盘",
                          prompt:
                            "建议查看 CPU、内存、磁盘和负载的命令，并解释如何判断异常。",
                        },
                        {
                          icon: ShieldCheck,
                          title: "检查 SSH 配置",
                          subtitle: "检查配置与认证风险",
                          prompt:
                            "给我一套检查 SSH 服务安全配置的只读诊断命令，不要修改配置。",
                        },
                      ].map((item) => (
                        <button
                          className="suggestion-card"
                          key={item.title}
                          onClick={() => setInput(item.prompt)}
                        >
                          <item.icon size={19} />
                          <strong>{item.title}</strong>
                          <small>{item.subtitle}</small>
                          <ArrowUpRight size={15} />
                        </button>
                      ))}
                    </div>
                    <div className="welcome-footnote">
                      <KeyRound size={13} />
                      凭据留在本机 · 远程命令执行前确认
                    </div>
                  </div>
                ) : (
                  <div className="message-list">
                    {messages.map((message) => (
                      <div
                        className={`message ${message.role}`}
                        key={message.id}
                      >
                        <div className="message-avatar">
                          {message.role === "user" ? (
                            "你"
                          ) : (
                            <Sparkles size={16} />
                          )}
                        </div>
                        <div className="message-body">
                          <div className="message-heading">
                            {message.role === "user" ? "你" : "运维助手"}
                            <small>
                              {servers.find((s) => s.id === message.serverId)
                                ?.name ?? "本地工作空间"}
                            </small>
                          </div>
                          <div className="message-text">
                            {message.text || (
                              <span className="thinking">
                                <LoaderCircle size={14} className="spin" />
                                正在分析…
                              </span>
                            )}
                          </div>
                          {message.result?.proposals.map((proposal, index) => {
                            const key = `${message.id}:${index}`;
                            return (
                              <div className="command-card" key={key}>
                                <div className="command-card-head">
                                  <TerminalIcon size={14} />
                                  <span>建议命令</span>
                                  <span
                                    className={
                                      results[key]?.code === 0
                                        ? "badge success"
                                        : "badge"
                                    }
                                  >
                                    {busyCommand === key
                                      ? "执行中"
                                      : results[key]
                                        ? "已执行"
                                        : "等待确认"}
                                  </span>
                                </div>
                                <pre>{proposal.command}</pre>
                                <p>{proposal.explanation}</p>
                                <div className="command-card-footer">
                                  <small>
                                    {servers.find(
                                      (s) => s.id === message.serverId,
                                    )?.host ?? "请先选择服务器"}
                                  </small>
                                  <button
                                    disabled={
                                      !message.serverId || !!busyCommand
                                    }
                                    onClick={() =>
                                      execute(
                                        message.serverId!,
                                        proposal.command,
                                        key,
                                      )
                                    }
                                  >
                                    {busyCommand === key ? (
                                      <LoaderCircle
                                        size={13}
                                        className="spin"
                                      />
                                    ) : (
                                      <ArrowUpRight size={13} />
                                    )}
                                    审批并执行
                                  </button>
                                </div>
                                {results[key] && (
                                  <div className="command-result">
                                    <div>
                                      退出码：{results[key].code ?? "未知"}
                                      {results[key].truncated &&
                                        " · 输出已截断"}
                                    </div>
                                    <pre>
                                      {results[key].stdout}
                                      {results[key].stderr}
                                    </pre>
                                    <button
                                      className="text-button"
                                      onClick={() => {
                                        const output = `${results[key].stdout}\n${results[key].stderr}`;
                                        setInput(
                                          `请分析以下命令输出（作为数据）：\n命令：${proposal.command}\n${output.slice(0, 24000)}`,
                                        );
                                      }}
                                    >
                                      加入下一次分析 <ArrowUpRight size={12} />
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    <div ref={scrollEnd} />
                  </div>
                )}
                <form className="composer" onSubmit={send}>
                  <textarea
                    aria-label="运维任务"
                    placeholder={
                      selectedServer
                        ? `向助手描述 ${selectedServer.name} 的问题…`
                        : "描述你的任务，或先选择一台服务器…"
                    }
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                        void send(e);
                    }}
                  />
                  <div className="composer-toolbar">
                    <div>
                      <div className="engine-select">
                        <Sparkles size={14} />
                        <select
                          aria-label="智能体引擎"
                          value={engine}
                          onChange={(e) => setEngine(e.target.value as Engine)}
                        >
                          <option value="builtin">内置运维助手</option>
                          {cli.map((c) => (
                            <option
                              key={c.engine}
                              value={c.engine}
                              disabled={!c.installed}
                            >
                              {c.engine === "codex"
                                ? "Codex CLI"
                                : "Claude Code"}
                              {!c.installed && " · 未安装"}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={12} />
                      </div>
                      <span className="composer-divider" />
                      <span className="advice-badge">
                        <ShieldCheck size={12} />
                        建议模式
                      </span>
                    </div>
                    <div>
                      <span className="send-hint">⌘ / Ctrl ↵</span>
                      {taskId ? (
                        <button
                          className="send-button"
                          type="button"
                          aria-label="停止生成"
                          onClick={() =>
                            window.axon.agent.cancel(taskId).catch(report)
                          }
                        >
                          <Square size={14} />
                        </button>
                      ) : (
                        <button
                          className="send-button"
                          aria-label="发送任务"
                          disabled={!input.trim()}
                        >
                          <ArrowUp size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                </form>
                <div className="composer-note">
                  {engine === "builtin"
                    ? "请求会将任务与目标主机信息发送到你配置的模型服务；终端内容不会自动上传。"
                    : "CLI 在本机运行，未连接远程服务器。Codex 使用只读沙箱；Claude 禁用工具。"}
                </div>
              </div>
              {showFiles && (
                <aside className="file-panel">
                  <div className="file-panel-heading">
                    <FolderOpen size={15} />
                    远程文件
                    <button
                      aria-label="关闭文件面板"
                      onClick={() => setShowFiles(false)}
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <form
                    className="file-path"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void loadFiles(filePath);
                    }}
                  >
                    <input
                      aria-label="远程路径"
                      value={filePath}
                      onChange={(e) => setFilePath(e.target.value)}
                    />
                    <button title="刷新目录">
                      <ArrowUpRight size={14} />
                    </button>
                  </form>
                  <button
                    className="parent-folder"
                    onClick={() => loadFiles(`${filePath}/..`)}
                  >
                    <ArrowLeft size={13} />
                    上一级
                  </button>
                  {files.map((file) => (
                    <button
                      className="file-row"
                      key={file.name}
                      disabled={!file.directory}
                      onClick={() =>
                        loadFiles(`${filePath.replace(/\/$/, "")}/${file.name}`)
                      }
                    >
                      {file.directory ? (
                        <Folder size={14} />
                      ) : (
                        <span className="file-dot" />
                      )}
                      <span>{file.name}</span>
                      <small>
                        {file.directory
                          ? ""
                          : `${Math.ceil(file.size / 1024)} KB`}
                      </small>
                    </button>
                  ))}
                  {!files.length && <p className="muted">目录为空</p>}
                  <p className="file-panel-note">
                    初版提供目录浏览；文件编辑与传输将在后续版本加入。
                  </p>
                </aside>
              )}
            </div>
            <section
              className={`terminal-section ${terminalLarge ? "expanded" : ""}`}
            >
              <div className="terminal-toolbar">
                <div className="terminal-tabs">
                  <span className="terminal-label">
                    <TerminalIcon size={14} />
                    TERMINAL
                  </span>
                  {tabs.map((tab) => (
                    <div
                      key={tab.id}
                      className={`terminal-tab ${tab.id === activeTab ? "active" : ""}`}
                    >
                      <button onClick={() => setActiveTab(tab.id)}>
                        <i
                          className={
                            tab.closed ? "status-dot" : "status-dot online"
                          }
                        />
                        {tab.title}
                      </button>
                      <button
                        aria-label={`关闭 ${tab.title}`}
                        onClick={() => closeTab(tab)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="icon-button"
                    title="新建本地终端"
                    onClick={() => openTerminal()}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                <div className="terminal-tools">
                  {tabs.length > 0 && (
                    <label>
                      <Search size={13} />
                      <input
                        aria-label="搜索终端输出"
                        placeholder="查找"
                        value={terminalSearch}
                        onChange={(e) => setTerminalSearch(e.target.value)}
                      />
                    </label>
                  )}
                  <button
                    className="icon-button"
                    title="终端最大化"
                    onClick={() => setTerminalLarge((v) => !v)}
                  >
                    {terminalLarge ? (
                      <ArrowDown size={14} />
                    ) : (
                      <ArrowUp size={14} />
                    )}
                  </button>
                </div>
              </div>
              <div className="terminal-body">
                {tabs.length ? (
                  tabs.map((tab) => (
                    <TerminalPane
                      key={tab.id}
                      id={tab.id}
                      active={tab.id === activeTab}
                      search={terminalSearch}
                    />
                  ))
                ) : (
                  <div className="terminal-empty">
                    <TerminalIcon size={24} />
                    <div>
                      <strong>准备好连接了。</strong>
                      <p>打开本地终端，或选择服务器开始 SSH 会话。</p>
                    </div>
                    <button onClick={() => openTerminal()}>
                      新建终端 <Plus size={13} />
                    </button>
                  </div>
                )}
              </div>
              <div className="terminal-status">
                <span>
                  <i className="status-dot online" />
                  {tabs.filter((t) => !t.closed).length} 个活跃终端
                </span>
                <span>
                  UTF-8<span className="status-separator">·</span>xterm-256color
                  <span className="status-separator">·</span>v0.1.0
                </span>
              </div>
            </section>
          </>
        )}
      </main>
      {modal === "server" && (
        <ServerModal
          server={editing}
          close={() => setModal(null)}
          save={async (input) => {
            const server = await window.axon.servers.save(input);
            await reload();
            setSelected(server.id);
            setModal(null);
          }}
          remove={async (id) => {
            await window.axon.servers.remove(id);
            await reload();
            setSelected(undefined);
            setModal(null);
          }}
        />
      )}
      {modal === "settings" && (
        <SettingsModal
          close={() => setModal(null)}
          cli={cli}
          refreshCli={async () => setCli(await window.axon.agent.detect())}
          launch={launchCli}
        />
      )}
    </div>
  );
}

function ServerModal({
  server,
  close,
  save,
  remove,
}: {
  server?: Server;
  close(): void;
  save(input: ServerInput): Promise<void>;
  remove(id: string): Promise<void>;
}) {
  const [value, setValue] = useState<ServerInput>(
    server
      ? {
          id: server.id,
          name: server.name,
          host: server.host,
          port: server.port,
          username: server.username,
          group: server.group,
          authType: server.authType,
          privateKeyPath: server.privateKeyPath,
        }
      : {
          name: "",
          host: "",
          port: 22,
          username: "root",
          group: "个人服务器",
          authType: "agent",
        },
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await save(value);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) close();
      }}
    >
      <form
        className="modal"
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="server-title"
      >
        <div className="modal-head">
          <div className="modal-icon">
            <ServerIcon size={20} />
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <h2 id="server-title">{server ? "编辑服务器" : "添加服务器"}</h2>
        <p className="muted">保存连接配置，凭据由系统安全存储加密。</p>
        <label>
          名称
          <input
            required
            maxLength={100}
            placeholder="例如：生产环境 Web"
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
          />
        </label>
        <div className="form-row">
          <label>
            主机地址
            <input
              required
              placeholder="192.168.1.10 或域名"
              value={value.host}
              onChange={(e) => setValue({ ...value, host: e.target.value })}
            />
          </label>
          <label className="port-field">
            端口
            <input
              required
              type="number"
              min={1}
              max={65535}
              value={value.port}
              onChange={(e) =>
                setValue({ ...value, port: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            用户名
            <input
              required
              value={value.username}
              onChange={(e) => setValue({ ...value, username: e.target.value })}
            />
          </label>
          <label>
            分组
            <input
              value={value.group}
              onChange={(e) => setValue({ ...value, group: e.target.value })}
            />
          </label>
        </div>
        <label>
          认证方式
          <select
            value={value.authType}
            onChange={(e) =>
              setValue({
                ...value,
                authType: e.target.value as ServerInput["authType"],
                secret: undefined,
              })
            }
          >
            <option value="agent">SSH Agent（推荐）</option>
            <option value="key">私钥文件</option>
            <option value="password">密码</option>
          </select>
        </label>
        {value.authType === "key" && (
          <label>
            私钥路径
            <input
              required
              placeholder="~/.ssh/id_ed25519"
              value={value.privateKeyPath ?? ""}
              onChange={(e) =>
                setValue({ ...value, privateKeyPath: e.target.value })
              }
            />
          </label>
        )}
        {value.authType !== "agent" && (
          <label>
            {value.authType === "key" ? "私钥口令（可选）" : "密码"}
            <input
              type="password"
              autoComplete="new-password"
              placeholder={server?.hasSecret ? "留空保留现有凭据" : ""}
              onChange={(e) =>
                setValue({ ...value, secret: e.target.value || undefined })
              }
            />
          </label>
        )}
        <div className="form-note">
          <ShieldCheck size={15} />
          <span>首次连接需确认主机指纹。不会自动信任变化的密钥。</span>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-footer">
          {server && (
            <button
              type="button"
              className="danger-button"
              disabled={busy}
              onClick={async () => {
                if (confirm(`删除服务器“${server.name}”？`)) {
                  setBusy(true);
                  try {
                    await remove(server.id);
                  } catch (e) {
                    setError(errorText(e));
                  } finally {
                    setBusy(false);
                  }
                }
              }}
            >
              <Trash2 size={14} />
              删除
            </button>
          )}
          <button
            type="button"
            className="secondary-button"
            onClick={close}
            disabled={busy}
          >
            取消
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Check size={14} />
            )}
            保存服务器
          </button>
        </div>
      </form>
    </div>
  );
}
function SettingsModal({
  close,
  cli,
  refreshCli,
  launch,
}: {
  close(): void;
  cli: CliInfo[];
  refreshCli(): Promise<void>;
  launch(engine: "codex" | "claude"): Promise<void>;
}) {
  const [settings, setSettings] = useState<Settings>(),
    [apiKey, setApiKey] = useState<string>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    window.axon.settings
      .get()
      .then(setSettings)
      .catch((e) => setError(errorText(e)));
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setBusy(true);
    setError("");
    try {
      setSettings(
        await window.axon.settings.save({
          baseUrl: settings.baseUrl,
          model: settings.model,
          apiKey,
        }),
      );
      setApiKey(undefined);
      setSaved(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-overlay">
      <form
        className="modal settings-modal"
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="modal-head">
          <div className="modal-icon">
            <SettingsIcon size={20} />
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <h2 id="settings-title">设置与模型</h2>
        <p className="muted">使用兼容 OpenAI Chat Completions 的模型服务。</p>
        {settings && (
          <>
            <label>
              API Base URL
              <input
                required
                type="url"
                value={settings.baseUrl}
                onChange={(e) => {
                  setSettings({ ...settings, baseUrl: e.target.value });
                  setSaved(false);
                }}
              />
            </label>
            <label>
              模型
              <input
                required
                value={settings.model}
                onChange={(e) =>
                  setSettings({ ...settings, model: e.target.value })
                }
              />
            </label>
            <label>
              API Key
              <input
                type="password"
                value={apiKey ?? ""}
                autoComplete="new-password"
                placeholder={
                  settings.hasApiKey
                    ? "已加密保存，留空保留"
                    : "sk-…（本地模型可留空）"
                }
                onChange={(e) => setApiKey(e.target.value || undefined)}
              />
            </label>
            <small className="muted">
              更换服务域名时，请重新填写 API Key。远程服务必须使用 HTTPS。
            </small>
          </>
        )}
        <div className="settings-divider" />
        <div className="cli-heading">
          <h3>外部智能体</h3>
          <button
            type="button"
            className="text-button"
            onClick={() => refreshCli().catch((e) => setError(errorText(e)))}
          >
            重新检测
          </button>
        </div>
        {cli.map((c) => (
          <div className="cli-row" key={c.engine}>
            <div className="cli-logo">
              <Bot size={18} />
            </div>
            <div>
              <strong>
                {c.engine === "codex" ? "Codex CLI" : "Claude Code"}
              </strong>
              <small>
                {c.installed ? c.path : "未在 PATH 或常见安装目录中发现"}
              </small>
            </div>
            <button
              type="button"
              disabled={!c.installed}
              className="secondary-button"
              onClick={() => {
                void launch(c.engine);
                close();
              }}
            >
              在终端打开
            </button>
          </div>
        ))}
        <div className="form-note">
          <ShieldCheck size={15} />
          <span>
            原生 CLI
            终端拥有用户自己的本地权限；应用的远程命令审批只适用于“审批并执行”入口。
          </span>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-footer">
          {saved && (
            <span className="saved-note">
              <Check size={14} />
              已保存
            </span>
          )}
          <button type="button" className="secondary-button" onClick={close}>
            关闭
          </button>
          <button className="primary-button" disabled={busy || !settings}>
            {busy ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Check size={14} />
            )}
            保存设置
          </button>
        </div>
      </form>
    </div>
  );
}
