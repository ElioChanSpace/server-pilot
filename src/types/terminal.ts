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
}

export interface ConnectServerResult {
  sessionId: string;
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
