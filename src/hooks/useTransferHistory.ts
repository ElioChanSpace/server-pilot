import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TransferRecord } from "../types/app";

const LEGACY_STORAGE_KEY = "server-pilot-transfer-history";
const MAX_RECORDS = 200;

function loadLegacyRecords(): TransferRecord[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const records = JSON.parse(raw);
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

export function useTransferHistory() {
  const [records, setRecords] = useState<TransferRecord[]>([]);
  const recordsRef = useRef<TransferRecord[]>([]);
  const mountedRef = useRef(true);

  const setRecordState = useCallback((next: TransferRecord[]) => {
    recordsRef.current = next;
    setRecords(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    const load = async () => {
      try {
        let loaded = await invoke<TransferRecord[]>("get_transfer_history");
        const legacyRecords = loadLegacyRecords();
        if (loaded.length === 0 && legacyRecords.length > 0) {
          loaded = await invoke<TransferRecord[]>("replace_transfer_history", {
            records: legacyRecords,
          });
          window.localStorage.removeItem(LEGACY_STORAGE_KEY);
        }
        if (mountedRef.current) {
          setRecordState(loaded);
        }
      } catch (error) {
        console.error("加载传输历史失败:", error);
      }
    };

    void load();

    return () => {
      mountedRef.current = false;
    };
  }, [setRecordState]);

  const addRecord = useCallback(async (record: TransferRecord) => {
    try {
      const saved = await invoke<TransferRecord>("add_transfer_history", { record });
      const next = [saved, ...recordsRef.current].slice(0, MAX_RECORDS);
      setRecordState(next);
    } catch (error) {
      console.error("保存传输历史失败:", error);
      const next = [record, ...recordsRef.current].slice(0, MAX_RECORDS);
      setRecordState(next);
    }
  }, [setRecordState]);

  const removeRecord = useCallback(async (id: string) => {
    const previous = recordsRef.current;
    setRecordState(previous.filter((r) => r.id !== id));
    try {
      await invoke("remove_transfer_history", { id });
    } catch (error) {
      console.error("删除传输历史失败:", error);
      setRecordState(previous);
    }
  }, [setRecordState]);

  const removeRecords = useCallback(async (ids: Set<string>) => {
    const previous = recordsRef.current;
    setRecordState(previous.filter((r) => !ids.has(r.id)));
    try {
      await invoke("remove_transfer_history_batch", { ids: Array.from(ids) });
    } catch (error) {
      console.error("批量删除传输历史失败:", error);
      setRecordState(previous);
    }
  }, [setRecordState]);

  const clearHistory = useCallback(async () => {
    const previous = recordsRef.current;
    setRecordState([]);
    try {
      await invoke("clear_transfer_history");
    } catch (error) {
      console.error("清空传输历史失败:", error);
      setRecordState(previous);
    }
  }, [setRecordState]);

  return { records, addRecord, removeRecord, removeRecords, clearHistory };
}
