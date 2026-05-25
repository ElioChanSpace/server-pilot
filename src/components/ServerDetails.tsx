import React from 'react';
import { Server } from '../context/ServerContext';
import { FaDatabase, FaFolder, FaNetworkWired, FaPlug, FaServer, FaShieldAlt, FaUnlink, FaUser } from 'react-icons/fa';
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

const ServerDetails: React.FC<ServerDetailsProps> = ({
  server,
  onConnectServer,
  onDisconnectServer,
  connectionError,
  onDismissError,
}) => {
  const { categories } = useServer();
  const category = categories.find(item => item.id === server.categoryId);
  const isConnected = server.status === 'connected';
  const isConnecting = server.status === 'connecting';
  const primaryActionLabel = isConnected ? '打开终端' : isConnecting ? '查看连接中' : '连接服务器';
  const statusText = isConnected ? '已连接，可直接进入终端操作。' : isConnecting ? '连接正在建立，请稍候。' : '当前未连接，适合先检查主机和账号信息。';

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

      <div className={styles.detailsGrid}>
        <div className={styles.detailItem}>
          <FaNetworkWired className={styles.detailIcon} />
          <div>
            <div className={styles.detailLabel}>访问地址</div>
            <div className={styles.detailValue}>{server.host}</div>
            <div className={styles.detailHint}>主机地址或域名</div>
          </div>
        </div>

        <div className={styles.detailItem}>
          <FaNetworkWired className={styles.detailIcon} />
          <div>
            <div className={styles.detailLabel}>连接端口</div>
            <div className={styles.detailValue}>{server.port}</div>
            <div className={styles.detailHint}>{server.osType === 'windows' ? '默认远程桌面端口' : '默认 SSH 端口'}</div>
          </div>
        </div>

        <div className={styles.detailItem}>
          <FaUser className={styles.detailIcon} />
          <div>
            <div className={styles.detailLabel}>登录账号</div>
            <div className={styles.detailValue}>{server.username}</div>
            <div className={styles.detailHint}>终端连接默认使用此账号</div>
          </div>
        </div>

        <div className={styles.detailItem}>
          <FaDatabase className={styles.detailIcon} />
          <div>
            <div className={styles.detailLabel}>系统类型</div>
            <div className={styles.detailValue}>
              {server.osType === 'linux' ? 'Linux' : 'Windows'}
            </div>
            <div className={styles.detailHint}>{server.osType === 'linux' ? '偏向命令行维护' : '偏向图形化远程管理'}</div>
          </div>
        </div>

        <div className={styles.detailItem}>
          <FaFolder className={styles.detailIcon} />
          <div>
            <div className={styles.detailLabel}>所属分组</div>
            <div className={styles.detailValue}>{category?.name ?? '未分类'}</div>
            <div className={styles.detailHint}>用于树结构整理和批量查看</div>
          </div>
        </div>

        <div className={styles.detailItem}>
          <FaShieldAlt className={styles.detailIcon} />
          <div>
            <div className={styles.detailLabel}>凭据状态</div>
            <div className={styles.detailValue}>{server.password ? '已保存密码' : '未保存密码'}</div>
            <div className={styles.detailHint}>{server.password ? '连接时可直接复用' : '建议补充凭据避免重复输入'}</div>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>连接摘要</h3>
          <span className={styles.sectionMeta}>{server.osType === 'linux' ? 'SSH' : 'Remote Desktop'}</span>
        </div>
        <div className={styles.endpointCard}>
          <div>
            <div className={styles.detailLabel}>Endpoint</div>
            <div className={styles.endpointValue}>{server.username}@{server.host}:{server.port}</div>
          </div>
          <div className={styles.endpointStatus} data-status={server.status}>
            {server.status}
          </div>
        </div>
      </div>

      <ServerMonitoringPanel server={server} />

      {server.password && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3>安全信息</h3>
            <span className={styles.sectionMeta}>已隐藏</span>
          </div>
          <div className={styles.passwordSection}>
            <div className={styles.passwordLabel}>密码占位</div>
            <div className={styles.passwordValue}>••••••••</div>
          </div>
        </div>
      )}
    </div>
  );
};


export default ServerDetails;
