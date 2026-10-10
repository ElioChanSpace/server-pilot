export type TerminalSessionStatus =
  | "connecting"
  | "connected"
  | "disconnected";

export interface TerminalSession {
  id: string;
  serverId: string;
  terminalIndex: number;
  displayId: string; // 全局唯一显示标识，6 位随机字符串
  status: TerminalSessionStatus;
  createdAt: number; // Unix timestamp in milliseconds
  /** 固定标签（置顶显示） */
  pinned?: boolean;
  /** 标签配色（左缘色条，CSS 颜色值） */
  color?: string;
  /** 自定义标签名（双击重命名；为空时显示服务器名） */
  alias?: string;
}

export interface ConnectServerResult {
  sessionId: string;
}

export interface TerminalSessionSummary {
  sessionId: string;
  serverId: string;
  alive: boolean;
  wasConnected: boolean;
  createdAt: number;
}

export interface TerminalSessionStatusEvent {
  sessionId: string;
  serverId: string;
  status: TerminalSessionStatus;
}

export interface TerminalSessionClosedEvent {
  sessionId: string;
  serverId: string;
  reason: string;
  message?: string;
  shouldRemove: boolean;
}

export interface CommandRecord {
  id: string;
  sessionId: string;   // 终端 session UUID
  displayId: string;   // 终端显示标识（6 位随机字符串）
  serverId: string;
  serverName: string;
  command: string;
  timestamp: number;   // Unix ms
}
