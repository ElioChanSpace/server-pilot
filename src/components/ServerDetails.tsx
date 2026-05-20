import React from 'react';
import { Server } from '../context/ServerContext';
import { FaServer, FaNetworkWired, FaUser, FaLock, FaDatabase, FaInfoCircle } from 'react-icons/fa';
import styles from './ServerDetails.module.css';

interface ServerDetailsProps {
  server: Server | null;
}

const ServerDetails: React.FC<ServerDetailsProps> = ({ server }) => {
  if (!server) {
    return (
      <div className={styles.container}>
        <div className={styles.placeholder}>
          <FaInfoCircle className={styles.placeholderIcon} />
          <p>Select a server to view details</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <FaServer className={styles.headerIcon} />
        <h2>{server.name}</h2>
      </div>

      <div className={styles.detailsGrid}>
        <div className={styles.detailItem}>
          <FaNetworkWired className={styles.detailIcon} />
          <div>
            <div className={styles.detailLabel}>Host</div>
            <div className={styles.detailValue}>{server.host}</div>
          </div>
        </div>

        <div className={styles.detailItem}>
          <FaNetworkWired className={styles.detailIcon} />
          <div>
            <div className={styles.detailLabel}>Port</div>
            <div className={styles.detailValue}>{server.port}</div>
          </div>
        </div>

        <div className={styles.detailItem}>
          <FaUser className={styles.detailIcon} />
          <div>
            <div className={styles.detailLabel}>Username</div>
            <div className={styles.detailValue}>{server.username}</div>
          </div>
        </div>

        <div className={styles.detailItem}>
          <FaDatabase className={styles.detailIcon} />
          <div>
            <div className={styles.detailLabel}>OS Type</div>
            <div className={styles.detailValue}>
              {server.os_type === 'Linux' ? 'Linux' : 'Windows'}
            </div>
          </div>
        </div>

        <div className={styles.detailItem}>
          <FaInfoCircle className={styles.detailIcon} />
          <div>
            <div className={styles.detailLabel}>Status</div>
            <div className={styles.detailValue}>
              <span className={styles.statusBadge} data-status={server.status}>
                {server.status}
              </span>
            </div>
          </div>
        </div>

        {server.category_id && (
          <div className={styles.detailItem}>
            <FaFolder className={styles.detailIcon} />
            <div>
              <div className={styles.detailLabel}>Category</div>
              <div className={styles.detailValue}>Unknown</div>
            </div>
          </div>
        )}
      </div>

      {server.password && (
        <div className={styles.passwordSection}>
          <div className={styles.passwordLabel}>Password</div>
          <div className={styles.passwordValue}>••••••••</div>
        </div>
      )}
    </div>
  );
};

export default ServerDetails;
