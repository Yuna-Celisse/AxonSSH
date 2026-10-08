import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

type Option = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  icon?: ReactNode;
};

export default function SelectMenu({
  label,
  value,
  options,
  onChange,
  compact = false,
  icon,
  disabled = false,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange(value: string): void;
  compact?: boolean;
  icon?: ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
    maxHeight: number;
  }>({ left: 0, top: 0, width: 250, maxHeight: 300 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const items = () =>
    Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>(
        '[role="option"]:not(:disabled)',
      ) ?? [],
    );
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const blur = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (!trigger.current?.contains(next) && !menu.current?.contains(next))
      setOpen(false);
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 260), innerWidth - 24);
      const desiredHeight = Math.min(360, 42 + options.length * 61);
      const below = innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const upwards = below < desiredHeight && above > below;
      const maxHeight = Math.max(
        80,
        Math.min(desiredHeight, upwards ? above : below),
      );
      setPosition({
        left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)),
        ...(upwards
          ? { bottom: innerHeight - rect.top + 7 }
          : { top: rect.bottom + 7 }),
        width,
        maxHeight,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    (
      items().find((item) => item.dataset.value === value) ?? items()[0]
    )?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target))
        setOpen(false);
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
  }, [open, value]);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        ref={trigger}
        className={`select-menu-trigger ${compact ? "compact" : ""}`}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        data-value={value}
        onBlur={blur}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon}
        <span>{selected?.label ?? "请选择"}</span>
        <ChevronDown
          size={13}
          className={open ? "select-menu-chevron open" : "select-menu-chevron"}
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="select-menu-popover"
            style={position}
            onBlur={blur}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="workspace-menu-caption">{label}</div>
            <div
              id={listId}
              role="listbox"
              aria-label={`选择${label}`}
              className="select-menu-options"
              onKeyDown={(event) => {
                const enabled = items();
                const index = enabled.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                const next =
                  event.key === "ArrowDown"
                    ? (index + 1) % enabled.length
                    : event.key === "ArrowUp"
                      ? (index - 1 + enabled.length) % enabled.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? enabled.length - 1
                          : undefined;
                if (next !== undefined) {
                  event.preventDefault();
                  enabled[next]?.focus();
                } else if (event.key.length === 1 && event.key !== " ") {
                  const match = [
                    ...enabled.slice(index + 1),
                    ...enabled.slice(0, index + 1),
                  ].find((item) =>
                    item
                      .getAttribute("aria-label")
                      ?.toLowerCase()
                      .startsWith(event.key.toLowerCase()),
                  );
                  if (match) {
                    event.preventDefault();
                    match.focus();
                  }
                }
              }}
            >
              {options.map((option) => (
                <button
                  type="button"
                  role="option"
                  key={option.value}
                  aria-label={option.label}
                  aria-selected={value === option.value}
                  disabled={option.disabled}
                  data-value={option.value}
                  className="workspace-option select-menu-option"
                  onClick={() => {
                    onChange(option.value);
                    close();
                  }}
                >
                  {option.icon}
                  <span className="workspace-option-text">
                    <span>{option.label}</span>
                    {option.description && <small>{option.description}</small>}
                  </span>
                  {value === option.value && (
                    <Check size={15} className="workspace-check" />
                  )}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
