import React from 'react';
import { Server } from '../context/ServerContext';
import styles from './RightSidebar.module.css';

interface RightSidebarProps {
  isOpen: boolean;
  activeServer: Server | null;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({ isOpen, activeServer }) => {
  return (
    <div className={styles.rightSidebar} data-closed={!isOpen}>
      <div className={styles.content}>
        {isOpen && activeServer && (
          <div>
            <h3>{activeServer.name}</h3>
            <p>Status: {activeServer.status}</p>
            <p>Host: {activeServer.host}</p>
            <p>OS: {activeServer.osType}</p>
          </div>
        )}
        {isOpen && !activeServer && (
          <p>No server selected.</p>
        )}
      </div>
    </div>
  );
};