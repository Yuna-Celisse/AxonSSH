import { useEffect, useState } from "react";
import { Brain, LoaderCircle, RefreshCw } from "lucide-react";
import SelectMenu from "./SelectMenu";
import type { AgentSelection, Engine, ModelCatalog } from "../shared/types";

const effortNames: Record<string, string> = {
  none: "无",
  minimal: "最少",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最大",
  ultra: "超强",
  ultracode: "Ultracode",
};
export default function AgentOptionsPicker({
  engine,
  selection,
  change,
}: {
  engine: Engine;
  selection: AgentSelection;
  change(selection: AgentSelection): void;
}) {
  const [catalog, setCatalog] = useState<ModelCatalog>({ models: [] });
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCatalog({ models: [] });
    void window.axon.agent
      .models(engine, refresh > 0)
      .then((result) => {
        if (!cancelled) setCatalog(result);
      })
      .catch(() => {
        if (!cancelled)
          setCatalog({ models: [], error: "模型目录暂时不可用，请刷新" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [engine, refresh]);
  const selected =
    catalog.models.find((m) => m.id === selection.model) ??
    (engine === "builtin" && !selection.model ? catalog.models[0] : undefined);
  const modelOptions = [
    {
      value: "",
      label: "默认模型",
      description:
        engine === "builtin" ? "使用设置中的模型" : "沿用 CLI 自己的配置",
    },
    ...catalog.models.map((m) => ({
      value: m.id,
      label: m.name,
      description: m.description ?? m.id,
    })),
    ...(selection.model && !selected
      ? [
          {
            value: selection.model,
            label: selection.model,
            description: loading ? "正在读取目录" : "已保存 · 当前目录未列出",
            disabled: true,
          },
        ]
      : []),
  ];
  const effortOptions = [
    {
      value: "",
      label: "默认强度",
      description: selected?.defaultEffort
        ? `模型默认：${effortNames[selected.defaultEffort] ?? selected.defaultEffort}`
        : "沿用引擎默认设置",
    },
    ...(selected?.efforts ?? []).map((e) => ({
      value: e,
      label: effortNames[e] ?? e,
      description: e,
    })),
    ...(selection.effort && !selected?.efforts.includes(selection.effort)
      ? [
          {
            value: selection.effort,
            label: effortNames[selection.effort] ?? selection.effort,
            description: "已保存 · 请刷新或重新选择",
            disabled: true,
          },
        ]
      : []),
  ];
  return (
    <div className="agent-model-controls">
      <SelectMenu
        label="智能体模型"
        compact
        value={selection.model ?? ""}
        options={modelOptions}
        onChange={(model) => {
          if (model !== (selection.model ?? ""))
            change({ model: model || undefined });
        }}
      />
      {(engine !== "builtin" ||
        catalog.models.some((m) => m.efforts.length > 0)) && (
        <SelectMenu
          label="思考强度"
          compact
          icon={<Brain size={12} />}
          value={selection.effort ?? ""}
          options={effortOptions}
          onChange={(effort) =>
            change({ ...selection, effort: effort || undefined })
          }
        />
      )}
      <button
        type="button"
        className="icon-button"
        aria-label="刷新智能体模型"
        title={
          catalog.error ?? (loading ? "正在读取模型目录" : "刷新模型与思考强度")
        }
        disabled={loading}
        onClick={() => setRefresh((n) => n + 1)}
      >
        {loading ? (
          <LoaderCircle size={12} className="spin" />
        ) : (
          <RefreshCw size={12} />
        )}
      </button>
      {catalog.error && (
        <span className="model-catalog-error" title={catalog.error}>
          目录不可用
        </span>
      )}
      {engine !== "builtin" && !selection.model && (
        <span className="model-selection-hint">选择模型后可调整强度</span>
      )}
    </div>
  );
}
