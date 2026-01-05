import React from 'react';
import { useServer } from '../context/ServerContext';
import { ServerList } from './ServerList';
import styles from './Dashboard.module.css';

export const Dashboard: React.FC = () => {
  const { servers, categories } = useServer();

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <h1>Servers</h1>
      </header>
      
      <div className={styles.content}>
        <ServerList servers={servers} categories={categories} />
      </div>
    </div>
  );
};