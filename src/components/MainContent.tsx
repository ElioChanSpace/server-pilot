import React from 'react';
import { Category, Server, useServer } from '../context/ServerContext';
import { CategoryDashboard } from './CategoryDashboard';
import { Settings } from './Settings';
import { ConsoleView } from './ConsoleView';

interface MainContentProps {
  activeView: "dashboard" | "settings";
  activeCategory: Category | null;
  connectingServer: Server | null;
}

export const MainContent: React.FC<MainContentProps> = ({ activeView, activeCategory, connectingServer }) => {
  const { servers, categories } = useServer();

  if (activeView === 'settings') {
    return <Settings />;
  }

  if (connectingServer) {
    return (
      <main style={{ flex: 1, overflowY: 'auto' }}>
        <ConsoleView server={connectingServer} />
      </main>
    );
  }

  return (
    <main style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
      <CategoryDashboard category={activeCategory} servers={servers} allCategories={categories} />
    </main>
  );
};