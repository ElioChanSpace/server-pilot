import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommandRecord } from "../types/terminal";

const LEGACY_STORAGE_KEY = "server-pilot-command-history";
const RECENT_DUPLICATE_WINDOW_MS = 1500;
const MAX_RECORDS = 1000;

function loadLegacyRecords(): CommandRecord[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const records = JSON.parse(raw);
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function isSameCommand(a: CommandRecord, b: Omit<CommandRecord, "id" | "timestamp">) {
  return (
    a.sessionId === b.sessionId &&
    a.displayId === b.displayId &&
    a.serverId === b.serverId &&
    a.command === b.command
  );
}

export function useCommandHistory() {
  const [commands, setCommands] = useState<CommandRecord[]>([]);
  const commandsRef = useRef<CommandRecord[]>([]);
  const mountedRef = useRef(true);

  const setCommandState = useCallback((records: CommandRecord[]) => {
    commandsRef.current = records;
    setCommands(records);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    const load = async () => {
      try {
        let records = await invoke<CommandRecord[]>("get_command_history");
        const legacyRecords = loadLegacyRecords();
        if (records.length === 0 && legacyRecords.length > 0) {
          records = await invoke<CommandRecord[]>("replace_command_history", {
            records: legacyRecords,
          });
          window.localStorage.removeItem(LEGACY_STORAGE_KEY);
        }
        if (mountedRef.current) {
          setCommandState(records);
        }
      } catch (error) {
        console.error("加载命令历史失败:", error);
      }
    };

    void load();

    return () => {
      mountedRef.current = false;
    };
  }, [setCommandState]);

  const addCommand = useCallback(async (
    sessionId: string,
    displayId: string,
    serverId: string,
    serverName: string,
    command: string,
  ) => {
    const normalizedCommand = command.trim();
    if (!normalizedCommand) return;

    const pendingRecord = {
      sessionId,
      displayId,
      serverId,
      serverName,
      command: normalizedCommand,
    };

    const recentDuplicate = [...commandsRef.current]
      .reverse()
      .find(record => Date.now() - record.timestamp <= RECENT_DUPLICATE_WINDOW_MS && isSameCommand(record, pendingRecord));
    if (recentDuplicate) return;

    try {
      const record = await invoke<CommandRecord>("add_command_history", pendingRecord);
      const next = [...commandsRef.current, record].slice(-MAX_RECORDS);
      setCommandState(next);
    } catch (error) {
      console.error("保存命令历史失败:", error);
    }
  }, [setCommandState]);

  const removeCommandsBySession = useCallback(async (sessionIds: string[]) => {
    if (sessionIds.length === 0) return;
    const previous = commandsRef.current;
    const removed = new Set(sessionIds);
    const next = previous.filter(cmd => !removed.has(cmd.sessionId));
    setCommandState(next);
    try {
      await invoke("remove_command_history_by_session", { sessionIds });
    } catch (error) {
      console.error("删除终端命令历史失败:", error);
      setCommandState(previous);
    }
  }, [setCommandState]);

  const removeCommandsByServer = useCallback(async (serverId: string) => {
    const previous = commandsRef.current;
    const next = previous.filter(cmd => cmd.serverId !== serverId);
    setCommandState(next);
    try {
      await invoke("remove_command_history_by_server", { serverId });
    } catch (error) {
      console.error("删除服务器命令历史失败:", error);
      setCommandState(previous);
    }
  }, [setCommandState]);

  const clearCommands = useCallback(async () => {
    const previous = commandsRef.current;
    setCommandState([]);
    try {
      await invoke("clear_command_history");
    } catch (error) {
      console.error("清空命令历史失败:", error);
      setCommandState(previous);
    }
  }, [setCommandState]);

  return {
    commands,
    addCommand,
    removeCommandsBySession,
    removeCommandsByServer,
    clearCommands,
  };
}
