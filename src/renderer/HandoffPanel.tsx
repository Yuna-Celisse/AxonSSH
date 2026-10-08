import { ArrowRightLeft, RefreshCw } from "lucide-react";
import type { Engine, Session } from "../shared/types";

export default function HandoffPanel({
  session,
  engine,
  busy,
  reset,
}: {
  session: Session;
  engine: Engine;
  busy: boolean;
  reset(): void;
}) {
  const records = [...(session.handoffs ?? [])].reverse();
  return (
    <div className="activity-view handoff-view">
      <div className="handoff-heading">
        <div>
          <div className="section-eyebrow">HANDOFF</div>
          <h1>交接记录</h1>
        </div>
        {
          <button className="secondary-button" disabled={busy} onClick={reset}>
            <RefreshCw size={14} />
            重新建立当前引擎会话
          </button>
        }
      </div>
      <p className="muted">
        CLI 分别延续原生会话，内置智能体保留 API
        上下文，只追加新增记录。交接包由本机整理，没有额外的摘要模型调用。重新建立会保留旧会话及交接记录。
      </p>
      {!records.length && (
        <div className="empty-record">
          <ArrowRightLeft size={32} />
          <h3>还没有交接记录</h3>
          <p>发送任务后，各引擎的上下文与交接状态会显示在这里。</p>
        </div>
      )}
      {records.map((record) => {
        const native = session.nativeSessions?.find(
          (n) => n.key === record.nativeKey,
        );
        return (
          <article className="handoff-card" key={record.id}>
            <div className="handoff-card-header">
              <strong>
                {record.engine === "builtin"
                  ? "内置智能体"
                  : record.engine === "codex"
                    ? "Codex"
                    : "Claude"}{" "}
                ·{" "}
                {record.resumed
                  ? record.messageIds.length || record.recordIds.length
                    ? "恢复原会话并交接增量"
                    : "延续原会话"
                  : record.engine === "builtin"
                    ? "建立 API 上下文"
                    : "建立原生会话"}
              </strong>
              <span
                className={`badge ${record.status === "completed" ? "success" : "warning"}`}
              >
                {
                  {
                    running: "进行中",
                    completed: "已完成",
                    error: "失败",
                    interrupted: "已中断",
                  }[record.status]
                }
              </span>
            </div>
            <div className="handoff-metadata">
              <span>{new Date(record.createdAt).toLocaleString()}</span>
              <span>
                {record.messageIds.length} 条消息 · {record.recordIds.length}{" "}
                条操作记录
              </span>
            </div>
            {native?.nativeId && (
              <code className="native-session-id">
                原生 ID：{native.nativeId}
                {native.retired ? " · 已保留为历史会话" : ""}
              </code>
            )}
            {native?.apiMessages && (
              <code className="native-session-id">
                已保留 {native.apiMessages.length} 条 API 上下文消息
                {native.retired ? " · 已保留为历史上下文" : ""}
              </code>
            )}
            {record.truncated && (
              <p className="handoff-warning">
                交接使用有长度限制的摘录，部分内容未发送。完整消息与操作记录仍保留在
                Session 中。
              </p>
            )}
            {record.error && <p className="handoff-warning">{record.error}</p>}
            {record.usage && (
              <div className="handoff-metadata">
                服务报告：输入 {record.usage.inputTokens ?? "未知"} · 缓存读取{" "}
                {record.usage.cachedTokens ?? "未知"} · 缓存写入{" "}
                {record.usage.cacheWriteTokens ?? "未知"} · 输出{" "}
                {record.usage.outputTokens ?? "未知"} tokens
              </div>
            )}
            <details>
              <summary>查看交接包</summary>
              <pre>{record.payload}</pre>
            </details>
          </article>
        );
      })}
    </div>
  );
}
