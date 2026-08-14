import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FaTimes, FaSearch, FaSpinner, FaExclamationCircle, FaNetworkWired } from 'react-icons/fa';
import styles from './PortMonitorModal.module.css';

interface PortInfo {
  port: number;
  protocol: string;
  address: string;
  process: string;
  pid: number;
}

interface PortMonitorModalProps {
  serverId: string;
  serverName: string;
  onClose: () => void;
}

const WELL_KNOWN_PORTS: Record<number, string> = {
  20: 'FTP-Data', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP',
  111: 'RPCbind', 135: 'MS-RPC',
  53: 'DNS', 67: 'DHCP', 68: 'DHCP', 80: 'HTTP', 110: 'POP3',
  119: 'NNTP', 123: 'NTP', 143: 'IMAP', 161: 'SNMP', 194: 'IRC',
  389: 'LDAP', 443: 'HTTPS', 445: 'SMB', 139: 'NetBIOS', 465: 'SMTPS', 514: 'Syslog',
  587: 'SMTP', 631: 'CUPS', 636: 'LDAPS', 993: 'IMAPS', 995: 'POP3S',
  1080: 'SOCKS', 1433: 'MSSQL', 1521: 'Oracle', 2049: 'NFS',
  3000: 'Grafana', 3306: 'MySQL', 3389: 'RDP', 4369: 'EPMD',
  5000: 'Docker Registry', 5432: 'PostgreSQL', 5672: 'AMQP',
  5900: 'VNC', 6379: 'Redis', 6443: 'K8s API', 7001: 'WebLogic',
  7474: 'Neo4j HTTP', 7687: 'Neo4j Bolt', 8000: 'HTTP-Alt',
  8080: 'HTTP-Proxy', 8443: 'HTTPS-Alt', 8888: 'Jupyter',
  9000: 'Portainer', 9090: 'Prometheus', 9200: 'Elasticsearch',
  9300: 'ES-Transport', 11211: 'Memcached', 15672: 'RabbitMQ-Mgmt',
  27017: 'MongoDB', 27018: 'MongoDB',
};

export const PortMonitorModal: React.FC<PortMonitorModalProps> = ({ serverId, serverName, onClose }) => {
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const fetchPorts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<PortInfo[]>('fetch_server_ports', { id: serverId });
      setPorts(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void fetchPorts();
  }, [fetchPorts]);

  // Focus search on mount
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // ESC to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const filteredPorts = useMemo(() => {
    if (!search.trim()) return ports;
    const q = search.trim().toLowerCase();
    return ports.filter(p =>
      String(p.port).includes(q) ||
      p.process.toLowerCase().includes(q) ||
      p.address.toLowerCase().includes(q) ||
      (WELL_KNOWN_PORTS[p.port] || '').toLowerCase().includes(q)
    );
  }, [ports, search]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <FaNetworkWired size={14} />
            <span>端口监测</span>
            <span className={styles.serverName}>{serverName}</span>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.refreshBtn} onClick={() => void fetchPorts()} disabled={loading} title="刷新">
              {loading ? <FaSpinner size={12} className={styles.spin} /> : '刷新'}
            </button>
            <button type="button" className={styles.closeBtn} onClick={onClose}>
              <FaTimes size={13} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className={styles.searchBar}>
          <FaSearch size={11} className={styles.searchIcon} />
          <input
            ref={searchRef}
            className={styles.searchInput}
            placeholder="搜索端口号、进程名、地址..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { if (search) { e.stopPropagation(); setSearch(''); } else { onClose(); } } }}
          />
          {search && (
            <button type="button" className={styles.searchClear} onClick={() => setSearch('')}>
              <FaTimes size={9} />
            </button>
          )}
        </div>

        {/* Content */}
        <div className={styles.content}>
          {loading && ports.length === 0 ? (
            <div className={styles.state}>
              <FaSpinner size={24} className={styles.spin} />
              <p>正在获取端口信息...</p>
            </div>
          ) : error ? (
            <div className={styles.state}>
              <FaExclamationCircle size={24} className={styles.errorIcon} />
              <p className={styles.errorText}>{error}</p>
              <button type="button" className={styles.retryBtn} onClick={() => void fetchPorts()}>重试</button>
            </div>
          ) : filteredPorts.length === 0 ? (
            <div className={styles.state}>
              <FaNetworkWired size={24} className={styles.emptyIcon} />
              <p>{search ? '无匹配结果' : '无监听端口'}</p>
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.thPort}>端口</th>
                  <th className={styles.thProto}>协议</th>
                  <th className={styles.thAddr}>地址</th>
                  <th className={styles.thProc}>进程</th>
                  <th className={styles.thPid}>PID</th>
                </tr>
              </thead>
              <tbody>
                {filteredPorts.map((p, i) => (
                  <tr key={`${p.port}-${p.pid}-${i}`}>
                    <td className={styles.tdPort}>
                      {p.port}
                      {WELL_KNOWN_PORTS[p.port] && (
                        <span className={styles.portTag}>{WELL_KNOWN_PORTS[p.port]}</span>
                      )}
                    </td>
                    <td className={styles.tdProto}>{p.protocol}</td>
                    <td className={styles.tdAddr}>{p.address || '*'}</td>
                    <td className={styles.tdProc}>
                      {p.process.startsWith('docker:') ? (
                        <span className={styles.dockerTag} title={p.process}>
                          🐳 {p.process.slice(7)}
                        </span>
                      ) : (
                        p.process || '—'
                      )}
                    </td>
                    <td className={styles.tdPid}>{p.pid || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        {!loading && !error && (
          <div className={styles.footer}>
            {search
              ? `匹配 ${filteredPorts.length} / ${ports.length} 个端口`
              : `共 ${ports.length} 个监听端口`}
          </div>
        )}
      </div>
    </div>
  );
};
