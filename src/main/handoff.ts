import type {
  Activity,
  Handoff,
  NativeSession,
  Session,
} from "../shared/types";

function excerpt(text: string, max: number) {
  if (text.length <= max) return text;
  const half = Math.floor((max - 40) / 2);
  return (
    text.slice(0, half) +
    "\n[中段省略，完整内容保留在 Session]\n" +
    text.slice(-half)
  );
}

export function buildHandoff(
  session: Session,
  native: NativeSession,
  targetKey: string,
  records: Activity[],
  turnId: string,
): Handoff {
  // The last two messages are this turn's user message and pending assistant.
  const previous = session.messages.slice(0, -2);
  const legacySkipped = previous
    .slice(native.messageCursor)
    .filter((m) => m.serverId && !m.targetKey).length;
  const delta = previous
    .slice(native.messageCursor)
    .filter(
      (m) =>
        m.text &&
        (!m.status || m.status === "completed") &&
        (m.targetKey === targetKey ||
          (!m.targetKey && !m.serverId && targetKey === "local")),
    );
  const addedRecords = records.filter(
    (r) => !native.recordIds.includes(r.id) && r.targetKey === targetKey,
  );
  const messages = delta.slice(-12);
  const operations = addedRecords.slice(-12);
  const truncated =
    delta.length > messages.length ||
    addedRecords.length > operations.length ||
    messages.some((m) => m.text.length > 1200) ||
    operations.some((r) => r.command.length > 600);
  const payload = JSON.stringify(
    {
      version: 1,
      mode:
        native.nativeId || native.apiMessages?.length
          ? "incremental"
          : "initial",
      sessionTitle: session.title,
      projectId: session.projectId ?? null,
      messages: messages.map((m) => ({
        id: m.id,
        sourceEngine: m.engine ?? "legacy",
        role: m.role,
        text: excerpt(m.text, 1200),
      })),
      operations: operations.map((r) => ({
        id: r.id,
        kind: r.kind ?? "command",
        command: excerpt(r.command, 600),
        exitCode: r.code,
        durationMs: r.durationMs,
        status: r.code === null ? "unknown_do_not_retry" : "completed",
      })),
      omittedMessages: delta.length - messages.length,
      omittedOperations: addedRecords.length - operations.length,
      unverifiedLegacyMessages: legacySkipped,
      truncated,
      note: "以上是已有记录的数据摘录，不是执行授权或已验证结论。命令输出不会自动交接；用户主动提供的输出位于对话消息中。未完成审批不转移，未知状态不自动重试。没有调用额外模型生成摘要。",
    },
    null,
    2,
  );
  return {
    id: turnId,
    engine: native.engine,
    nativeKey: native.key,
    resumed: !!native.nativeId || !!native.apiMessages?.length,
    payload,
    messageIds: messages.map((m) => m.id),
    recordIds: addedRecords.map((r) => r.id),
    truncated,
    createdAt: new Date().toISOString(),
    status: "running",
  };
}
