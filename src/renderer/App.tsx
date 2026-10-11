import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Activity as ActivityIcon,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  ArrowRightLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Command,
  Copy,
  Download,
  Folder,
  FolderOpen,
  Globe,
  KeyRound,
  LoaderCircle,
  MoreHorizontal,
  MessageSquare,
  Pencil,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
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
  Session,
  SessionMessage,
  Project,
  PermissionPolicy,
} from "../shared/types";
import TerminalPane from "./TerminalPane";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import SelectMenu from "./SelectMenu";
import ThemeSettings from "./ThemeSettings";
import AgentOptionsPicker from "./AgentOptionsPicker";
import HandoffPanel from "./HandoffPanel";
import ProjectSidebar from "./ProjectSidebar";
import ProjectModal from "./ProjectModal";
import { forgetTerminal, startTerminalHub } from "./terminalHub";
import { isPreview } from "./preview";
import { version } from "../../package.json";
import {
  loadWorkspaces,
  newWorkspace,
  workspaceStorageKey,
  type Workspace,
} from "./workspaces";

type Tab = {
  id: string;
  title: string;
  workspaceId: string;
  type?: "terminal" | "files" | "activity" | "handoff";
  serverId?: string;
  closed?: boolean;
};
type Message = SessionMessage & {
  workspaceId: string;
  sessionId: string;
};
function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': Error: /,
    "",
  );
}
export default function App() {
  const [workspaceState, setWorkspaceState] = useState(loadWorkspaces);
  const workspace = workspaceState.workspaces.find(
    (w) => w.id === workspaceState.activeId,
  )!;
  function updateWorkspace(patch: Partial<Workspace>, id = workspace.id) {
    setWorkspaceState((current) => ({
      ...current,
      workspaces: current.workspaces.map((w) =>
        w.id === id ? { ...w, ...patch } : w,
      ),
    }));
  }
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem("axonssh.sidebar-width");
    return saved ? Math.max(180, Math.min(480, Number(saved))) : 244;
  });
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(() => {
    const saved = localStorage.getItem("axonssh.right-panel-width");
    return saved ? Math.max(260, Math.min(900, Number(saved))) : 380;
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);

  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const rightPanelWidthRef = useRef(rightPanelWidth);
  rightPanelWidthRef.current = rightPanelWidth;

  useEffect(() => {
    if (!isResizingSidebar) return;
    const onMouseMove = (e: MouseEvent) => {
      const max = Math.floor(window.innerWidth * 0.45);
      const next = Math.max(180, Math.min(max, e.clientX));
      sidebarWidthRef.current = next;
      setSidebarWidth(next);
    };
    const onMouseUp = () => {
      setIsResizingSidebar(false);
      localStorage.setItem(
        "axonssh.sidebar-width",
        String(sidebarWidthRef.current),
      );
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    if (!isResizingRight) return;
    const onMouseMove = (e: MouseEvent) => {
      const max = Math.floor(window.innerWidth * 0.75);
      const next = Math.max(260, Math.min(max, window.innerWidth - e.clientX));
      rightPanelWidthRef.current = next;
      setRightPanelWidth(next);
    };
    const onMouseUp = () => {
      setIsResizingRight(false);
      localStorage.setItem(
        "axonssh.right-panel-width",
        String(rightPanelWidthRef.current),
      );
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizingRight]);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [editingProject, setEditingProject] = useState<Project>();
  const workspaceProjects = projects.filter(
    (p) => p.workspaceId === workspace.id,
  );
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const workspaceSessions = sessions
    .filter((s) => s.workspaceId === workspace.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const session =
    workspaceSessions.find((s) => s.id === workspace.activeSessionId) ??
    workspaceSessions[0];
  const currentProject = workspaceProjects.find(
    (p) => p.id === session?.projectId,
  );
  const permissions = session?.permissions ?? "ask";
  const { selected, view, engine, terminalOpen, agentOpen } = workspace;
  const setSelected = (selected?: string) => {
    if (
      currentProject &&
      selected &&
      !currentProject.serverIds.includes(selected)
    ) {
      report(new Error("请选择项目关联的服务器"));
      return;
    }
    if (session)
      void window.axon.sessions
        .update(session.id, { serverId: selected ?? null })
        .then((next) => {
          mergeSession(next);
          updateWorkspace({ selected });
        })
        .catch(report);
  };
  const setView = (view: Workspace["view"]) => updateWorkspace({ view });
  const setEngine = (engine: Engine) => {
    updateWorkspace({ engine });
    if (session)
      void window.axon.sessions
        .update(session.id, { engine })
        .then(mergeSession)
        .catch(report);
  };
  const [servers, setServers] = useState<Server[]>([]);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<
      "server" | "settings" | "workspace" | "project" | null
    >(null),
    [editing, setEditing] = useState<Server>();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabs, setActiveTabs] = useState<
    Record<string, string | undefined>
  >({});
  const workspaceTabs = tabs.filter((t) => t.workspaceId === workspace.id);
  const activeTab = activeTabs[workspace.id];
  const setActiveTab = (id?: string, workspaceId = workspace.id) =>
    setActiveTabs((current) => ({ ...current, [workspaceId]: id }));
  const [connected, setConnected] = useState<Set<string>>(new Set()),
    [connecting, setConnecting] = useState<string>();
  const [allMessages, setMessages] = useState<Message[]>([]);
  const messages = allMessages.filter((m) => m.sessionId === session?.id);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const sessionKey = session?.id ?? workspace.id;
  const input = drafts[sessionKey] ?? "";
  const setInput = (input: string) =>
    setDrafts((current) => ({ ...current, [sessionKey]: input }));
  const [tasks, setTasks] = useState<Record<string, string | undefined>>({});
  const taskId = tasks[sessionKey];
  const setTaskId = (id?: string) =>
    setTasks((current) => ({ ...current, [sessionKey]: id }));
  const [cli, setCli] = useState<CliInfo[]>([]);
  const [error, setError] = useState(""),
    [allActivity, setActivity] = useState<Activity[]>([]);
  const activity = allActivity.filter((a) => a.sessionId === session?.id);
  const [files, setFiles] = useState<FileEntry[]>([]),
    [filePath, setFilePath] = useState("."),
    [showFiles, setShowFiles] = useState(false);
  const [terminalSearch, setTerminalSearch] = useState("");
  const [busyCommand, setBusyCommand] = useState<string>(),
    [results, setResults] = useState<Record<string, CommandResult>>({});
  const scrollEnd = useRef<HTMLDivElement>(null);
  const selectedServer = servers.find((s) => s.id === selected);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [contextMenuServer, setContextMenuServer] = useState<{
    server: Server;
    x: number;
    y: number;
  } | null>(null);
  const [renaming, setRenaming] = useState<Session | null>(null);

  useEffect(() => {
    if (!showAddMenu) return;
    const onClickOutside = (e: MouseEvent) => {
      if (
        addMenuRef.current &&
        !addMenuRef.current.contains(e.target as Node)
      ) {
        setShowAddMenu(false);
      }
    };
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [showAddMenu]);

  const currentActiveTab = workspaceTabs.find((t) => t.id === activeTab);
  const hasRightPanel =
    (view === "workspace" && terminalOpen) ||
    (view === "terminal" && agentOpen);
  const report = (e: unknown) => setError(errorText(e));
  const reload = async () => setServers(await window.axon.servers.list());
  function mergeSession(next: Session) {
    setSessions((current) => [
      ...current.filter((s) => s.id !== next.id),
      next,
    ]);
    setMessages((current) => {
      const ids = new Set(next.messages.map((m) => m.id));
      return [
        ...current.filter((m) => !ids.has(m.id)),
        ...next.messages.map((m) => ({
          ...m,
          workspaceId: next.workspaceId,
          sessionId: next.id,
          text:
            m.status === "running"
              ? (current.find((old) => old.id === m.id)?.text ?? m.text)
              : m.text,
        })),
      ];
    });
  }
  async function reloadSessions() {
    setProjects(await window.axon.projects.list());
    const values = await window.axon.sessions.list(
      workspaceState.workspaces[0].id,
    );
    values.forEach(mergeSession);
    setSessionsLoaded(true);
  }
  function selectSession(next: Session) {
    const project = projects.find((p) => p.id === next.projectId);
    if (
      project &&
      next.serverId &&
      !project.serverIds.includes(next.serverId)
    ) {
      void window.axon.sessions
        .update(next.id, { projectId: project.id })
        .then((updated) => {
          mergeSession(updated);
          applySession(updated);
        })
        .catch(report);
      return;
    }
    applySession(next);
  }
  function applySession(next: Session) {
    setModal(null);
    updateWorkspace({
      activeSessionId: next.id,
      selected: next.serverId,
      engine: next.engine,
      view: view === "activity" || view === "handoff" ? "workspace" : view,
    });
    setError("");
  }
  async function createSession(
    projectId?: string | null,
    knownProject?: Project,
  ) {
    try {
      const id =
        projectId === null ? undefined : (projectId ?? session?.projectId);
      const project = knownProject ?? projects.find((p) => p.id === id);
      const serverId = undefined;
      const next = await window.axon.sessions.create(
        workspace.id,
        serverId,
        engine,
        id,
      );
      mergeSession(next);
      selectSession(next);
    } catch (e) {
      report(e);
    }
  }
  async function sessionContextMenu(target: Session) {
    try {
      const result = await window.axon.sessions.contextMenu(target.id, {
        projects: workspaceProjects
          .filter((p) => !p.archived || p.id === target.projectId)
          .map((p) => ({ id: p.id, name: p.name })),
      });
      if (!result) return;
      if (result.action === "rename") {
        setRenaming(target);
        return;
      }
      if (result.action === "move") {
        if ((target.projectId ?? null) === result.projectId) return;
        mergeSession(
          await window.axon.sessions.update(target.id, {
            projectId: result.projectId,
          }),
        );
        return;
      }
      if (!(await window.axon.sessions.remove(target.id))) return;
      setSessions((current) => current.filter((s) => s.id !== target.id));
      setMessages((current) =>
        current.filter((m) => m.sessionId !== target.id),
      );
      setActivity((current) =>
        current.filter((a) => a.sessionId !== target.id),
      );
      setDrafts((current) => {
        const next = { ...current };
        delete next[target.id];
        return next;
      });
    } catch (e) {
      report(e);
    }
  }
  async function renameSession(target: Session, title: string) {
    mergeSession(await window.axon.sessions.update(target.id, { title }));
    setRenaming(null);
  }
  useEffect(() => {
    void reloadSessions().catch(report);
  }, []);
  useEffect(() => {
    if (
      !sessionsLoaded ||
      (session && workspace.activeSessionId === session.id)
    )
      return;
    if (session) {
      selectSession(session);
      return;
    }
    let cancelled = false;
    void window.axon.sessions
      .ensure(workspace.id)
      .then((next) => {
        mergeSession(next);
        if (!cancelled) selectSession(next);
      })
      .catch(report);
    return () => {
      cancelled = true;
    };
  }, [sessionsLoaded, workspace.id, session?.id, workspace.activeSessionId]);
  useEffect(() => {
    try {
      localStorage.setItem(workspaceStorageKey, JSON.stringify(workspaceState));
    } catch {
      setError("无法保存工作空间布局，请检查本机存储空间。");
    }
  }, [workspaceState]);
  useEffect(() => {
    // Existing profiles belong to the original workspace on first upgrade.
    setWorkspaceState((current) => {
      const assigned = new Set(current.workspaces.flatMap((w) => w.serverIds));
      const missing = servers
        .filter((s) => !assigned.has(s.id))
        .map((s) => s.id);
      if (!missing.length) return current;
      return {
        ...current,
        workspaces: current.workspaces.map((w, i) =>
          i === 0 ? { ...w, serverIds: [...w.serverIds, ...missing] } : w,
        ),
      };
    });
  }, [servers]);
  useEffect(() => {
    startTerminalHub();
    void reload().catch(report);
    void window.axon.servers
      .connected()
      .then((ids) => setConnected(new Set(ids)))
      .catch(report);
    void window.axon.agent.detect().then(setCli).catch(report);
    return window.axon.onEvent((event) => {
      if (event.type === "agent:delta")
        setMessages((current) =>
          current.map((m) =>
            m.id === event.id ? { ...m, text: m.text + event.data } : m,
          ),
        );
      if (event.type === "server:status")
        setConnected((current) => {
          const next = new Set(current);
          if (event.connected) next.add(event.id);
          else next.delete(event.id);
          return next;
        });
      if (event.type === "terminal:closed") {
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
        setModal(null);
        setView("workspace");
      }
      if (event.key === "2") {
        event.preventDefault();
        setModal(null);
        setView("terminal");
      }
      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        setWorkspaceState((current) => ({
          ...current,
          sidebarCollapsed: !current.sidebarCollapsed,
        }));
      }
      if (event.key === "`") {
        event.preventDefault();
        setModal(null);
        if (view === "terminal") setView("workspace");
        else updateWorkspace({ terminalOpen: !terminalOpen });
      }
      if (event.key === ",") {
        event.preventDefault();
        setModal("settings");
      }
      if (event.key === "Escape") {
        setContextMenuServer(null);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [workspace.id, view, terminalOpen]);
  useEffect(() => {
    scrollEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [allMessages, session?.id, view, agentOpen]);
  useEffect(() => {
    setFilePath(
      currentProject && selected
        ? (currentProject.remoteDirectory ?? ".")
        : ".",
    );
    setFiles([]);
    setShowFiles(false);
  }, [
    selected,
    workspace.id,
    currentProject?.id,
    currentProject?.remoteDirectory,
  ]);
  useEffect(() => {
    if (!session) {
      setActivity([]);
      return;
    }
    let cancelled = false;
    void window.axon.activity
      .list(session.id)
      .then((records) => {
        if (cancelled) return;
        setActivity((current) => [
          ...current.filter((a) => a.sessionId !== session.id),
          ...records,
        ]);
        setResults((current) => ({
          ...current,
          ...Object.fromEntries(
            records
              .filter((a) => a.proposalKey && a.result)
              .map((a) => [a.proposalKey!, a.result!]),
          ),
        }));
      })
      .catch(report);
    return () => {
      cancelled = true;
    };
  }, [view, session?.id]);
  async function connectServer(server: Server) {
    setConnecting(server.id);
    setError("");
    try {
      await window.axon.servers.connect(server.id);
      setConnected((current) => new Set(current).add(server.id));
      await reload();
    } catch (e) {
      report(e);
    } finally {
      setConnecting(undefined);
    }
  }
  async function openTerminal(server?: Server) {
    setError("");
    if (server) setConnecting(server.id);
    try {
      const id = await window.axon.terminal.open(server?.id, session?.id);
      setTabs((current) => [
        ...current,
        {
          id,
          title: server?.name ?? "本地终端",
          serverId: server?.id,
          workspaceId: workspace.id,
        },
      ]);
      setActiveTab(id);
      updateWorkspace({ terminalOpen: true });
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
      const id = await window.axon.terminal.launch(
        name,
        session?.agentOptions?.[name],
        session?.id,
      );
      setTabs((current) => [
        ...current,
        {
          id,
          title: name === "codex" ? "Codex CLI" : "Claude Code",
          workspaceId: workspace.id,
        },
      ]);
      setActiveTab(id);
      updateWorkspace({ terminalOpen: true });
    } catch (e) {
      report(e);
    }
  }
  async function closeTab(tab: Tab) {
    try {
      if (!tab.closed && (!tab.type || tab.type === "terminal")) {
        await window.axon.terminal.close(tab.id);
        forgetTerminal(tab.id);
      }
      setTabs((current) => current.filter((t) => t.id !== tab.id));
      if (activeTab === tab.id) {
        const remaining = workspaceTabs.filter((t) => t.id !== tab.id);
        setActiveTab(
          remaining.length ? remaining[remaining.length - 1].id : undefined,
        );
      }
    } catch (e) {
      report(e);
    }
  }
  async function openFilesTab(server?: Server) {
    const target = server ?? selectedServer;
    if (!target) return;
    try {
      await window.axon.servers.connect(target.id);
      const existing = workspaceTabs.find(
        (t) => t.type === "files" && t.serverId === target.id,
      );
      if (existing) {
        setActiveTab(existing.id);
      } else {
        const id = `files-${target.id}-${Date.now()}`;
        setTabs((current) => [
          ...current,
          {
            id,
            title: `文件: ${target.name}`,
            type: "files",
            serverId: target.id,
            workspaceId: workspace.id,
          },
        ]);
        setActiveTab(id);
      }
      updateWorkspace({ terminalOpen: true });
      setFiles(await window.axon.remote.files(target.id, filePath));
      await reload();
    } catch (e) {
      report(e);
    }
  }
  function openActivityTab() {
    const existing = workspaceTabs.find((t) => t.type === "activity");
    if (existing) {
      setActiveTab(existing.id);
    } else {
      const id = `activity-${Date.now()}`;
      setTabs((current) => [
        ...current,
        {
          id,
          title: "执行记录",
          type: "activity",
          workspaceId: workspace.id,
        },
      ]);
      setActiveTab(id);
    }
    updateWorkspace({ terminalOpen: true });
  }
  function openHandoffTab() {
    const existing = workspaceTabs.find((t) => t.type === "handoff");
    if (existing) {
      setActiveTab(existing.id);
    } else {
      const id = `handoff-${Date.now()}`;
      setTabs((current) => [
        ...current,
        {
          id,
          title: "交接记录",
          type: "handoff",
          workspaceId: workspace.id,
        },
      ]);
      setActiveTab(id);
    }
    updateWorkspace({ terminalOpen: true });
  }
  async function disconnectServer(target: Server) {
    try {
      await window.axon.servers.disconnect(target.id);
      setConnected((current) => {
        const next = new Set(current);
        next.delete(target.id);
        return next;
      });
    } catch (e) {
      report(e);
    }
  }
  async function disconnect() {
    if (!selected) return;
    const server = servers.find((s) => s.id === selected);
    if (server) await disconnectServer(server);
  }
  async function removeServer(target: Server) {
    if (!confirm(`确定要删除服务器“${target.name}”？`)) return;
    try {
      await window.axon.servers.remove(target.id);
      updateWorkspace({
        serverIds: workspace.serverIds.filter((id) => id !== target.id),
      });
      setConnected((current) => {
        const next = new Set(current);
        next.delete(target.id);
        return next;
      });
      if (selected === target.id) {
        setSelected(undefined);
      }
      if (session && session.serverId === target.id) {
        void window.axon.sessions
          .update(session.id, { serverId: null })
          .then(mergeSession)
          .catch(report);
      }
      const toClose = workspaceTabs.filter((t) => t.serverId === target.id);
      for (const tab of toClose) {
        void closeTab(tab);
      }
      await reload();
    } catch (e) {
      report(e);
    }
  }
  async function copySshCommand(target: Server) {
    try {
      const keyFlag =
        target.authType === "key" && target.privateKeyPath
          ? ` -i "${target.privateKeyPath}"`
          : "";
      const portFlag =
        target.port && target.port !== 22 ? ` -p ${target.port}` : "";
      const cmd = `ssh${keyFlag}${portFlag} ${target.username}@${target.host}`;
      await navigator.clipboard.writeText(cmd);
    } catch (e) {
      report(e);
    }
  }
  async function handleServerAction(target: Server, action: string) {
    if (action === "connect") {
      await connectServer(target);
    } else if (action === "disconnect") {
      await disconnectServer(target);
    } else if (action === "open-terminal") {
      await openTerminal(target);
    } else if (action === "open-files") {
      await openFilesTab(target);
    } else if (action === "edit") {
      setEditing(target);
      setModal("server");
    } else if (action === "copy-ssh-command") {
      await copySshCommand(target);
    } else if (action === "delete") {
      await removeServer(target);
    }
  }
  async function serverContextMenu(
    target: Server,
    event?: { clientX: number; clientY: number },
  ) {
    if (typeof window.axon?.servers?.contextMenu === "function") {
      try {
        const isConnected = connected.has(target.id);
        const action = await window.axon.servers.contextMenu(target.id, {
          isConnected,
        });
        if (!action) return;
        await handleServerAction(target, action);
        return;
      } catch {
        // Fall back to React context menu if Electron popup fails
      }
    }
    if (event) {
      const x = Math.min(event.clientX, window.innerWidth - 220);
      const y = Math.min(event.clientY, window.innerHeight - 260);
      setContextMenuServer({ server: target, x, y });
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!input.trim() || taskId || !session) return;
    if (selected && !connected.has(selected)) {
      setError("请先连接选定的服务器");
      return;
    }
    const id = crypto.randomUUID(),
      message = input.trim(),
      userMessageId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      {
        id: userMessageId,
        workspaceId: workspace.id,
        sessionId: session.id,
        role: "user",
        text: message,
        serverId: selected,
      },
      {
        id,
        workspaceId: workspace.id,
        sessionId: session.id,
        role: "assistant",
        text: "",
        serverId: selected,
      },
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
        sessionId: session.id,
        userMessageId,
        ...session.agentOptions?.[engine],
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
      void reloadSessions().catch(report);
    }
  }
  async function execute(
    serverId: string | undefined,
    command: string,
    key: string,
    sessionId: string,
  ) {
    if (busyCommand) return;
    setBusyCommand(key);
    setError("");
    try {
      if (serverId) await window.axon.servers.connect(serverId);
      const approval = await window.axon.remote.propose(
        serverId,
        command,
        sessionId,
        key,
      );
      const result = await window.axon.remote.execute(approval);
      setResults((current) => ({ ...current, [key]: result }));
      const records = await window.axon.activity.list(sessionId);
      setActivity((current) => [
        ...current.filter((a) => a.sessionId !== sessionId),
        ...records,
      ]);
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
      await reload();
    } catch (e) {
      report(e);
    }
  }
  function showActivity() {
    setView("activity");
  }
  const workspaceServers = servers.filter((s) =>
    workspace.serverIds.includes(s.id),
  );
  const projectServers = currentProject
    ? workspaceServers.filter(
        (s) =>
          workspace.serverIds.includes(s.id) &&
          (!currentProject || currentProject.serverIds.includes(s.id)),
      )
    : workspaceServers;
  const visibleServers = projectServers.filter((s) =>
    `${s.name} ${s.host} ${s.group}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const groups = [...new Set(visibleServers.map((s) => s.group || "未分组"))];
  return (
    <div className="app-shell">
      <aside
        className="sidebar"
        hidden={workspaceState.sidebarCollapsed}
        style={{ width: sidebarWidth }}
      >
        <div
          className={`sidebar-resizer ${isResizingSidebar ? "resizing" : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizingSidebar(true);
          }}
          title="拖拽调节导航栏宽度"
        />
        <div className="brand">
          <div className="brand-mark">
            <Command size={21} />
          </div>
          <span>
            Axon<span className="brand-light">SSH</span>
          </span>
          <span className="version">α</span>
        </div>
        <WorkspaceSwitcher
          workspaces={workspaceState.workspaces}
          activeId={workspace.id}
          select={(id) => {
            setWorkspaceState((current) => ({ ...current, activeId: id }));
            setQuery("");
            setError("");
          }}
          create={() => setModal("workspace")}
        />
        <ProjectSidebar
          projects={workspaceProjects}
          sessions={workspaceSessions}
          selectedId={session?.id}
          tasks={tasks}
          loaded={sessionsLoaded}
          select={selectSession}
          contextMenu={(target) => void sessionContextMenu(target)}
          create={(projectId) => void createSession(projectId)}
          addProject={() => {
            setEditingProject(undefined);
            setModal("project");
          }}
          edit={(project) => {
            setEditingProject(project);
            setModal("project");
          }}
        />
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
                    title={`${server.name} (${server.username}@${server.host}:${server.port}) · 右键查看更多操作`}
                    onClick={() => {
                      setSelected(server.id);
                      if (view === "activity") setView("workspace");
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      void serverContextMenu(server, {
                        clientX: e.clientX,
                        clientY: e.clientY,
                      });
                    }}
                    onKeyDown={(e) => {
                      if (
                        e.key === "ContextMenu" ||
                        (e.shiftKey && e.key === "F10")
                      ) {
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        void serverContextMenu(server, {
                          clientX: rect.right,
                          clientY: rect.top,
                        });
                      }
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
          {!workspaceServers.length && (
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
          {workspaceServers.length > 0 && !visibleServers.length && (
            <p className="muted sidebar-no-results">
              {!query && currentProject && !currentProject.serverIds.length
                ? "此项目尚未关联服务器，可在项目管理中添加关联"
                : "没有匹配的服务器"}
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <button
            className={modal === "settings" ? "nav-item active" : "nav-item"}
            onClick={() => setModal("settings")}
          >
            <SettingsIcon size={17} />
            设置与模型
          </button>
          <div className="profile">
            <span className="avatar">A</span>
            <div>
              个人工作空间<small>AxonSSH · v{version}</small>
            </div>
            <MoreHorizontal size={17} />
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button"
              aria-label={
                workspaceState.sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"
              }
              title="切换侧边栏 · Ctrl+B"
              onClick={() =>
                setWorkspaceState((current) => ({
                  ...current,
                  sidebarCollapsed: !current.sidebarCollapsed,
                }))
              }
            >
              {workspaceState.sidebarCollapsed ? (
                <PanelLeftOpen size={18} />
              ) : (
                <PanelLeftClose size={18} />
              )}
            </button>
            <span>{workspace.name}</span>
            <ChevronRight size={14} />
            <strong>
              {modal === "settings"
                ? "设置与模型"
                : view === "activity"
                  ? "执行记录"
                  : view === "terminal"
                    ? "终端"
                    : "智能工作台"}
            </strong>
          </div>
          {session && modal !== "settings" && (
            <div className="topbar-session-controls">
              <SelectMenu
                label="处理位置"
                disabled={!!taskId || !!busyCommand}
                compact
                value={selected ?? ""}
                onChange={(value) => setSelected(value || undefined)}
                options={[
                  {
                    value: "",
                    label: "本机",
                    description: currentProject?.directory ?? "本机工作环境",
                  },
                  ...servers
                    .filter(
                      (s) =>
                        workspace.serverIds.includes(s.id) &&
                        (!currentProject ||
                          currentProject.serverIds.includes(s.id)),
                    )
                    .map((s) => ({
                      value: s.id,
                      label: s.name,
                      description: `${s.username}@${s.host}:${s.port}`,
                    })),
                ]}
              />
            </div>
          )}
          <div className="topbar-right">
            {session && modal !== "settings" && (
              <div className="session-navigation">
                <button
                  aria-pressed={view !== "activity"}
                  onClick={() => {
                    if (view === "activity") setView("workspace");
                  }}
                >
                  <MessageSquare size={14} />
                  对话
                </button>
                <button
                  aria-label="Session 执行记录"
                  aria-pressed={view === "activity"}
                  onClick={showActivity}
                >
                  <ActivityIcon size={14} />
                  执行记录
                  {activity.length > 0 && <span>{activity.length}</span>}
                </button>
              </div>
            )}
            <div className="view-switch" aria-label="主视图">
              <button
                aria-label="智能工作台主视图"
                aria-pressed={view !== "terminal"}
                onClick={() => {
                  setModal(null);
                  setView("workspace");
                }}
              >
                <Sparkles size={15} />
                <span>工作台</span>
              </button>
              <button
                aria-label="终端主视图"
                aria-pressed={view === "terminal"}
                onClick={() => {
                  setModal(null);
                  setView("terminal");
                }}
              >
                <TerminalIcon size={15} />
                <span>终端</span>
              </button>
            </div>
            {view === "workspace" && modal !== "settings" && (
              <button
                className={`icon-button panel-toggle ${terminalOpen ? "active" : ""}`}
                aria-label="右侧工作区"
                title={
                  terminalOpen
                    ? "收起右侧工作区"
                    : "展开右侧工作区 (终端 / 文件 / 记录)"
                }
                aria-pressed={terminalOpen}
                onClick={() => updateWorkspace({ terminalOpen: !terminalOpen })}
              >
                <PanelRight size={18} />
              </button>
            )}
            {view === "terminal" && modal !== "settings" && (
              <button
                className={`icon-button panel-toggle ${agentOpen ? "active" : ""}`}
                aria-label="智能体侧边栏"
                title={
                  agentOpen
                    ? "收起智能体侧边栏"
                    : "展开智能体侧边栏 (对话与分析)"
                }
                aria-pressed={agentOpen}
                onClick={() => updateWorkspace({ agentOpen: !agentOpen })}
              >
                <Bot size={18} />
              </button>
            )}
            {isPreview && <span className="badge warning">浏览器界面预览</span>}
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
        {modal === "settings" && (
          <SettingsPage
            close={() => setModal(null)}
            cli={cli}
            refreshCli={async () => setCli(await window.axon.agent.detect())}
            launch={launchCli}
          />
        )}
        {view === "activity" && (
          <div className="activity-view" hidden={modal === "settings"}>
            <div className="section-eyebrow">OPERATIONS</div>
            <h1>{session?.title} · 执行记录</h1>
            <p className="muted">
              仅显示当前 Session 的命令记录。未知退出状态的命令不会自动重试。
            </p>
            {!activity.length ? (
              <div className="empty-record">
                <ActivityIcon size={32} />
                <h3>此 Session 还没有执行记录</h3>
                <p>在此会话中审批执行命令后，记录会显示在这里。</p>
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
                          (a.kind === "diagnostic" && !a.serverId
                            ? "本地"
                            : "已删除服务器")}{" "}
                        · {a.durationMs} ms
                        {a.approval === "bypassed" && " · Bypass permissions"}
                      </small>
                    </div>
                    <span
                      className={`badge ${a.code === 0 ? "success" : "warning"}`}
                    >
                      {a.kind === "diagnostic"
                        ? a.code === 0
                          ? "只读采集完成"
                          : "部分读取失败"
                        : a.code === null
                          ? "未知"
                          : `exit ${a.code}`}
                    </span>
                    <small>{new Date(a.createdAt).toLocaleString()}</small>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {view === "handoff" && session && modal !== "settings" && (
          <HandoffPanel
            session={session}
            engine={engine}
            busy={!!taskId}
            reset={() => {
              void window.axon.agent
                .resetNative(
                  session.id,
                  engine,
                  selected,
                  session.agentOptions?.[engine]?.model,
                )
                .then(mergeSession)
                .catch(report);
            }}
          />
        )}
        <div
          className={`workspace-layout view-${view} dock-right ${terminalOpen ? "terminal-open" : ""} ${agentOpen ? "agent-open" : ""} ${showFiles ? "files-open" : ""}`}
          style={
            hasRightPanel
              ? { gridTemplateColumns: `minmax(0, 1fr) ${rightPanelWidth}px` }
              : undefined
          }
          hidden={
            view === "activity" || view === "handoff" || modal === "settings"
          }
        >
          {hasRightPanel && (
            <div
              className={`panel-resizer ${isResizingRight ? "resizing" : ""}`}
              style={{ right: rightPanelWidth - 3 }}
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingRight(true);
              }}
              title="拖拽调节侧边栏宽度"
            />
          )}
          <>
            {selectedServer && (
              <div
                className="server-toolbar"
                onContextMenu={(e) => {
                  e.preventDefault();
                  void serverContextMenu(selectedServer, {
                    clientX: e.clientX,
                    clientY: e.clientY,
                  });
                }}
              >
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
                    {connected.has(selectedServer.id) ? "已连接" : "未连接"}
                  </span>
                </div>
                <div>
                  <button
                    className={`text-button ${currentActiveTab?.type === "files" && terminalOpen ? "active" : ""}`}
                    onClick={() => void openFilesTab(selectedServer)}
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
                  {!connected.has(selectedServer.id) && (
                    <button
                      className="small-primary"
                      disabled={!!connecting}
                      onClick={() => void connectServer(selectedServer)}
                    >
                      {connecting === selectedServer.id ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <ServerIcon size={14} />
                      )}
                      连接
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
              className="work-content"
              hidden={view === "terminal" ? !agentOpen : false}
              style={
                view === "terminal" && !agentOpen
                  ? { display: "none" }
                  : undefined
              }
            >
              {view === "terminal" && (
                <div className="agent-panel-heading">
                  <Sparkles size={14} />
                  <strong>智能体对话</strong>
                  <button
                    className="icon-button"
                    title="收起智能体侧边栏"
                    aria-label="收起智能体侧边栏"
                    onClick={() => updateWorkspace({ agentOpen: false })}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
              <div className="conversation">
                <div className="message-list">
                  {messages.map((message) => (
                    <div className={`message ${message.role}`} key={message.id}>
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
                        {message.result?.nativeToolCalls ? (
                          <p className="native-tool-note">
                            已观察到 {message.result.nativeToolCalls} 次 CLI
                            工具活动，详情保留在原生会话。
                          </p>
                        ) : null}
                        {message.result?.permissionDenials ? (
                          <p className="native-tool-note">
                            CLI 有 {message.result.permissionDenials}{" "}
                            项权限请求未获批准；可在原生终端处理。
                          </p>
                        ) : null}
                        {message.result?.diagnostics && (
                          <details className="diagnostics-card">
                            <summary>
                              本次只读状态快照 ·{" "}
                              {message.result.diagnostics.source === "local"
                                ? "本机"
                                : "SFTP"}
                            </summary>
                            <small>
                              {new Date(
                                message.result.diagnostics.collectedAt,
                              ).toLocaleString()}
                            </small>
                            {message.result.diagnostics.entries.map((entry) => (
                              <div key={entry.name}>
                                <strong>{entry.name}</strong>
                                <pre>
                                  {entry.error
                                    ? `读取失败：${entry.error}`
                                    : entry.text}
                                  {entry.truncated && "\n[内容已截断]"}
                                </pre>
                              </div>
                            ))}
                          </details>
                        )}
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
                                  )?.host ??
                                    (message.serverId
                                      ? "服务器已删除"
                                      : "本机")}
                                </small>
                                <button
                                  disabled={
                                    permissions === "read-only" ||
                                    !!busyCommand ||
                                    message.serverId !== selected
                                  }
                                  title={
                                    permissions === "read-only"
                                      ? "只读权限不能执行命令"
                                      : message.serverId !== selected
                                        ? "请切换到此命令对应的处理位置"
                                        : "逐条确认目标及命令"
                                  }
                                  onClick={() =>
                                    execute(
                                      message.serverId,
                                      proposal.command,
                                      key,
                                      message.sessionId,
                                    )
                                  }
                                >
                                  {busyCommand === key ? (
                                    <LoaderCircle size={13} className="spin" />
                                  ) : (
                                    <ArrowUpRight size={13} />
                                  )}
                                  {permissions === "bypass"
                                    ? "直接执行"
                                    : "审批并执行"}
                                </button>
                              </div>
                              {results[key] && (
                                <div className="command-result">
                                  <div>
                                    退出码：{results[key].code ?? "未知"}
                                    {results[key].truncated && " · 输出已截断"}
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
                <form className="composer" onSubmit={send}>
                  <textarea
                    aria-label="运维任务"
                    disabled={!session}
                    placeholder={
                      selectedServer
                        ? `向助手描述 ${selectedServer.name} 的问题…`
                        : "描述本机任务，或选择服务器后处理远程任务…"
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
                      <SelectMenu
                        label="智能体引擎"
                        compact
                        icon={<Sparkles size={14} />}
                        disabled={!!taskId}
                        value={engine}
                        onChange={(value) => setEngine(value as Engine)}
                        options={[
                          { value: "builtin", label: "内置运维助手" },
                          ...cli.map((c) => ({
                            value: c.engine,
                            label:
                              c.engine === "codex"
                                ? "Codex CLI"
                                : "Claude Code",
                            disabled: !c.installed,
                          })),
                        ]}
                      />
                      <AgentOptionsPicker
                        engine={engine}
                        selection={session?.agentOptions?.[engine] ?? {}}
                        change={(selection) => {
                          if (session)
                            void window.axon.sessions
                              .update(session.id, {
                                agentOptions: {
                                  ...session.agentOptions,
                                  [engine]: selection,
                                },
                              })
                              .then(mergeSession)
                              .catch(report);
                        }}
                      />
                      <span className="composer-divider" />
                      <SelectMenu
                        label="权限策略"
                        compact
                        icon={<ShieldCheck size={12} />}
                        disabled={!!taskId || !!busyCommand || !session}
                        value={permissions}
                        onChange={(value) => {
                          if (session)
                            void window.axon.sessions
                              .update(session.id, {
                                permissions: value as PermissionPolicy,
                              })
                              .then(mergeSession)
                              .catch(report);
                        }}
                        options={[
                          {
                            value: "read-only",
                            label: "只读",
                            description: "分析状态，不执行命令或修改文件",
                          },
                          {
                            value: "ask",
                            label: "请求审批",
                            description: "默认策略；应用命令逐条确认",
                          },
                          {
                            value: "accept-edits",
                            label: "允许项目编辑",
                            description:
                              "本机 CLI 可编辑项目；应用命令仍需确认",
                          },
                          {
                            value: "bypass",
                            label: "Bypass permissions",
                            description:
                              "跳过命令审批；本机 CLI 放开访问，仅当前 Session",
                          },
                        ]}
                      />
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
                          disabled={
                            !input.trim() ||
                            !session ||
                            (!!selected && !connected.has(selected))
                          }
                        >
                          <ArrowUp size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                </form>
                <div
                  className={`composer-note ${permissions === "bypass" ? "bypass-note" : ""}`}
                >
                  {permissions === "bypass"
                    ? "Bypass permissions：当前处理位置的命令跳过审批；本机 CLI 可放开访问。"
                    : permissions === "read-only"
                      ? "只读权限：允许分析状态，不执行命令或修改文件。"
                      : "命令按当前处理位置执行；应用命令仍需确认。"}
                </div>
              </div>
            </div>
            <section
              className="terminal-section"
              hidden={view === "workspace" && !terminalOpen}
              style={
                view === "workspace" && !terminalOpen
                  ? { display: "none" }
                  : undefined
              }
            >
              <div className="codex-tab-bar">
                <div className="codex-tabs">
                  {workspaceTabs.map((tab) => {
                    const isActive = tab.id === activeTab;
                    return (
                      <div
                        key={tab.id}
                        className={`codex-tab ${isActive ? "active" : ""}`}
                        onClick={() => setActiveTab(tab.id)}
                        title={tab.title}
                      >
                        <span className="codex-tab-icon">
                          {tab.type === "files" ? (
                            <FolderOpen size={13} />
                          ) : tab.type === "activity" ? (
                            <ActivityIcon size={13} />
                          ) : tab.type === "handoff" ? (
                            <ArrowRightLeft size={13} />
                          ) : (
                            <TerminalIcon size={13} />
                          )}
                        </span>
                        <span className="codex-tab-title">{tab.title}</span>
                        <button
                          className="codex-tab-close"
                          aria-label={`关闭 ${tab.title}`}
                          title="关闭标签页"
                          onClick={(e) => {
                            e.stopPropagation();
                            void closeTab(tab);
                          }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="codex-tab-add-wrapper" ref={addMenuRef}>
                  <button
                    className="codex-tab-add-btn"
                    title="新建标签页"
                    aria-label="新建标签页"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowAddMenu((prev) => !prev);
                    }}
                  >
                    <Plus size={14} />
                  </button>
                  {showAddMenu && (
                    <div className="codex-add-menu">
                      <button
                        onClick={() => {
                          setShowAddMenu(false);
                          void openTerminal();
                        }}
                      >
                        <TerminalIcon size={14} />
                        <span>新建本地终端</span>
                        <kbd>Ctrl+`</kbd>
                      </button>
                      {selectedServer && (
                        <button
                          onClick={() => {
                            setShowAddMenu(false);
                            void openTerminal(selectedServer);
                          }}
                        >
                          <ServerIcon size={14} />
                          <span>终端: {selectedServer.name}</span>
                        </button>
                      )}
                      {selectedServer && (
                        <button
                          onClick={() => {
                            setShowAddMenu(false);
                            void openFilesTab(selectedServer);
                          }}
                        >
                          <FolderOpen size={14} />
                          <span>远程文件: {selectedServer.name}</span>
                          <kbd>Ctrl+P</kbd>
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setShowAddMenu(false);
                          openActivityTab();
                        }}
                      >
                        <ActivityIcon size={14} />
                        <span>执行记录</span>
                      </button>
                      <button
                        onClick={() => {
                          setShowAddMenu(false);
                          openHandoffTab();
                        }}
                      >
                        <ArrowRightLeft size={14} />
                        <span>交接记录</span>
                      </button>
                    </div>
                  )}
                </div>
                <div className="codex-tab-actions">
                  {(!currentActiveTab ||
                    !currentActiveTab.type ||
                    currentActiveTab.type === "terminal") &&
                    workspaceTabs.length > 0 && (
                      <label className="codex-tab-search">
                        <Search size={12} />
                        <input
                          placeholder="查找"
                          value={terminalSearch}
                          onChange={(e) => setTerminalSearch(e.target.value)}
                        />
                      </label>
                    )}
                  <button
                    className="icon-button"
                    title={view === "terminal" ? "返回工作台" : "终端主视图"}
                    onClick={() =>
                      setView(view === "terminal" ? "workspace" : "terminal")
                    }
                  >
                    <ArrowUpRight size={14} />
                  </button>
                  {view === "workspace" && (
                    <button
                      className="icon-button"
                      title="收起右侧面板"
                      onClick={() => updateWorkspace({ terminalOpen: false })}
                    >
                      <X size={15} />
                    </button>
                  )}
                  {view === "terminal" && (
                    <button
                      className={`icon-button ${agentOpen ? "active" : ""}`}
                      title={
                        agentOpen ? "收起智能体侧边栏" : "展开智能体侧边栏"
                      }
                      aria-pressed={agentOpen}
                      onClick={() => updateWorkspace({ agentOpen: !agentOpen })}
                    >
                      <Bot size={15} />
                    </button>
                  )}
                </div>
              </div>

              <div className="codex-tab-body">
                {workspaceTabs
                  .filter((t) => !t.type || t.type === "terminal")
                  .map((tab) => (
                    <TerminalPane
                      key={tab.id}
                      id={tab.id}
                      active={
                        tab.id === activeTab &&
                        view !== "activity" &&
                        view !== "handoff" &&
                        modal !== "settings" &&
                        (view === "terminal" || terminalOpen)
                      }
                      search={terminalSearch}
                    />
                  ))}

                {currentActiveTab?.type === "files" && (
                  <FilePanel
                    files={files}
                    filePath={filePath}
                    setFilePath={setFilePath}
                    loadFiles={loadFiles}
                    showHeader={false}
                  />
                )}

                {currentActiveTab?.type === "activity" && (
                  <div className="activity-view inside-tab">
                    <div className="section-eyebrow">OPERATIONS</div>
                    <h2>{session?.title} · 执行记录</h2>
                    {!activity.length ? (
                      <div className="empty-record">
                        <ActivityIcon size={28} />
                        <h3>暂无执行记录</h3>
                        <p>在此会话执行命令后，记录会显示在对应服务器。</p>
                      </div>
                    ) : (
                      <div className="activity-table">
                        <div className="activity-row table-heading">
                          <span>状态</span>
                          <span>命令</span>
                          <span>执行耗时</span>
                          <span>时间</span>
                        </div>
                        {activity.map((item) => (
                          <div className="activity-row" key={item.id}>
                            <span>
                              <i
                                className={
                                  item.code === 0
                                    ? "status-dot online"
                                    : "status-dot error"
                                }
                              />
                              {item.code === 0 ? "成功" : `退出码 ${item.code}`}
                            </span>
                            <code>{item.command}</code>
                            <span>{item.durationMs}ms</span>
                            <span>
                              {new Date(item.createdAt).toLocaleTimeString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {currentActiveTab?.type === "handoff" && session && (
                  <div className="handoff-view inside-tab">
                    <HandoffPanel
                      session={session}
                      engine={engine}
                      busy={!!taskId}
                      reset={() => {
                        void window.axon.agent
                          .resetNative(
                            session.id,
                            engine,
                            selected,
                            session.agentOptions?.[engine]?.model,
                          )
                          .then(mergeSession)
                          .catch(report);
                      }}
                    />
                  </div>
                )}

                {!workspaceTabs.length && (
                  <div className="codex-tab-empty">
                    <div className="codex-empty-card">
                      <div className="codex-empty-icon">
                        <FolderOpen size={24} />
                      </div>
                      <h3>打开或新建标签页</h3>
                      <p>从上方点击 + 或在左侧服务器列表中选择操作。</p>
                      <div className="codex-empty-actions">
                        <button
                          className="primary-button"
                          onClick={() => void openTerminal()}
                        >
                          <TerminalIcon size={14} /> 新建本地终端
                        </button>
                        {selectedServer && (
                          <button
                            className="secondary-button"
                            onClick={() => void openTerminal(selectedServer)}
                          >
                            <ServerIcon size={14} /> 连接 {selectedServer.name}
                          </button>
                        )}
                        {selectedServer && (
                          <button
                            className="secondary-button"
                            onClick={() => void openFilesTab(selectedServer)}
                          >
                            <FolderOpen size={14} /> 浏览远程文件
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {(!currentActiveTab ||
                !currentActiveTab.type ||
                currentActiveTab.type === "terminal") &&
                workspaceTabs.length > 0 && (
                  <div className="terminal-status">
                    <span>
                      <i className="status-dot online" />
                      {
                        workspaceTabs.filter(
                          (t) =>
                            (!t.type || t.type === "terminal") && !t.closed,
                        ).length
                      }{" "}
                      个活跃终端
                    </span>
                    <span>
                      UTF-8<span className="status-separator">·</span>
                      xterm-256color
                      <span className="status-separator">·</span>v{version}
                    </span>
                  </div>
                )}
            </section>
          </>
        </div>
      </main>
      {modal === "server" && (
        <ServerModal
          server={editing}
          servers={servers}
          close={() => setModal(null)}
          onImport={async () => {
            const { imported, skipped } =
              await window.axon.servers.importOpenSshConfig();
            updateWorkspace({
              serverIds: [
                ...new Set([
                  ...workspace.serverIds,
                  ...imported.map((s) => s.id),
                ]),
              ],
            });
            await reload();
            if (!skipped.length) setModal(null);
            return skipped;
          }}
          save={async (input) => {
            const server = await window.axon.servers.save(input);
            updateWorkspace({
              serverIds: [...new Set([...workspace.serverIds, server.id])],
            });
            await reload();
            setModal(null);
          }}
          remove={async (id) => {
            await window.axon.servers.remove(id);
            await reload();
            if (selected === id) setSelected(undefined);
            setModal(null);
          }}
        />
      )}
      {contextMenuServer && (
        <div
          className="context-menu-backdrop"
          onClick={() => setContextMenuServer(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenuServer(null);
          }}
        >
          <div
            className="context-menu"
            style={{
              top: contextMenuServer.y,
              left: contextMenuServer.x,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="context-menu-header">
              <ServerIcon size={13} />
              <span>{contextMenuServer.server.name}</span>
            </div>
            <div className="context-menu-divider" />
            <button
              onClick={() => {
                const s = contextMenuServer.server;
                setContextMenuServer(null);
                if (connected.has(s.id)) void disconnectServer(s);
                else void connectServer(s);
              }}
            >
              {connected.has(contextMenuServer.server.id) ? (
                <>
                  <Unplug size={14} />
                  <span>断开连接</span>
                </>
              ) : (
                <>
                  <ServerIcon size={14} />
                  <span>连接服务器</span>
                </>
              )}
            </button>
            <button
              onClick={() => {
                const s = contextMenuServer.server;
                setContextMenuServer(null);
                void openTerminal(s);
              }}
            >
              <TerminalIcon size={14} />
              <span>打开终端</span>
            </button>
            <button
              onClick={() => {
                const s = contextMenuServer.server;
                setContextMenuServer(null);
                void openFilesTab(s);
              }}
            >
              <FolderOpen size={14} />
              <span>浏览远程文件</span>
            </button>
            <div className="context-menu-divider" />
            <button
              onClick={() => {
                const s = contextMenuServer.server;
                setContextMenuServer(null);
                setEditing(s);
                setModal("server");
              }}
            >
              <Pencil size={14} />
              <span>编辑服务器配置</span>
            </button>
            <button
              onClick={() => {
                const s = contextMenuServer.server;
                setContextMenuServer(null);
                void copySshCommand(s);
              }}
            >
              <Copy size={14} />
              <span>复制 SSH 连接命令</span>
            </button>
            <div className="context-menu-divider" />
            <button
              className="danger"
              onClick={() => {
                const s = contextMenuServer.server;
                setContextMenuServer(null);
                void removeServer(s);
              }}
            >
              <Trash2 size={14} />
              <span>删除服务器</span>
            </button>
          </div>
        </div>
      )}
      {renaming && (
        <SessionRenameModal
          session={renaming}
          close={() => setRenaming(null)}
          save={async (title) => {
            try {
              await renameSession(renaming, title);
            } catch (e) {
              report(e);
              throw e;
            }
          }}
        />
      )}
      {modal === "project" && (
        <ProjectModal
          project={editingProject}
          workspaceId={workspace.id}
          servers={workspaceServers}
          close={() => setModal(null)}
          saved={(project) => {
            setProjects((current) => [
              ...current.filter((p) => p.id !== project.id),
              project,
            ]);
            if (!editingProject) void createSession(project.id, project);
            else if (session?.projectId === project.id)
              void window.axon.sessions
                .update(session.id, { projectId: project.id })
                .then((next) => {
                  mergeSession(next);
                  applySession(next);
                })
                .catch(report);
          }}
        />
      )}
      {modal === "workspace" && (
        <WorkspaceModal
          servers={servers}
          close={() => setModal(null)}
          save={(name, serverIds) => {
            const next = newWorkspace(name, serverIds);
            setWorkspaceState((current) => ({
              ...current,
              workspaces: [...current.workspaces, next],
              activeId: next.id,
            }));
            setQuery("");
            setError("");
            setModal(null);
          }}
        />
      )}
      {(isResizingSidebar || isResizingRight) && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            cursor: "col-resize",
            userSelect: "none",
          }}
        />
      )}
    </div>
  );
}

function WorkspaceModal({
  servers,
  close,
  save,
}: {
  servers: Server[];
  close(): void;
  save(name: string, serverIds: string[]): void;
}) {
  const [name, setName] = useState("");
  const [serverIds, setServerIds] = useState<string[]>([]);
  return (
    <div className="modal-overlay" onClick={close}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) save(name.trim(), serverIds);
        }}
      >
        <div className="modal-head">
          <div className="modal-icon">
            <FolderOpen size={20} />
          </div>
          <button type="button" aria-label="关闭" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <h2>新建工作空间</h2>
        <p className="muted">为不同项目组织服务器、终端和智能体任务。</p>
        <label>
          工作空间名称
          <input
            autoFocus
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：开发环境"
          />
        </label>
        {!!servers.length && (
          <fieldset className="workspace-server-options">
            <legend>关联已有服务器（可选）</legend>
            {servers.map((s) => (
              <label key={s.id}>
                <input
                  type="checkbox"
                  checked={serverIds.includes(s.id)}
                  onChange={(e) =>
                    setServerIds((current) =>
                      e.target.checked
                        ? [...current, s.id]
                        : current.filter((id) => id !== s.id),
                    )
                  }
                />
                <span>
                  {s.name}
                  <small>{s.host}</small>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="modal-footer">
          <button type="button" className="secondary-button" onClick={close}>
            取消
          </button>
          <button className="primary-button" disabled={!name.trim()}>
            创建工作空间
          </button>
        </div>
      </form>
    </div>
  );
}

function FilePanel({
  files,
  filePath,
  setFilePath,
  loadFiles,
  showHeader = true,
  onClose,
}: {
  files: FileEntry[];
  filePath: string;
  setFilePath: (path: string) => void;
  loadFiles: (path: string) => Promise<void>;
  showHeader?: boolean;
  onClose?: () => void;
}) {
  return (
    <aside className="file-panel">
      {showHeader && (
        <div className="file-panel-heading">
          <FolderOpen size={15} />
          远程文件
          {onClose && (
            <button aria-label="关闭文件面板" onClick={onClose}>
              <X size={15} />
            </button>
          )}
        </div>
      )}
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
        onClick={() => void loadFiles(`${filePath}/..`)}
      >
        <ArrowLeft size={13} />
        上一级
      </button>
      <div className="file-list">
        {files.map((file) => (
          <button
            className="file-row"
            key={file.name}
            disabled={!file.directory}
            onClick={() =>
              void loadFiles(`${filePath.replace(/\/$/, "")}/${file.name}`)
            }
          >
            {file.directory ? (
              <Folder size={14} />
            ) : (
              <span className="file-dot" />
            )}
            <span>{file.name}</span>
            <small>
              {file.directory ? "" : `${Math.ceil(file.size / 1024)} KB`}
            </small>
          </button>
        ))}
        {!files.length && <p className="muted">目录为空</p>}
      </div>
      <p className="file-panel-note">
        初版提供目录浏览；文件编辑与传输将在后续版本加入。
      </p>
    </aside>
  );
}

function SessionRenameModal({
  session,
  close,
  save,
}: {
  session: Session;
  close(): void;
  save(title: string): Promise<void>;
}) {
  const [value, setValue] = useState(session.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    const title = value.trim();
    if (!title) {
      setError("名称不能为空");
      return;
    }
    setBusy(true);
    try {
      await save(title);
    } catch (e) {
      setError(errorText(e));
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
        aria-labelledby="rename-session-title"
      >
        <div className="modal-head">
          <div className="modal-icon">
            <MessageSquare size={20} />
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
        <h2 id="rename-session-title">重命名 Session</h2>
        <p className="muted">
          名称只用于本地列表，不影响对话、交接与执行记录。
        </p>
        <label>
          Session 名称
          <input
            autoFocus
            required
            maxLength={100}
            aria-label="Session 名称"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
            }}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-footer">
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
            保存名称
          </button>
        </div>
      </form>
    </div>
  );
}
function ServerModal({
  server,
  servers,
  close,
  save,
  remove,
  onImport,
}: {
  server?: Server;
  servers: Server[];
  close(): void;
  save(input: ServerInput): Promise<void>;
  remove(id: string): Promise<void>;
  onImport?(): Promise<{ alias: string; reason: string }[]>;
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
          jumpServerId: server.jumpServerId,
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
        {!server && onImport && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            style={{
              marginBottom: 14,
              width: "100%",
              justifyContent: "center",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
            }}
            onClick={async () => {
              setBusy(true);
              try {
                const skipped = await onImport();
                if (skipped?.length) {
                  const listed = skipped
                    .slice(0, 3)
                    .map((s) => `${s.alias}（${s.reason}）`)
                    .join("；");
                  setError(
                    `已跳过 ${skipped.length} 个条目：${listed}${
                      skipped.length > 3 ? "…" : ""
                    }`,
                  );
                }
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download size={15} /> 从 ~/.ssh/config 快速导入
          </button>
        )}
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
        <div className="select-field">
          <span>认证方式</span>
          <SelectMenu
            label="认证方式"
            value={value.authType}
            onChange={(authType) =>
              setValue({
                ...value,
                authType: authType as ServerInput["authType"],
                secret: undefined,
              })
            }
            options={[
              {
                value: "agent",
                label: "SSH Agent（推荐）",
                description: "使用本机代理中的密钥",
                icon: <ShieldCheck size={16} />,
              },
              {
                value: "key",
                label: "私钥文件",
                description: "指定本机私钥路径",
                icon: <KeyRound size={16} />,
              },
              {
                value: "password",
                label: "密码",
                description: "凭据由系统安全存储加密",
                icon: <KeyRound size={16} />,
              },
            ]}
          />
        </div>
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
        <div className="select-field">
          <span>跳板机（可选）</span>
          <SelectMenu
            label="跳板机"
            value={value.jumpServerId ?? ""}
            onChange={(jumpServerId) =>
              setValue({
                ...value,
                jumpServerId: jumpServerId || undefined,
              })
            }
            options={[
              {
                value: "",
                label: "无（直连）",
                description: "不使用跳板机代理",
              },
              ...servers
                .filter((s) => !server || s.id !== server.id)
                .map((s) => ({
                  value: s.id,
                  label: `${s.name} (${s.username}@${s.host})`,
                  description: `${s.host}:${s.port}`,
                  icon: <ServerIcon size={16} />,
                })),
            ]}
          />
        </div>
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
function SettingsPage({
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
          provider: settings.provider,
          reasoningEffort: settings.reasoningEffort,
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
    <form className="settings-page" onSubmit={submit} aria-label="设置与模型">
      <div className="settings-scroll">
        <div className="settings-inner">
          <header className="settings-page-heading">
            <div>
              <div className="section-eyebrow">PREFERENCES</div>
              <h1>设置与模型</h1>
              <p className="muted">管理外观、模型服务与外部智能体。</p>
            </div>
            <button type="button" className="secondary-button" onClick={close}>
              <ArrowLeft size={15} />
              返回会话
            </button>
          </header>
          <nav className="settings-navigation" aria-label="设置分类">
            {[
              ["settings-appearance", "外观"],
              ["settings-model", "模型服务"],
              ["settings-cli", "外部智能体"],
            ].map(([id, title]) => (
              <button
                key={id}
                type="button"
                onClick={() =>
                  document
                    .getElementById(id)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                {title}
              </button>
            ))}
          </nav>
          <div className="settings-sections">
            <section className="settings-section" id="settings-appearance">
              <ThemeSettings />
            </section>
            {settings && (
              <section className="settings-section" id="settings-model">
                <h2>模型服务</h2>
                <p className="muted">
                  内置智能体的 API 配置，修改后点击保存设置。
                </p>
                <div className="select-field">
                  <span>内置模型方案</span>
                  <SelectMenu
                    label="内置模型方案"
                    value={settings.provider ?? "compatible"}
                    onChange={(provider) => {
                      setSettings({
                        ...settings,
                        provider: provider as Settings["provider"],
                        ...(provider === "deepseek"
                          ? {
                              baseUrl: "https://api.deepseek.com",
                              model: "deepseek-flash",
                              reasoningEffort: "none" as const,
                            }
                          : {}),
                      });
                      setSaved(false);
                    }}
                    options={[
                      {
                        value: "deepseek",
                        label: "DeepSeek 官方 API",
                        description: "官方模型与思考模式",
                      },
                      {
                        value: "compatible",
                        label: "兼容 Chat Completions",
                        description: "保留自定义模型服务",
                      },
                    ]}
                  />
                </div>
                {settings.provider === "deepseek" && (
                  <div className="select-field">
                    <span>内置默认思考强度</span>
                    <SelectMenu
                      label="内置默认思考强度"
                      value={settings.reasoningEffort ?? "none"}
                      onChange={(effort) =>
                        setSettings({
                          ...settings,
                          reasoningEffort:
                            effort as Settings["reasoningEffort"],
                        })
                      }
                      options={[
                        {
                          value: "none",
                          label: "无",
                          description: "关闭思考模式",
                        },
                        { value: "low", label: "低" },
                        { value: "high", label: "高" },
                        { value: "max", label: "最大" },
                      ]}
                    />
                  </div>
                )}
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
              </section>
            )}
            <section className="settings-section" id="settings-cli">
              <div className="cli-heading">
                <h3>外部智能体</h3>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    refreshCli().catch((e) => setError(errorText(e)))
                  }
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
            </section>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
      <footer className="settings-page-footer">
        <span className="settings-save-hint">
          外观自动保存 · 模型服务需保存设置
        </span>
        {saved && (
          <span className="saved-note">
            <Check size={14} />
            已保存
          </span>
        )}

        <button className="primary-button" disabled={busy || !settings}>
          {busy ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Check size={14} />
          )}
          保存设置
        </button>
      </footer>
    </form>
  );
}
