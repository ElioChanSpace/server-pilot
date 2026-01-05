import React from 'react';
import { Server, Category, useServer } from '../context/ServerContext';
import { FaCircle, FaTerminal } from 'react-icons/fa';
import styles from './ServerList.module.css';

interface ServerListProps {
  servers: Server[];
  categories: Category[];
}

export const ServerList: React.FC<ServerListProps> = ({ servers, categories }) => {
  const { connectToServer } = useServer();

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return '#4caf50';
      case 'connecting': return '#ff9800';
      default: return '#f44336';
    }
  };

  const uncategorizedServers = servers.filter(s => !s.category_id);

  return (
    <div className={styles.list}>
      {categories.map(category => {
        const categoryServers = servers.filter(s => s.category_id === category.id);
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
                  statusColor={getStatusColor(server.status)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {uncategorizedServers.length > 0 && (
        <div className={styles.categoryGroup}>
          <h3 className={styles.categoryTitle}>Uncategorized</h3>
          <div className={styles.grid}>
            {uncategorizedServers.map(server => (
              <ServerCard 
                key={server.id} 
                server={server} 
                onConnect={() => connectToServer(server.id)}
                statusColor={getStatusColor(server.status)}
              />
            ))}
          </div>
        </div>
      )}
      
      {servers.length === 0 && (
        <div className={styles.emptyState}>
          No servers added yet. Click "New Server" to get started.
        </div>
      )}
    </div>
  );
};

const ServerCard = ({ server, onConnect, statusColor }: { server: Server, onConnect: () => void, statusColor: string }) => (
  <div className={styles.card}>
    <div className={styles.cardHeader}>
      <div className={styles.statusIndicator} style={{ color: statusColor }}>
        <FaCircle size={10} />
        <span>{server.status}</span>
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