export type TerminalSessionStatus =
  | "connecting"
  | "connected"
  | "disconnected";

export interface TerminalSession {
  id: string;
  serverId: string;
  terminalIndex: number;
  status: TerminalSessionStatus;
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
  shouldRemove: boolean;
}
