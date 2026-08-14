import { useCallback, useMemo, useState } from "react";
import {
  FaArrowDown,
  FaArrowUp,
  FaSearch,
  FaTimes,
  FaTrash,
} from "react-icons/fa";
import type { TransferRecord } from "../types/app";
import { formatBytes, formatDuration, formatSpeed } from "../utils/format";
import styles from "./TransferHistoryModal.module.css";

interface TransferHistoryModalProps {
  open: boolean;
  onClose: () => void;
  records: TransferRecord[];
  onRemove: (id: string) => void;
  onRemoveBatch: (ids: Set<string>) => void;
  onClear: () => void;
}

export function TransferHistoryModal({
  open,
  onClose,
  records,
  onRemove,
  onRemoveBatch,
  onClear,
}: TransferHistoryModalProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!search.trim()) return records;
    const q = search.toLowerCase();
    return records.filter(
      (r) =>
        r.fileName.toLowerCase().includes(q) ||
        r.serverName.toLowerCase().includes(q)
    );
  }, [records, search]);

  // Keep selection in sync with filtered results
  const validSelected = useMemo(() => {
    const ids = new Set(filtered.map((r) => r.id));
    const next = new Set<string>();
    selected.forEach((id) => { if (ids.has(id)) next.add(id); });
    return next;
  }, [selected, filtered]);

  const allSelected = filtered.length > 0 && validSelected.size === filtered.length;
  const someSelected = validSelected.size > 0 && !allSelected;

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((r) => r.id)));
    }
  }, [allSelected, filtered]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (validSelected.size === 0) return;
    onRemoveBatch(validSelected);
    setSelected(new Set());
  }, [validSelected, onRemoveBatch]);

  const handleDeleteSingle = useCallback(
    (id: string) => {
      onRemove(id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [onRemove]
  );

  const handleClear = useCallback(() => {
    if (records.length === 0) return;
    onClear();
    setSelected(new Set());
  }, [records.length, onClear]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.title}>传输历史</span>
            <span className={styles.count}>{records.length} 条记录</span>
            {validSelected.size > 0 && (
              <span className={styles.selectedCount}>
                已选 {validSelected.size} 项
              </span>
            )}
          </div>
          <div className={styles.headerRight}>
            {validSelected.size > 0 && (
              <button
                className={styles.deleteSelectedBtn}
                onClick={handleDeleteSelected}
                title="删除所选"
              >
                <FaTrash size={12} />
                <span>删除所选 ({validSelected.size})</span>
              </button>
            )}
            <button
              className={styles.clearBtn}
              onClick={handleClear}
              disabled={records.length === 0}
              title="清空历史"
            >
              <FaTrash size={12} />
            </button>
            <button className={styles.closeBtn} onClick={onClose} title="关闭">
              <FaTimes size={14} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className={styles.searchBar}>
          <FaSearch size={12} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="搜索文件名或服务器..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              className={styles.searchClear}
              onClick={() => setSearch("")}
            >
              <FaTimes size={10} />
            </button>
          )}
        </div>

        {/* Table */}
        <div className={styles.tableWrapper}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>
              {records.length === 0 ? "暂无传输记录" : "没有匹配的记录"}
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.checkCell}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected; }}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th>文件</th>
                  <th>方向</th>
                  <th>大小</th>
                  <th>平均速度</th>
                  <th>耗时</th>
                  <th>状态</th>
                  <th>完成时间</th>
                  <th className={styles.actionCell}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((record) => (
                  <tr
                    key={record.id}
                    data-selected={validSelected.has(record.id)}
                  >
                    <td className={styles.checkCell}>
                      <input
                        type="checkbox"
                        checked={validSelected.has(record.id)}
                        onChange={() => toggleSelect(record.id)}
                      />
                    </td>
                    <td className={styles.fileNameCell}>
                      <div className={styles.fileName} title={record.fileName}>
                        {record.fileName}
                      </div>
                      <div className={styles.serverName}>
                        {record.serverName}
                      </div>
                    </td>
                    <td>
                      {record.direction === "upload" ? (
                        <span className={styles.dirUp}>
                          <FaArrowUp size={10} /> 上传
                        </span>
                      ) : (
                        <span className={styles.dirDown}>
                          <FaArrowDown size={10} /> 下载
                        </span>
                      )}
                    </td>
                    <td className={styles.mono}>
                      {formatBytes(record.totalBytes)}
                    </td>
                    <td className={styles.mono}>
                      {record.averageSpeed > 0
                        ? formatSpeed(record.averageSpeed)
                        : "-"}
                    </td>
                    <td className={styles.mono}>
                      {record.duration > 0
                        ? formatDuration(record.duration)
                        : "-"}
                    </td>
                    <td>
                      {record.status === "completed" ? (
                        <span className={styles.statusOk}>完成</span>
                      ) : (
                        <span className={styles.statusErr} title={record.error}>
                          失败
                        </span>
                      )}
                    </td>
                    <td className={styles.timeCell}>
                      {formatTime(record.completedAt)}
                    </td>
                    <td className={styles.actionCell}>
                      <button
                        className={styles.rowDeleteBtn}
                        onClick={() => handleDeleteSingle(record.id)}
                        title="删除"
                      >
                        <FaTimes size={10} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  if (!ts) return "-";
  const d = new Date(ts);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (isToday) return `今天 ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return `昨天 ${time}`;

  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
