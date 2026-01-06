import React, { useState, useMemo } from 'react';
import { useServer, Server, Category } from '../context/ServerContext';
import { FaFolder, FaFolderOpen, FaChevronRight, FaChevronDown } from 'react-icons/fa';
import { useClick } from '../hooks/useClick';
import treeStyles from './TreeView.module.css';
import sidebarStyles from './LeftSidebar.module.css';

// ServerNode component for displaying a single server
const ServerNode: React.FC<{
  server: Server;
  activeServer: Server | null;
  onSelectServer: (server: Server) => void;
  onDoubleClickServer: (server: Server) => void; // <-- FIX: Accept the double-click handler
}> = ({ server, activeServer, onSelectServer, onDoubleClickServer }) => {
  const handleServerClick = useClick(
    () => onSelectServer(server),
    () => onDoubleClickServer(server) // <-- FIX: Use the prop for double-click
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return '#4caf50';
      case 'connecting': return '#ff9800';
      default: return '#f44336';
    }
  };

  return (
    <div 
      className={treeStyles.serverItem} 
      data-active={activeServer?.id === server.id} 
      onClick={handleServerClick}
    >
      <div className={treeStyles.statusDot} style={{ backgroundColor: getStatusColor(server.status) }} />
      <span>{server.name}</span>
    </div>
  );
};

// CategoryNode component for displaying a category and its children
const CategoryNode: React.FC<{
  category: Category;
  allCategories: Category[];
  allServers: Server[];
  expandedCategories: Set<string>;
  toggleCategory: (id: string) => void;
  onCategoryContextMenu: (event: React.MouseEvent, category: Category | null) => void;
  onSelectServer: (server: Server) => void;
  onSelectCategory: (category: Category) => void;
  onDoubleClickServer: (server: Server) => void; // <-- FIX: Pass prop down
  activeServer: Server | null;
  activeCategory: Category | null;
}> = ({ category, allCategories, allServers, expandedCategories, toggleCategory, onCategoryContextMenu, onSelectServer, onSelectCategory, onDoubleClickServer, activeServer, activeCategory }) => {
  const isExpanded = expandedCategories.has(category.id);
  const childCategories = allCategories.filter(c => c.parentId === category.id);
  const childServers = allServers.filter(s => s.categoryId === category.id);

  const handleCategoryClick = useClick(
    () => toggleCategory(category.id),
    () => onSelectCategory(category)
  );

  return (
    <div className={treeStyles.treeNode}>
      <div 
        className={treeStyles.header} 
        onClick={handleCategoryClick}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onCategoryContextMenu(e, category); }}
        data-active={activeCategory?.id === category.id}
      >
        {isExpanded ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />}
        {isExpanded ? <FaFolderOpen className={treeStyles.folderIcon} /> : <FaFolder className={treeStyles.folderIcon} />}
        <span>{category.name}</span>
      </div>
      {isExpanded && (
        <div>
          {childCategories.map(child => (
            <CategoryNode key={child.id} {...{ category: child, allCategories, allServers, expandedCategories, toggleCategory, onCategoryContextMenu, onSelectServer, onSelectCategory, onDoubleClickServer, activeServer, activeCategory }} />
          ))}
          {childServers.map(server => (
            <ServerNode key={server.id} server={server} activeServer={activeServer} onSelectServer={onSelectServer} onDoubleClickServer={onDoubleClickServer} />
          ))}
        </div>
      )}
    </div>
  );
};

// Main LeftSidebar component
export const LeftSidebar: React.FC<{
  isOpen: boolean;
  activeServer: Server | null;
  activeCategory: Category | null;
  onSelectServer: (server: Server) => void;
  onSelectCategory: (category: Category | null) => void;
  onCategoryContextMenu: (event: React.MouseEvent, category: Category | null) => void;
  onDoubleClickServer: (server: Server) => void; // <-- FIX: Declare the prop
}> = ({ isOpen, activeServer, activeCategory, onSelectServer, onSelectCategory, onCategoryContextMenu, onDoubleClickServer }) => {
  const { categories, servers } = useServer();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  useState(() => {
    const allCategoryIds = new Set(categories.map(c => c.id));
    allCategoryIds.add('__uncategorized__');
    setExpandedCategories(allCategoryIds);
  });

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) newSet.delete(categoryId);
      else newSet.add(categoryId);
      return newSet;
    });
  };

  const rootCategories = useMemo(() => categories.filter(c => !c.parentId), [categories]);
  const uncategorizedServers = useMemo(() => servers.filter(s => !s.categoryId), [servers]);

  const handleUncategorizedClick = useClick(
    () => toggleCategory('__uncategorized__'),
    () => onSelectCategory(null)
  );

  return (
    <div className={sidebarStyles.leftSidebar} data-closed={!isOpen}>
      {rootCategories.map(category => (
        <CategoryNode key={category.id} {...{ category, allCategories: categories, allServers: servers, expandedCategories, toggleCategory, onCategoryContextMenu, onSelectServer, onSelectCategory, onDoubleClickServer, activeServer, activeCategory }} />
      ))}
      
      <div className={treeStyles.treeNode}>
        <div 
          className={treeStyles.header} 
          onClick={handleUncategorizedClick}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onCategoryContextMenu(e, null); }}
          data-active={activeCategory === null}
        >
          {expandedCategories.has('__uncategorized__') ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />}
          {expandedCategories.has('__uncategorized__') ? <FaFolderOpen className={treeStyles.folderIcon} /> : <FaFolder className={treeStyles.folderIcon} />}
          <span>Uncategorized</span>
        </div>
        {expandedCategories.has('__uncategorized__') && uncategorizedServers.map(server => (
          <ServerNode key={server.id} server={server} activeServer={activeServer} onSelectServer={onSelectServer} onDoubleClickServer={onDoubleClickServer} />
        ))}
      </div>
    </div>
  );
};