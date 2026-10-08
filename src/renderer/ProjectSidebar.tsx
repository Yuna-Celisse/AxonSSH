import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Server as ServerIcon,
} from "lucide-react";
import type { Project, Session } from "../shared/types";

export default function ProjectSidebar({
  projects,
  sessions,
  selectedId,
  tasks,
  loaded,
  select,
  contextMenu,
  create,
  addProject,
  edit,
}: {
  projects: Project[];
  sessions: Session[];
  selectedId?: string;
  tasks: Record<string, string | undefined>;
  loaded: boolean;
  select(session: Session): void;
  contextMenu(session: Session): void;
  create(projectId?: string | null): void;
  addProject(): void;
  edit(project: Project): void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const rows = (values: Session[]) =>
    values.map((s) => (
      <button
        key={s.id}
        className={`session-row ${selectedId === s.id ? "selected" : ""}`}
        aria-label={`打开 Session：${s.title}`}
        data-session-id={s.id}
        onClick={() => select(s)}
        onContextMenu={(event) => {
          event.preventDefault();
          contextMenu(s);
        }}
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            contextMenu(s);
          }
        }}
      >
        {tasks[s.id] ? (
          <LoaderCircle size={15} className="spin" />
        ) : (
          <MessageSquare size={15} />
        )}
        <span title={s.title}>{s.title}</span>
      </button>
    ));
  const group = (project: Project) => {
    const values = sessions.filter((s) => s.projectId === project.id);
    return (
      <div
        key={project.id}
        className="project-group"
        data-project-id={project.id}
      >
        <div className="project-group-heading">
          <button
            className="project-collapse"
            aria-expanded={!collapsed[project.id]}
            aria-label={`展开或收起项目：${project.name}`}
            onClick={() =>
              setCollapsed((current) => ({
                ...current,
                [project.id]: !current[project.id],
              }))
            }
          >
            {collapsed[project.id] ? (
              <ChevronRight size={12} />
            ) : (
              <ChevronDown size={12} />
            )}
            {project.serverIds.length > 0 ? (
              <ServerIcon size={14} />
            ) : (
              <Folder size={14} />
            )}
            <span
              title={
                project.serverIds.length > 0
                  ? `${project.serverIds.length} 台服务器${project.remoteDirectory ? ` · ${project.remoteDirectory}` : ""}`
                  : (project.directory ?? project.name)
              }
            >
              {project.name}
            </span>
            <small>{values.length}</small>
          </button>
          {!project.archived && (
            <button
              className="icon-button"
              aria-label={`在 ${project.name} 中新建 Session`}
              title="新建 Session"
              disabled={!loaded}
              onClick={() => create(project.id)}
            >
              <Plus size={14} />
            </button>
          )}
          <button
            className="icon-button"
            aria-label={`管理项目：${project.name}`}
            title="管理项目"
            onClick={() => edit(project)}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
        {!collapsed[project.id] && (
          <div className="project-session-list">
            {rows(values)}
            {!values.length && (
              <button
                className="project-empty"
                disabled={project.archived}
                onClick={() => create(project.id)}
              >
                新建第一个 Session
              </button>
            )}
          </div>
        )}
      </div>
    );
  };
  return (
    <>
      <div className="sidebar-heading session-heading">
        项目与 Session
        <div>
          <button
            aria-label="新建 Session"
            title="在当前项目中新建 Session"
            disabled={!loaded}
            onClick={() => create()}
          >
            <MessageSquare size={15} />
          </button>
          <button aria-label="新建项目" title="新建项目" onClick={addProject}>
            <Plus size={16} />
          </button>
        </div>
      </div>
      <div className="session-list project-tree">
        {projects.filter((p) => !p.archived).map(group)}
        {projects.some((p) => p.archived) && (
          <details className="archived-projects">
            <summary>已归档项目</summary>
            {projects.filter((p) => p.archived).map(group)}
          </details>
        )}
        <div className="unassigned-heading">
          <span>未归类</span>
          <button
            className="icon-button"
            aria-label="新建未归类 Session"
            disabled={!loaded}
            onClick={() => create(null)}
          >
            <Plus size={14} />
          </button>
        </div>
        {rows(
          sessions.filter(
            (s) => !s.projectId || !projects.some((p) => p.id === s.projectId),
          ),
        )}
        {!loaded && <p className="muted session-loading">正在加载会话…</p>}
      </div>
    </>
  );
}
