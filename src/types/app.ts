import type { ContextMenuAction } from "../components/ContextMenu";

export interface ContextMenuState {
  x: number;
  y: number;
  actions: ContextMenuAction[];
}

export interface TerminalOutputState {
  chunks: string[];
  resetToken: number;
}

export interface FileTransferProgressEvent {
  transferId: string;
  direction: string;
  localPath: string;
  remotePath: string;
  status: "preparing" | "progress" | "completed" | "failed";
  progressPercent: number;
  transferredBytes?: number | null;
  totalBytes?: number | null;
  bytesPerSecond?: number | null;
  etaSeconds?: number | null;
  message?: string | null;
}

export interface UploadProgressOverlayState {
  transferId: string;
  sessionId: string;
  serverName: string;
  currentDirectory: string;
  currentFileName: string;
  currentFileIndex: number;
  totalFiles: number;
  status: "preparing" | "uploading" | "completed" | "failed";
  progressPercent: number;
  transferredBytes: number | null;
  totalBytes: number | null;
  bytesPerSecond: number | null;
  etaSeconds: number | null;
  message: string | null;
}

export interface HostKeyPromptEvent {
  sessionId: string;
  serverId: string;
  fingerprint: string;
}

export interface AppStats {
  memoryMb: number;
  cpuPercent: number;
}
