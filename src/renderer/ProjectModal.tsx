import { useState, type FormEvent } from "react";
import { FolderOpen, LoaderCircle, X } from "lucide-react";
import type { Project, Server } from "../shared/types";

export default function ProjectModal({
  project,
  workspaceId,
  servers,
  close,
  saved,
}: {
  project?: Project;
  workspaceId: string;
  servers: Server[];
  close(): void;
  saved(project: Project): void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [directory, setDirectory] = useState(project?.directory ?? "");
  const [includeLocal, setIncludeLocal] = useState(
    project?.includeLocal ?? true,
  );
  const [serverIds, setServerIds] = useState<string[]>(
    project?.serverIds ?? [],
  );
  const [remoteDirectory, setRemoteDirectory] = useState(
    project?.remoteDirectory ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(
    event?: FormEvent,
    archived = project?.archived ?? false,
  ) {
    event?.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      saved(
        await window.axon.projects.save({
          id: project?.id,
          workspaceId,
          name: name.trim(),
          directory: directory.trim(),
          includeLocal,
          serverIds,
          remoteDirectory: remoteDirectory.trim(),
          archived,
        }),
      );
      close();
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : String(e)).replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-overlay">
      <form
        className="modal"
        onSubmit={save}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-title"
      >
        <div className="modal-head">
          <div className="modal-icon">
            <FolderOpen size={20} />
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭项目编辑"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <h2 id="project-title">{project ? "管理项目" : "新建项目"}</h2>
        <p className="muted">同一项目可以同时关联本地与多台服务器。</p>
        <label>
          项目名称
          <input
            autoFocus
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：服务器部署"
          />
        </label>
        <fieldset className="workspace-server-options project-server-options">
          <legend>关联位置（可多选）</legend>
          <label>
            <input
              type="checkbox"
              aria-label="关联本地"
              checked={includeLocal}
              onChange={(event) => setIncludeLocal(event.target.checked)}
            />
            <span>
              本地<small>可以和服务器同时关联</small>
            </span>
          </label>
          {servers.map((server) => (
            <label key={server.id}>
              <input
                type="checkbox"
                checked={serverIds.includes(server.id)}
                onChange={(event) =>
                  setServerIds((current) =>
                    event.target.checked
                      ? [...current, server.id]
                      : current.filter((id) => id !== server.id),
                  )
                }
              />
              <span>
                {server.name}
                <small>
                  {server.username}@{server.host}:{server.port}
                </small>
              </span>
            </label>
          ))}
          {serverIds
            .filter((id) => !servers.some((s) => s.id === id))
            .map((id) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked
                  onChange={() =>
                    setServerIds((current) =>
                      current.filter((value) => value !== id),
                    )
                  }
                />
                <span>
                  不可用的服务器<small>{id}</small>
                </span>
              </label>
            ))}
          {!servers.length && (
            <p className="muted">尚未添加服务器；添加后可与本地一起关联。</p>
          )}
        </fieldset>
        <label>
          本地目录（可选）
          <div className="project-directory-field">
            <input
              aria-label="项目目录"
              maxLength={4096}
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              placeholder="选择已有目录，或留空仅分组"
            />
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={async () => {
                setError("");
                try {
                  const path = await window.axon.projects.chooseDirectory();
                  if (path) setDirectory(path);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              浏览
            </button>
          </div>
        </label>
        {serverIds.length > 0 && (
          <label>
            远程目录（可选）
            <input
              aria-label="远程项目目录"
              value={remoteDirectory}
              maxLength={4096}
              onChange={(event) => setRemoteDirectory(event.target.value)}
              placeholder="例如：/opt/my-project"
            />
          </label>
        )}
        <div className="form-note">
          <FolderOpen size={15} />
          <span>
            本地目录是 CLI 的工作目录，关联位置决定 Session
            可选择的任务目标。同一项目可以同时包含本地和多台服务器；远程目录用于文件浏览，不会自动创建目录或批量执行。
            内置智能体不会自动读取文件。已有记录保留。
          </span>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          {project && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void save(undefined, !project.archived)}
            >
              {project.archived ? "取消归档" : "归档项目"}
            </button>
          )}
          <button type="button" className="secondary-button" onClick={close}>
            取消
          </button>
          <button
            className="primary-button"
            disabled={
              busy || !name.trim() || (!includeLocal && !serverIds.length)
            }
          >
            {busy && <LoaderCircle size={14} className="spin" />}保存项目
          </button>
        </div>
      </form>
    </div>
  );
}
