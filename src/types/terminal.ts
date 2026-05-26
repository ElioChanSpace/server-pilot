export interface TerminalSession {
  id: string;
  serverId: string;
  terminalIndex: number;
}

export interface ConnectServerResult {
  sessionId: string;
}
