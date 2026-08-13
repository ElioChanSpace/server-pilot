export type TerminalSessionStatus =
  | "connecting"
  | "connected"
  | "disconnected";

export interface TerminalSession {
  id: string;
  serverId: string;
  terminalIndex: number;
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
