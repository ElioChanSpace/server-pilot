import { useState, useCallback, useRef, useEffect } from "react";
import type { CommandRecord } from "../types/terminal";

const STORAGE_KEY = "server-pilot-command-history";
const MAX_RECORDS = 1000;

function loadFromStorage(): { records: CommandRecord[]; nextId: number } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { records: [], nextId: 0 };
    const records: CommandRecord[] = JSON.parse(raw);
    const maxId = records.reduce((max, r) => {
      const n = parseInt(r.id.replace("cmd-", ""), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    return { records, nextId: maxId + 1 };
  } catch {
    return { records: [], nextId: 0 };
  }
}

function saveToStorage(records: CommandRecord[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch { /* quota exceeded — silently ignore */ }
}

const initial = loadFromStorage();

export function useCommandHistory() {
  const [commands, setCommands] = useState<CommandRecord[]>(initial.records);
  const idCounterRef = useRef(initial.nextId);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(commands);
  latestRef.current = commands;

  // Debounced save to avoid writing on every keystroke
  const scheduleSave = useCallback((records: CommandRecord[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveToStorage(records), 300);
  }, []);

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveToStorage(latestRef.current);
      }
    };
  }, []);

  const addCommand = useCallback((
    sessionId: string,
    displayId: string,
    serverId: string,
    serverName: string,
    command: string,
  ) => {
    idCounterRef.current += 1;
    const record: CommandRecord = {
      id: `cmd-${idCounterRef.current}`,
      sessionId,
      displayId,
      serverId,
      serverName,
      command,
      timestamp: Date.now(),
    };
    setCommands(prev => {
      const next = [...prev, record];
      // Cap at MAX_RECORDS, trimming oldest
      const trimmed = next.length > MAX_RECORDS ? next.slice(next.length - MAX_RECORDS) : next;
      scheduleSave(trimmed);
      return trimmed;
    });
  }, [scheduleSave]);

  const removeCommandsBySession = useCallback((sessionIds: string[]) => {
    if (sessionIds.length === 0) return;
    const removed = new Set(sessionIds);
    setCommands(prev => {
      const next = prev.filter(cmd => !removed.has(cmd.sessionId));
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const removeCommandsByServer = useCallback((serverId: string) => {
    setCommands(prev => {
      const next = prev.filter(cmd => cmd.serverId !== serverId);
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const clearCommands = useCallback(() => {
    setCommands([]);
    saveToStorage([]);
  }, []);

  return {
    commands,
    addCommand,
    removeCommandsBySession,
    removeCommandsByServer,
    clearCommands,
  };
}
