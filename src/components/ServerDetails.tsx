import React from 'react';
import { Server } from '../context/ServerContext';
import { FaPlug, FaServer, FaUnlink } from 'react-icons/fa';
import { useServer } from '../context/ServerContext';
import ServerMonitoringPanel from './ServerMonitoringPanel';
import styles from './ServerDetails.module.css';

interface ServerDetailsProps {
  server: Server;
  onConnectServer: (server: Server) => void;
  onDisconnectServer: (server: Server) => void;
  connectionError: string | null;
  onDismissError: () => void;
}

type ServerDetailsTab = 'overview' | 'monitoring';

const ServerDetails: React.FC<ServerDetailsProps> = ({
  server,
  onConnectServer,
  onDisconnectServer,
  connectionError,
  onDismissError,
}) => {
  const { categories } = useServer();
  const [activeTab, setActiveTab] = React.useState<ServerDetailsTab>('overview');
  const category = categories.find(item => item.id === server.categoryId);
  const isConnected = server.status === 'connected';
  const isConnecting = server.status === 'connecting';
  const isLinux = server.osType === 'linux';
  const primaryActionLabel = isConnected ? '打开终端' : isConnecting ? '查看连接中' : '连接服务器';
  const statusText = isConnected ? '已连接，可直接进入终端操作。' : isConnecting ? '连接正在建立，请稍候。' : '当前未连接，适合先检查主机和账号信息。';
  const protocolLabel = isLinux ? 'SSH' : 'Remote Desktop';
  const credentialStatus = server.password ? '已保存密码' : '未保存密码';

  React.useEffect(() => {
    setActiveTab('overview');
  }, [server.id]);

  return (
    <div className={styles.container}>
      <div className={styles.hero}>
        <div className={styles.heroBadge}>
          <FaServer className={styles.headerIcon} />
        </div>
        <div className={styles.heroText}>
          <p className={styles.heroEyebrow}>服务器详情</p>
          <div className={styles.titleRow}>
            <h2>{server.name}</h2>
            <span className={styles.statusBadge} data-status={server.status}>
              {server.status}
            </span>
          </div>
          <p className={styles.heroMeta}>{server.host}:{server.port}</p>
          <p className={styles.heroDescription}>{statusText}</p>
        </div>
      </div>

      <div className={styles.actionRow}>
        <button type="button" className={styles.primaryButton} onClick={() => onConnectServer(server)}>
          <FaPlug />
          <span>{primaryActionLabel}</span>
        </button>
        {(isConnected || isConnecting) && (
          <button type="button" className={styles.secondaryButton} onClick={() => onDisconnectServer(server)}>
            <FaUnlink />
            <span>断开连接</span>
          </button>
        )}
      </div>

      {connectionError && (
        <div className={styles.inlineError}>
          <div>
            <p className={styles.inlineErrorTitle}>最近一次连接失败</p>
            <p className={styles.inlineErrorMessage}>{connectionError}</p>
          </div>
          <button type="button" className={styles.inlineErrorClose} onClick={onDismissError}>
            关闭
          </button>
        </div>
      )}

      <div className={styles.tabBar} role="tablist" aria-label="服务器功能标签">
        <button
          type="button"
          className={styles.tabButton}
          data-active={activeTab === 'overview'}
          onClick={() => setActiveTab('overview')}
        >
          概览
        </button>
        <button
          type="button"
          className={styles.tabButton}
          data-active={activeTab === 'monitoring'}
          onClick={() => setActiveTab('monitoring')}
        >
          监控
        </button>
      </div>

      <div className={styles.tabPanel}>
        {activeTab === 'overview' && (
          <>
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3>基础信息</h3>
                <span className={styles.sectionMeta}>Overview</span>
              </div>
              <div className={styles.tableCard}>
                <table className={styles.infoTable}>
                  <tbody>
                    <tr>
                      <th>服务器名称</th>
                      <td>{server.name}</td>
                    </tr>
                    <tr>
                      <th>所属分组</th>
                      <td>{category?.name ?? '未分类'}</td>
                    </tr>
                    <tr>
                      <th>系统类型</th>
                      <td>{isLinux ? 'Linux' : 'Windows'}</td>
                    </tr>
                    <tr>
                      <th>状态说明</th>
                      <td>{statusText}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3>连接信息</h3>
                <span className={styles.sectionMeta}>{protocolLabel}</span>
              </div>
              <div className={styles.tableCard}>
                <table className={styles.infoTable}>
                  <tbody>
                    <tr>
                      <th>访问地址</th>
                      <td>{server.host}</td>
                    </tr>
                    <tr>
                      <th>连接端口</th>
                      <td>{server.port}</td>
                    </tr>
                    <tr>
                      <th>登录账号</th>
                      <td>{server.username}</td>
                    </tr>
                    <tr>
                      <th>连接协议</th>
                      <td>{protocolLabel}</td>
                    </tr>
                    <tr>
                      <th>Endpoint</th>
                      <td>{server.username}@{server.host}:{server.port}</td>
                    </tr>
                    <tr>
                      <th>连接状态</th>
                      <td>
                        <span className={styles.endpointStatus} data-status={server.status}>
                          {server.status}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3>凭据与传输</h3>
                <span className={styles.sectionMeta}>Access</span>
              </div>
              <div className={styles.tableCard}>
                <table className={styles.infoTable}>
                  <tbody>
                    <tr>
                      <th>凭据状态</th>
                      <td>{credentialStatus}</td>
                    </tr>
                    <tr>
                      <th>密码展示</th>
                      <td>{server.password ? '••••••••' : '未保存'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {activeTab === 'monitoring' && <ServerMonitoringPanel server={server} />}
      </div>
    </div>
  );
};


export default ServerDetails;
