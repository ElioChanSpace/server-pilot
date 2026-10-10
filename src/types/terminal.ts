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
  /** 分屏组 ID：同组会话在同一标签内以分屏网格展示 */
  groupId?: string;
  /** 分屏方向（组内一致）：row=左右拆分，column=上下拆分 */
  paneLayout?: 'row' | 'column';
  /** 该面板的尺寸权重（拖拽分隔条时更新） */
  paneRatio?: number;
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
