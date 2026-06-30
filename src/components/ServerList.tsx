import React from 'react';
import { Server, Category, useServer } from '../context/ServerContext';
import { FaTerminal } from 'react-icons/fa';
import { formatServerStatus, getServerStatusMeta } from '../utils/serverStatus';
import styles from './ServerList.module.css';

interface ServerListProps {
  servers: Server[];
  categories: Category[];
}

export const ServerList: React.FC<ServerListProps> = ({ servers, categories }) => {
  const { connectToServer } = useServer();

  const uncategorizedServers = servers.filter(s => !s.categoryId);

  return (
    <div className={styles.list}>
      {categories.map(category => {
        const categoryServers = servers.filter(s => s.categoryId === category.id);
        if (categoryServers.length === 0) return null;
        
        return (
          <div key={category.id} className={styles.categoryGroup}>
            <h3 className={styles.categoryTitle}>{category.name}</h3>
            <div className={styles.grid}>
              {categoryServers.map(server => (
                <ServerCard 
                  key={server.id} 
                  server={server} 
                  onConnect={() => connectToServer(server.id)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {uncategorizedServers.length > 0 && (
        <div className={styles.categoryGroup}>
          <h3 className={styles.categoryTitle}>未分类</h3>
          <div className={styles.grid}>
            {uncategorizedServers.map(server => (
              <ServerCard 
                key={server.id} 
                server={server} 
                onConnect={() => connectToServer(server.id)}
              />
            ))}
          </div>
        </div>
      )}
      
      {servers.length === 0 && (
        <div className={styles.emptyState}>
          还没有添加任何服务器，点击“新建服务器”即可开始。
        </div>
      )}
    </div>
  );
};

const ServerCard = ({ server, onConnect }: { server: Server, onConnect: () => void }) => {
  const statusMeta = getServerStatusMeta(server.status);
  const StatusIcon = statusMeta.icon;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.statusIndicator} style={{ color: statusMeta.color }}>
          <StatusIcon size={12} className={statusMeta.spinning ? styles.statusSpinning : undefined} />
          <span>{formatServerStatus(server.status)}</span>
        </div>
        <button className={styles.connectBtn} onClick={onConnect} disabled={server.status === 'connected'}>
          <FaTerminal />
        </button>
      </div>
      <div className={styles.cardBody}>
        <h4>{server.name}</h4>
        <p>{server.username}@{server.host}:{server.port}</p>
      </div>
    </div>
  );
};
