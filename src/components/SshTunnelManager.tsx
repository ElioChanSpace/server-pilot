import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FaNetworkWired, FaPlus, FaTrash, FaSync } from "react-icons/fa";
import { Server } from "../context/ServerContext";
import styles from "./SshTunnelManager.module.css";

interface SshTunnel {
  id: string;
  serverId: string;
  tunnelType: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  status: string;
  pid?: number;
}

interface SshTunnelManagerProps {
  server: Server;
  onClose: () => void;
}

export const SshTunnelManager: React.FC<SshTunnelManagerProps> = ({ server, onClose }) => {
  const [tunnels, setTunnels] = useState<SshTunnel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Form state
  const [tunnelType, setTunnelType] = useState("local");
  const [localPort, setLocalPort] = useState("8080");
  const [remoteHost, setRemoteHost] = useState("localhost");
  const [remotePort, setRemotePort] = useState("80");

  const loadTunnels = useCallback(async () => {
    setLoading(true);
    try {
      const activeIds = await invoke<string[]>("list_ssh_tunnels");
      // We only track active tunnel IDs from the backend
      // For now, we'll just show active tunnels
      setTunnels(prev => prev.filter(t => activeIds.includes(t.id)));
    } catch (err) {
      console.error("Failed to load tunnels:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTunnels();
  }, [loadTunnels]);

  // Listen for tunnel status changes
  useEffect(() => {
    const unlisten = listen<SshTunnel>("ssh-tunnel-changed", (event) => {
      const updatedTunnel = event.payload;
      setTunnels(prev => {
        const index = prev.findIndex(t => t.id === updatedTunnel.id);
        if (index >= 0) {
          if (updatedTunnel.status === "inactive") {
            return prev.filter(t => t.id !== updatedTunnel.id);
          }
          const newTunnels = [...prev];
          newTunnels[index] = updatedTunnel;
          return newTunnels;
        } else if (updatedTunnel.status === "active") {
          return [...prev, updatedTunnel];
        }
        return prev;
      });
    });

    return () => {
      void unlisten.then(fn => fn());
    };
  }, []);

  const handleCreate = async () => {
    setError(null);

    const localPortNum = parseInt(localPort, 10);
    const remotePortNum = parseInt(remotePort, 10);

    if (isNaN(localPortNum) || localPortNum < 1 || localPortNum > 65535) {
      setError("本地端口无效，范围 1-65535");
      return;
    }

    if (isNaN(remotePortNum) || remotePortNum < 1 || remotePortNum > 65535) {
      setError("远程端口无效，范围 1-65535");
      return;
    }

    if (!remoteHost.trim()) {
      setError("请输入远程主机");
      return;
    }

    // Check if local port is available
    try {
      const available = await invoke<boolean>("check_port_available", { port: localPortNum });
      if (!available) {
        setError(`本地端口 ${localPortNum} 已被占用`);
        return;
      }
    } catch (err) {
      console.error("Failed to check port:", err);
    }

    try {
      const tunnel = await invoke<SshTunnel>("create_ssh_tunnel", {
        request: {
          serverId: server.id,
          tunnelType,
          localPort: localPortNum,
          remoteHost: remoteHost.trim(),
          remotePort: remotePortNum,
        },
      });

      setTunnels(prev => [...prev, tunnel]);
      setShowCreateForm(false);
      setLocalPort("8080");
      setRemoteHost("localhost");
      setRemotePort("80");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleClose = async (tunnelId: string) => {
    try {
      await invoke("close_ssh_tunnel", { tunnelId });
      setTunnels(prev => prev.filter(t => t.id !== tunnelId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.content}>
        <div className={styles.header}>
          <h2>
            <FaNetworkWired className={styles.headerIcon} />
            SSH 隧道管理
          </h2>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </div>

        <div className={styles.serverInfo}>
          <span className={styles.label}>服务器:</span>
          <span className={styles.value}>{server.name} ({server.host})</span>
        </div>

        <div className={styles.body}>
          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.toolbar}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setShowCreateForm(!showCreateForm)}
            >
              <FaPlus />
              <span>创建隧道</span>
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void loadTunnels()}
              disabled={loading}
            >
              <FaSync />
              <span>刷新</span>
            </button>
          </div>

          {showCreateForm && (
            <div className={styles.createForm}>
              <h3>创建新隧道</h3>
              <div className={styles.formGroup}>
                <label>隧道类型</label>
                <select value={tunnelType} onChange={e => setTunnelType(e.target.value)}>
                  <option value="local">本地转发 (-L)</option>
                  <option value="remote">远程转发 (-R)</option>
                </select>
                <span className={styles.helper}>
                  {tunnelType === "local"
                    ? "本地转发: 访问本地端口 → 转发到远程主机"
                    : "远程转发: 远程服务器端口 → 转发到本地主机"}
                </span>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>本地端口</label>
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    value={localPort}
                    onChange={e => setLocalPort(e.target.value)}
                    placeholder="8080"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>远程主机</label>
                  <input
                    type="text"
                    value={remoteHost}
                    onChange={e => setRemoteHost(e.target.value)}
                    placeholder="localhost"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>远程端口</label>
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    value={remotePort}
                    onChange={e => setRemotePort(e.target.value)}
                    placeholder="80"
                  />
                </div>
              </div>
              <div className={styles.formActions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void handleCreate()}
                >
                  创建
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => setShowCreateForm(false)}
                >
                  取消
                </button>
              </div>
            </div>
          )}

          <div className={styles.tunnelList}>
            <h3>活跃隧道</h3>
            {tunnels.length === 0 ? (
              <div className={styles.empty}>暂无活跃隧道</div>
            ) : (
              tunnels.map(tunnel => (
                <div key={tunnel.id} className={styles.tunnelItem}>
                  <div className={styles.tunnelHeader}>
                    <FaNetworkWired className={styles.tunnelIcon} />
                    <div className={styles.tunnelInfo}>
                      <span className={styles.tunnelType}>
                        {tunnel.tunnelType === "local" ? "本地转发" : "远程转发"}
                      </span>
                      <span className={styles.tunnelAddress}>
                        {tunnel.tunnelType === "local" ? (
                          <>
                            localhost:{tunnel.localPort} → {tunnel.remoteHost}:{tunnel.remotePort}
                          </>
                        ) : (
                          <>
                            {tunnel.remoteHost}:{tunnel.remotePort} → localhost:{tunnel.localPort}
                          </>
                        )}
                      </span>
                    </div>
                    <span className={styles.tunnelStatus} data-status={tunnel.status}>
                      {tunnel.status === "active" ? "活跃" : "非活跃"}
                    </span>
                    <button
                      type="button"
                      className={styles.closeTunnelButton}
                      onClick={() => void handleClose(tunnel.id)}
                      title="关闭隧道"
                    >
                      <FaTrash />
                    </button>
                  </div>
                  {tunnel.pid && (
                    <div className={styles.tunnelMeta}>
                      <span className={styles.label}>PID:</span>
                      <span className={styles.value}>{tunnel.pid}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
