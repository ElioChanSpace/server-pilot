import { useCallback, useEffect, useState } from "react";
import type { TransferRecord } from "../types/app";

const STORAGE_KEY = "server-pilot-transfer-history";
const MAX_RECORDS = 200;

let globalRecords: TransferRecord[] = loadFromStorage();
const listeners = new Set<() => void>();

function loadFromStorage(): TransferRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as TransferRecord[];
  } catch {
    return [];
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(globalRecords));
    } catch {
      // ignore quota errors
    }
    saveTimer = null;
  }, 300);
}

function notify() {
  listeners.forEach((l) => l());
}

export function useTransferHistory() {
  const [records, setRecords] = useState(globalRecords);

  useEffect(() => {
    const listener = () => setRecords([...globalRecords]);
    listeners.add(listener);
    // Sync in case records changed between render and effect
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const addRecord = useCallback((record: TransferRecord) => {
    globalRecords = [record, ...globalRecords].slice(0, MAX_RECORDS);
    scheduleSave();
    notify();
  }, []);

  const removeRecord = useCallback((id: string) => {
    globalRecords = globalRecords.filter((r) => r.id !== id);
    scheduleSave();
    notify();
  }, []);

  const removeRecords = useCallback((ids: Set<string>) => {
    globalRecords = globalRecords.filter((r) => !ids.has(r.id));
    scheduleSave();
    notify();
  }, []);

  const clearHistory = useCallback(() => {
    globalRecords = [];
    scheduleSave();
    notify();
  }, []);

  return { records, addRecord, removeRecord, removeRecords, clearHistory };
}
