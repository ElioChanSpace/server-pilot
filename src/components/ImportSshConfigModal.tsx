import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useServer, OsType } from '../context/ServerContext';
import styles from './Modal.module.css';

interface SshConfigHost {
  host: string;
  hostName: string;
  user?: string;
  port?: number;
  identityFile?: string;
  proxyJump?: string;
}

interface ImportSshConfigModalProps {
  onClose: () => void;
}

export const ImportSshConfigModal: React.FC<ImportSshConfigModalProps> = ({ onClose }) => {
  const { addServer, refreshServers, servers } = useServer();
  const existingKeysRef = useRef<Set<string>>(
    new Set(servers.map(server => `${server.host}:${server.port}`)),
  );
  const [path, setPath] = useState('');
  const [candidates, setCandidates] = useState<SshConfigHost[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (configPath?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const hosts = await invoke<SshConfigHost[]>('parse_ssh_config', {
        path: configPath?.trim() || null,
      });
      const fresh = hosts.filter(
        host => !existingKeysRef.current.has(`${host.hostName}:${host.port ?? 22}`),
      );
      setCandidates(fresh);
      setSelected(new Set(fresh.map(host => host.host)));
    } catch (err) {
      setError(typeof err === 'string' ? err : '解析 SSH config 失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleCandidate = (host: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(host)) {
        next.delete(host);
      } else {
        next.add(host);
      }
      return next;
    });
  };

  const handleImport = async () => {
    const targets = candidates.filter(candidate => selected.has(candidate.host));
    if (targets.length === 0) {
      return;
    }

    setIsImporting(true);
    setError(null);
    try {
      for (const target of targets) {
        await addServer({
          name: target.host,
          host: target.hostName,
          port: target.port ?? 22,
          username: target.user ?? 'root',
          osType: OsType.Linux,
          authMethod: target.identityFile ? 'key' : 'password',
          keyPath: target.identityFile,
          proxyJump: target.proxyJump,
          categoryId: undefined,
        });
      }
      await refreshServers();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.content}>
        <h2 className={styles.title}>从 SSH Config 导入</h2>

        <div className={styles.formGroup}>
          <label className={styles.formLabel}>配置文件路径</label>
          <div className={styles.keyRow}>
            <input
              type="text"
              value={path}
              onChange={event => setPath(event.target.value)}
              placeholder="默认 ~/.ssh/config"
            />
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void load(path)}
              disabled={isLoading}
            >
              解析
            </button>
          </div>
        </div>

        {error && <div className={styles.formError}>{error}</div>}

        {isLoading ? (
          <p className={styles.helpText}>正在解析 SSH config...</p>
        ) : candidates.length === 0 ? (
          <p className={styles.helpText}>未发现可导入的主机（已存在的服务器会自动跳过）。</p>
        ) : (
          <div className={styles.candidateList}>
            {candidates.map(candidate => (
              <label key={candidate.host} className={styles.candidateRow}>
                <input
                  type="checkbox"
                  checked={selected.has(candidate.host)}
                  onChange={() => toggleCandidate(candidate.host)}
                />
                <span className={styles.candidateName}>{candidate.host}</span>
                <span className={styles.candidateMeta}>
                  {candidate.user ?? 'root'}@{candidate.hostName}:{candidate.port ?? 22}
                  {candidate.proxyJump ? ` · via ${candidate.proxyJump}` : ''}
                </span>
              </label>
            ))}
          </div>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={isImporting || selected.size === 0}
          >
            {isImporting ? '导入中...' : `导入 ${selected.size} 台`}
          </button>
        </div>
      </div>
    </div>
  );
};
