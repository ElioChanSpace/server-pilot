import type { TerminalSession, TerminalSessionSummary } from "../types/terminal";

/**
 * 终端会话元数据持久化。
 *
 * 后端 PTY 会话在 UI 刷新后仍然存活，但 tab 元数据（displayId/createdAt 等）
 * 只存在于前端内存 —— 这里把它们落到 localStorage，刷新后与后端
 * list_terminal_sessions 对账即可完整恢复 tab。
 */
const STORAGE_KEY = "server-pilot-terminal-sessions";

export function loadStoredSessions(): TerminalSession[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(s => s && typeof s.id === "string") : [];
  } catch {
    return [];
  }
}

export function saveStoredSessions(sessions: TerminalSession[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // 存储满等情况忽略 —— 恢复只是体验增强，不能影响主流程
  }
}

export function clearStoredSessions(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 用后端存活会话对账出可恢复的 tab 列表：
 * - 元数据命中 → 完整恢复（displayId/createdAt 不变）
 * - 元数据缺失（如崩溃后）→ 生成默认元数据
 * - 元数据存在但后端会话已死 → 丢弃
 */
export function reconcileSessions(
  alive: TerminalSessionSummary[],
  stored: TerminalSession[],
): TerminalSession[] {
  const storedById = new Map(stored.map(s => [s.id, s]));
  const restored: TerminalSession[] = [];
  for (const summary of alive) {
    if (!summary.alive) continue;
    const meta = storedById.get(summary.sessionId);
    const status: TerminalSession["status"] = summary.wasConnected ? "connected" : "disconnected";
    if (meta) {
      restored.push({ ...meta, serverId: summary.serverId, status });
    } else {
      restored.push({
        id: summary.sessionId,
        serverId: summary.serverId,
        terminalIndex: 0,
        displayId: Math.random().toString(36).slice(2, 8),
        status,
        createdAt: summary.createdAt || Date.now(),
      });
    }
  }
  return restored;
}
