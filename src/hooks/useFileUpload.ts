import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import type { UploadProgressOverlayState } from "../types/app";
import type { Server } from "../context/ServerContext";
import type { TerminalSession } from "../types/terminal";
import { getBaseName, joinRemotePath, createTransferId } from "../utils/path-helpers";
import { getErrorMessage } from "../utils/format-helpers";

export function useFileUpload(
  servers: Server[],
  sessions: TerminalSession[],
  notify: (title: string, body?: string) => void,
) {
  const [uploadProgressOverlay, setUploadProgressOverlay] = useState<UploadProgressOverlayState | null>(null);
  const [, setSessionCurrentDirectories] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!uploadProgressOverlay || (uploadProgressOverlay.status !== "completed" && uploadProgressOverlay.status !== "failed")) {
      return;
    }

    if (uploadProgressOverlay.status === "completed") {
      notify(
        "上传完成",
        `${uploadProgressOverlay.serverName} · ${uploadProgressOverlay.currentFileName}`,
      );
    } else if (uploadProgressOverlay.status === "failed") {
      notify(
        "上传失败",
        `${uploadProgressOverlay.serverName} · ${uploadProgressOverlay.message ?? ""}`,
      );
    }

    const timeoutId = window.setTimeout(() => {
      setUploadProgressOverlay(current => {
        if (!current || current.transferId !== uploadProgressOverlay.transferId) {
          return current;
        }
        return null;
      });
    }, 3200);

    return () => window.clearTimeout(timeoutId);
  }, [notify, uploadProgressOverlay]);

  const removeSessionCurrentDirectories = useCallback((sessionIds: string[]) => {
    if (sessionIds.length === 0) {
      return;
    }

    const removedIds = new Set(sessionIds);
    setSessionCurrentDirectories(prev => {
      const next = { ...prev };
      removedIds.forEach(sessionId => {
        delete next[sessionId];
      });
      return next;
    });
  }, []);

  const handleTerminalFilesDropped = useCallback(async (sessionId: string, paths: string[]) => {
    const targetSession = sessions.find(session => session.id === sessionId);
    if (!targetSession) {
      return;
    }

    const targetServer = servers.find(server => server.id === targetSession.serverId);
    if (!targetServer) {
      return;
    }

    let currentDirectory: string;
    try {
      currentDirectory = await invoke<string>("get_terminal_session_directory", { sessionId });
      setSessionCurrentDirectories(prev => ({
        ...prev,
        [sessionId]: currentDirectory,
      }));
    } catch (error) {
      await message(getErrorMessage(error), "无法读取当前终端目录");
      return;
    }

    const uniquePaths = Array.from(new Set(paths));
    if (uniquePaths.length === 0) {
      return;
    }

    const previewNames = uniquePaths.slice(0, 3).map(path => getBaseName(path)).join("、");
    const confirmed = await confirm(
      `${uniquePaths.length > 1 ? `检测到 ${uniquePaths.length} 个文件` : `检测到文件 ${previewNames}`}，是否上传到当前目录 ${currentDirectory}？`,
      "上传到当前终端目录",
    );

    if (!confirmed) {
      return;
    }

    for (let index = 0; index < uniquePaths.length; index += 1) {
      const localPath = uniquePaths[index];
      const currentFileName = getBaseName(localPath);
      const remotePath = joinRemotePath(currentDirectory, currentFileName);
      const transferId = createTransferId();

      setUploadProgressOverlay({
        transferId,
        sessionId,
        serverName: targetServer.name,
        currentDirectory,
        currentFileName,
        currentFileIndex: index + 1,
        totalFiles: uniquePaths.length,
        status: "preparing",
        progressPercent: 0,
        transferredBytes: 0,
        totalBytes: null,
        bytesPerSecond: null,
        etaSeconds: null,
        message: "准备上传文件",
      });

      try {
        await invoke("upload_file_to_server", {
          id: targetServer.id,
          localPath,
          remotePath,
          transferId,
        });
      } catch (error) {
        setUploadProgressOverlay(current => {
          if (!current || current.transferId !== transferId) {
            return current;
          }

          return {
            ...current,
            status: "failed",
            progressPercent: current.progressPercent,
            bytesPerSecond: null,
            etaSeconds: null,
            message: getErrorMessage(error),
          };
        });
        return;
      }
    }
  }, [servers, sessions]);

  return {
    uploadProgressOverlay,
    setUploadProgressOverlay,
    handleTerminalFilesDropped,
    removeSessionCurrentDirectories,
  };
}
