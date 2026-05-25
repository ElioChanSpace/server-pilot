import React, { useEffect, useMemo, useState } from 'react';
import { useServer, Server, Category } from '../context/ServerContext';
import { FaChevronDown, FaChevronRight, FaFolder, FaFolderOpen, FaPlus, FaPlug, FaUnlink } from 'react-icons/fa';
import treeStyles from './TreeView.module.css';
import sidebarStyles from './LeftSidebar.module.css';

const getStatusColor = (status: string) => {
  switch (status) {
    case 'connected':
      return 'var(--success-color)';
    case 'connecting':
      return 'var(--warning-color)';
    default:
      return 'var(--danger-color)';
  }
};

const ServerNode: React.FC<{
  server: Server;
  activeServer: Server | null;
  onSelectServer: (server: Server) => void;
  onConnectServer: (server: Server) => void;
  onDisconnectServer: (server: Server) => void;
  onServerContextMenu?: (event: React.MouseEvent, server: Server) => void;
}> = ({ server, activeServer, onSelectServer, onConnectServer, onDisconnectServer, onServerContextMenu }) => {
  const handleActionClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (server.status === 'connected' || server.status === 'connecting') {
      onDisconnectServer(server);
      return;
    }
    onConnectServer(server);
  };

  return (
    <div
      className={treeStyles.serverItem}
      data-active={activeServer?.id === server.id}
      onClick={() => onSelectServer(server)}
      onDoubleClick={() => onConnectServer(server)}
      onContextMenu={(e) => {
        if (onServerContextMenu) {
          e.preventDefault();
          e.stopPropagation();
          onServerContextMenu(e, server);
        }
      }}
    >
      <div className={treeStyles.statusDot} style={{ backgroundColor: getStatusColor(server.status) }} />
      <div className={treeStyles.nodeBody}>
        <span className={treeStyles.nodeTitle}>{server.name}</span>
        <span className={treeStyles.nodeMeta}>
          {server.username}@{server.host}:{server.port}
        </span>
      </div>
      <button
        type="button"
        className={treeStyles.nodeAction}
        onClick={handleActionClick}
        title={server.status === 'connected' || server.status === 'connecting' ? '断开连接' : '连接服务器'}
      >
        {server.status === 'connected' || server.status === 'connecting' ? <FaUnlink size={11} /> : <FaPlug size={11} />}
      </button>
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
  onCreateServer: (category: Category | null) => void;
  onCreateSubCategory: (category: Category | null) => void;
  onConnectServer: (server: Server) => void;
  onDisconnectServer: (server: Server) => void;
  onServerContextMenu?: (event: React.MouseEvent, server: Server) => void;
  activeServer: Server | null;
  activeCategory: Category | null;
  categoryServerCounts: Map<string, number>;
}> = ({ category, allCategories, allServers, expandedCategories, toggleCategory, onCategoryContextMenu, onSelectServer, onSelectCategory, onCreateServer, onCreateSubCategory, onConnectServer, onDisconnectServer, onServerContextMenu, activeServer, activeCategory, categoryServerCounts }) => {
  const isExpanded = expandedCategories.has(category.id);
  const childCategories = allCategories.filter(c => c.parentId === category.id);
  const childServers = allServers.filter(s => s.categoryId === category.id);
  const hasChildren = childCategories.length > 0 || childServers.length > 0;
  const serverCount = categoryServerCounts.get(category.id) ?? 0;

  return (
    <div className={treeStyles.treeNode}>
      <div
        className={treeStyles.header}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onCategoryContextMenu(e, category); }}
        data-active={activeCategory?.id === category.id}
      >
        <button
          type="button"
          className={treeStyles.expander}
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) {
              toggleCategory(category.id);
            }
          }}
          aria-label={isExpanded ? '收起文件夹' : '展开文件夹'}
        >
          {hasChildren ? (isExpanded ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />) : <span className={treeStyles.expanderSpacer} />}
        </button>
        <button
          type="button"
          className={treeStyles.headerMain}
          onClick={() => {
            onSelectCategory(category);
            if (hasChildren && !isExpanded) {
              toggleCategory(category.id);
            }
          }}
        >
          {isExpanded ? <FaFolderOpen className={treeStyles.folderIcon} /> : <FaFolder className={treeStyles.folderIcon} />}
          <div className={treeStyles.nodeBody}>
            <span className={treeStyles.nodeTitle}>{category.name}</span>
            <span className={treeStyles.nodeMeta}>{serverCount} 台服务器</span>
          </div>
        </button>
        <div className={treeStyles.nodeActions}>
          <button
            type="button"
            className={treeStyles.nodeAction}
            onClick={(event) => {
              event.stopPropagation();
              onCreateServer(category);
            }}
            title="新建服务器"
          >
            <FaPlug size={11} />
          </button>
          <button
            type="button"
            className={treeStyles.nodeAction}
            onClick={(event) => {
              event.stopPropagation();
              onCreateSubCategory(category);
            }}
            title="新建子分类"
          >
            <FaPlus size={11} />
          </button>
        </div>
      </div>
      {isExpanded && (
        <div>
          {childCategories.map(child => (
            <CategoryNode key={child.id} {...{ category: child, allCategories, allServers, expandedCategories, toggleCategory, onCategoryContextMenu, onSelectServer, onSelectCategory, onCreateServer, onCreateSubCategory, onConnectServer, onDisconnectServer, onServerContextMenu, activeServer, activeCategory, categoryServerCounts }} />
          ))}
          {childServers.map(server => (
            <ServerNode
              key={server.id}
              server={server}
              activeServer={activeServer}
              onSelectServer={onSelectServer}
              onConnectServer={onConnectServer}
              onDisconnectServer={onDisconnectServer}
              onServerContextMenu={onServerContextMenu}
            />
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
  isUncategorizedActive: boolean;
  onSelectServer: (server: Server) => void;
  onSelectCategory: (category: Category | null) => void;
  onCategoryContextMenu: (event: React.MouseEvent, category: Category | null) => void;
  onCreateServer: (category: Category | null) => void;
  onCreateSubCategory: (category: Category | null) => void;
  onConnectServer: (server: Server) => void;
  onDisconnectServer: (server: Server) => void;
  onServerContextMenu?: (event: React.MouseEvent, server: Server) => void;
}> = ({ isOpen, activeServer, activeCategory, isUncategorizedActive, onSelectServer, onSelectCategory, onCategoryContextMenu, onCreateServer, onCreateSubCategory, onConnectServer, onDisconnectServer, onServerContextMenu }) => {
  const { categories, servers } = useServer();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      categories.forEach(category => next.add(category.id));
      next.add('__uncategorized__');
      return next;
    });
  }, [categories]);

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
  const categoryServerCounts = useMemo(() => {
    const counts = new Map<string, number>();

    const collectServerCount = (categoryId: string): number => {
      const directServers = servers.filter(server => server.categoryId === categoryId).length;
      const childCategoryIds = categories.filter(category => category.parentId === categoryId).map(category => category.id);
      const nestedServers = childCategoryIds.reduce((sum, childId) => sum + collectServerCount(childId), 0);
      const total = directServers + nestedServers;
      counts.set(categoryId, total);
      return total;
    };

    categories
      .filter(category => !category.parentId)
      .forEach(category => collectServerCount(category.id));

    return counts;
  }, [categories, servers]);

  return (
    <div className={sidebarStyles.leftSidebar} data-closed={!isOpen}>
      {rootCategories.map(category => (
        <CategoryNode key={category.id} {...{ category, allCategories: categories, allServers: servers, expandedCategories, toggleCategory, onCategoryContextMenu, onSelectServer, onSelectCategory, onCreateServer, onCreateSubCategory, onConnectServer, onDisconnectServer, onServerContextMenu, activeServer, activeCategory, categoryServerCounts }} />
      ))}
      
      <div className={treeStyles.treeNode}>
        <div
          className={treeStyles.header}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onCategoryContextMenu(e, null); }}
          data-active={isUncategorizedActive}
        >
          <button
            type="button"
            className={treeStyles.expander}
            onClick={(event) => {
              event.stopPropagation();
              if (uncategorizedServers.length > 0) {
                toggleCategory('__uncategorized__');
              }
            }}
            aria-label={expandedCategories.has('__uncategorized__') ? '收起未分类' : '展开未分类'}
          >
            {uncategorizedServers.length > 0
              ? (expandedCategories.has('__uncategorized__') ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />)
              : <span className={treeStyles.expanderSpacer} />}
          </button>
          <button
            type="button"
            className={treeStyles.headerMain}
            onClick={() => {
              onSelectCategory(null);
              if (uncategorizedServers.length > 0 && !expandedCategories.has('__uncategorized__')) {
                toggleCategory('__uncategorized__');
              }
            }}
          >
            {expandedCategories.has('__uncategorized__') ? <FaFolderOpen className={treeStyles.folderIcon} /> : <FaFolder className={treeStyles.folderIcon} />}
            <div className={treeStyles.nodeBody}>
              <span className={treeStyles.nodeTitle}>未分类</span>
              <span className={treeStyles.nodeMeta}>{uncategorizedServers.length} 台服务器</span>
            </div>
          </button>
          <div className={treeStyles.nodeActions}>
            <button
              type="button"
              className={treeStyles.nodeAction}
              onClick={(event) => {
                event.stopPropagation();
                onCreateServer(null);
              }}
              title="新增未分类服务器"
            >
              <FaPlus size={11} />
            </button>
          </div>
        </div>
        {expandedCategories.has('__uncategorized__') && uncategorizedServers.map(server => (
          <ServerNode
            key={server.id}
            server={server}
            activeServer={activeServer}
            onSelectServer={onSelectServer}
            onConnectServer={onConnectServer}
            onDisconnectServer={onDisconnectServer}
            onServerContextMenu={onServerContextMenu}
          />
        ))}
      </div>
    </div>
  );
};
