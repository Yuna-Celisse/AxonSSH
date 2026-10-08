import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, FolderOpen, Plus } from "lucide-react";
import type { Workspace } from "./workspaces";

export default function WorkspaceSwitcher({
  workspaces,
  activeId,
  select,
  create,
}: {
  workspaces: Workspace[];
  activeId: string;
  select(id: string): void;
  create(): void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const active = workspaces.find((w) => w.id === activeId)!;
  const options = () =>
    Array.from(
      root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ??
        [],
    );
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    options()
      .find((el) => el.dataset.workspaceId === activeId)
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, activeId]);
  return (
    <div
      className="workspace-switch"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="workspace-trigger"
        role="combobox"
        aria-label="工作空间"
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-expanded={open}
        data-workspace-id={activeId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="workspace-icon">
          <FolderOpen size={17} />
        </span>
        <span className="workspace-trigger-name" title={active.name}>
          {active.name}
        </span>
        <ChevronDown
          size={14}
          className={open ? "workspace-chevron open" : "workspace-chevron"}
        />
      </button>
      <button
        className="icon-button workspace-create"
        aria-label="新建工作空间"
        title="新建工作空间"
        onClick={create}
      >
        <Plus size={16} />
      </button>
      {open && (
        <div className="workspace-menu">
          <div className="workspace-menu-caption">工作空间</div>
          <div
            id={listId}
            role="listbox"
            aria-label="选择工作空间"
            className="workspace-options"
            onKeyDown={(event) => {
              const items = options();
              const index = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "ArrowDown"
                  ? (index + 1) % items.length
                  : event.key === "ArrowUp"
                    ? (index - 1 + items.length) % items.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? items.length - 1
                        : undefined;
              if (next !== undefined) {
                event.preventDefault();
                items[next]?.focus();
              }
            }}
          >
            {workspaces.map((w) => (
              <button
                key={w.id}
                role="option"
                aria-label={w.name}
                aria-selected={w.id === activeId}
                data-workspace-id={w.id}
                className="workspace-option"
                onClick={() => {
                  select(w.id);
                  close();
                }}
              >
                <FolderOpen size={16} />
                <span className="workspace-option-text">
                  <span>{w.name}</span>
                  <small>{w.serverIds.length} 台服务器</small>
                </span>
                {w.id === activeId && (
                  <Check size={15} className="workspace-check" />
                )}
              </button>
            ))}
          </div>
          <div className="workspace-menu-footer">
            <button
              onClick={() => {
                setOpen(false);
                create();
              }}
            >
              <Plus size={15} />
              创建新的工作空间
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
