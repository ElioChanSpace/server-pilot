import React, { useState, useMemo } from 'react';
import { useServer, Server, Category } from '../context/ServerContext';
import { FaFolder, FaFolderOpen, FaChevronRight, FaChevronDown } from 'react-icons/fa';
import { useClick } from '../hooks/useClick';
import treeStyles from './TreeView.module.css'; // Styles for the tree structure
import sidebarStyles from './LeftSidebar.module.css'; // Styles for the sidebar container itself

// --- FIX: Create a new component for the server item ---
const ServerNode: React.FC<{
  server: Server;
  activeServer: Server | null;
  onSelectServer: (server: Server) => void;
}> = ({ server, activeServer, onSelectServer }) => {
  const { connectToServer } = useServer();

  const handleServerClick = useClick(
    () => onSelectServer(server),
    () => connectToServer(server.id)
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


const CategoryNode: React.FC<{
  category: Category;
  allCategories: Category[];
  allServers: Server[];
  expandedCategories: Set<string>;
  toggleCategory: (id: string) => void;
  onCategoryContextMenu: (event: React.MouseEvent, category: Category | null) => void;
  onSelectServer: (server: Server) => void;
  onSelectCategory: (category: Category) => void;
  activeServer: Server | null;
  activeCategory: Category | null;
}> = ({ category, allCategories, allServers, expandedCategories, toggleCategory, onCategoryContextMenu, onSelectServer, onSelectCategory, activeServer, activeCategory }) => {
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
            <CategoryNode key={child.id} {...{ category: child, allCategories, allServers, expandedCategories, toggleCategory, onCategoryContextMenu, onSelectServer, onSelectCategory, activeServer, activeCategory }} />
          ))}
          {childServers.map(server => (
            <ServerNode key={server.id} server={server} activeServer={activeServer} onSelectServer={onSelectServer} />
          ))}
        </div>
      )}
    </div>
  );
};

export const LeftSidebar: React.FC<{
  isOpen: boolean;
  activeServer: Server | null;
  activeCategory: Category | null;
  onSelectServer: (server: Server) => void;
  onSelectCategory: (category: Category | null) => void;
  onCategoryContextMenu: (event: React.MouseEvent, category: Category | null) => void;
}> = ({ isOpen, activeServer, activeCategory, onSelectServer, onSelectCategory, onCategoryContextMenu }) => {
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
    // --- THE FIX ---
    // Use the imported `sidebarStyles.leftSidebar` instead of the plain string "leftSidebar"
    <div className={sidebarStyles.leftSidebar} data-closed={!isOpen}>
      {rootCategories.map(category => (
        <CategoryNode key={category.id} {...{ category, allCategories: categories, allServers: servers, expandedCategories, toggleCategory, onCategoryContextMenu, onSelectServer, onSelectCategory, activeServer, activeCategory }} />
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
          <ServerNode key={server.id} server={server} activeServer={activeServer} onSelectServer={onSelectServer} />
        ))}
      </div>
    </div>
  );
};