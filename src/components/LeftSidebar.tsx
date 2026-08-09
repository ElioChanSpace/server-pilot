import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useServer, Server, Category, OsType } from '../context/ServerContext';
import { FaChevronDown, FaChevronRight, FaFolder, FaFolderOpen, FaLinux, FaPlus, FaPlug, FaUnlink, FaWindows } from 'react-icons/fa';
import treeStyles from './TreeView.module.css';
import sidebarStyles from './LeftSidebar.module.css';

const EMPTY_CATEGORIES: Category[] = [];
const EMPTY_SERVERS: Server[] = [];

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

const getServerIcon = (osType: OsType) => (
  osType === OsType.Windows
    ? <FaWindows className={treeStyles.serverOsIcon} title="Windows" />
    : <FaLinux className={treeStyles.serverOsIcon} title="Linux" />
);

interface ServerNodeProps {
  server: Server;
  depth: number;
  activeServer: Server | null;
  onSelectServer: (server: Server) => void;
  onConnectServer: (server: Server) => void;
  onDisconnectServer: (server: Server) => void;
  onServerContextMenu?: (event: React.MouseEvent, server: Server) => void;
}

const ServerNode = memo<ServerNodeProps>(({
  server, depth, activeServer, onSelectServer, onConnectServer, onDisconnectServer, onServerContextMenu,
}) => {
  const handleActionClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (server.osType !== OsType.Linux) {
      return;
    }
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
      style={{ paddingLeft: `${24 + depth * 20}px` }}
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
      {getServerIcon(server.osType)}
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
        disabled={server.osType !== OsType.Linux}
        title={
          server.osType !== OsType.Linux
            ? '暂不支持 Windows 服务器'
            : server.status === 'connected' || server.status === 'connecting'
              ? '断开连接'
              : '连接服务器'
        }
      >
        {server.status === 'connected' || server.status === 'connecting' ? <FaUnlink size={11} /> : <FaPlug size={11} />}
      </button>
    </div>
  );
});

interface CategoryNodeProps {
  category: Category;
  categoryChildrenMap: Map<string, Category[]>;
  serversByCategory: Map<string, Server[]>;
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
  depth: number;
}

const CategoryNode = memo<CategoryNodeProps>(({
  category, categoryChildrenMap, serversByCategory, expandedCategories, toggleCategory,
  onCategoryContextMenu, onSelectServer, onSelectCategory, onCreateServer, onCreateSubCategory,
  onConnectServer, onDisconnectServer, onServerContextMenu, activeServer, activeCategory,
  categoryServerCounts, depth,
}) => {
  const isExpanded = expandedCategories.has(category.id);
  const childCategories = categoryChildrenMap.get(category.id) ?? EMPTY_CATEGORIES;
  const childServers = serversByCategory.get(category.id) ?? EMPTY_SERVERS;
  const hasChildren = childCategories.length > 0 || childServers.length > 0;
  const serverCount = categoryServerCounts.get(category.id) ?? 0;

  return (
    <div className={treeStyles.treeNode}>
      <div
        className={treeStyles.header}
        style={{ paddingLeft: `${depth * 20}px` }}
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
            <CategoryNode
              key={child.id}
              category={child}
              categoryChildrenMap={categoryChildrenMap}
              serversByCategory={serversByCategory}
              expandedCategories={expandedCategories}
              toggleCategory={toggleCategory}
              onCategoryContextMenu={onCategoryContextMenu}
              onSelectServer={onSelectServer}
              onSelectCategory={onSelectCategory}
              onCreateServer={onCreateServer}
              onCreateSubCategory={onCreateSubCategory}
              onConnectServer={onConnectServer}
              onDisconnectServer={onDisconnectServer}
              onServerContextMenu={onServerContextMenu}
              activeServer={activeServer}
              activeCategory={activeCategory}
              categoryServerCounts={categoryServerCounts}
              depth={depth + 1}
            />
          ))}
          {childServers.map(server => (
            <ServerNode
              key={server.id}
              server={server}
              depth={depth + 1}
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
});

interface LeftSidebarProps {
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
}

export const LeftSidebar = memo<LeftSidebarProps>(({
  isOpen, activeServer, activeCategory, isUncategorizedActive, onSelectServer, onSelectCategory,
  onCategoryContextMenu, onCreateServer, onCreateSubCategory, onConnectServer, onDisconnectServer,
  onServerContextMenu,
}) => {
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

  const toggleCategory = useCallback((categoryId: string) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) newSet.delete(categoryId);
      else newSet.add(categoryId);
      return newSet;
    });
  }, []);

  const rootCategories = useMemo(() => categories.filter(c => !c.parentId), [categories]);

  const categoryChildrenMap = useMemo(() => {
    const map = new Map<string, Category[]>();
    categories.forEach(category => {
      if (!category.parentId) {
        return;
      }
      const siblings = map.get(category.parentId);
      if (siblings) {
        siblings.push(category);
      } else {
        map.set(category.parentId, [category]);
      }
    });
    return map;
  }, [categories]);

  const serversByCategory = useMemo(() => {
    const map = new Map<string, Server[]>();
    servers.forEach(server => {
      if (!server.categoryId) {
        return;
      }
      const siblings = map.get(server.categoryId);
      if (siblings) {
        siblings.push(server);
      } else {
        map.set(server.categoryId, [server]);
      }
    });
    return map;
  }, [servers]);

  const uncategorizedServers = useMemo(() => servers.filter(s => !s.categoryId), [servers]);

  const categoryServerCounts = useMemo(() => {
    const counts = new Map<string, number>();

    const collectServerCount = (categoryId: string): number => {
      const directServers = serversByCategory.get(categoryId)?.length ?? 0;
      const childCategoryIds = categoryChildrenMap.get(categoryId) ?? EMPTY_CATEGORIES;
      const nestedServers = childCategoryIds.reduce((sum, child) => sum + collectServerCount(child.id), 0);
      const total = directServers + nestedServers;
      counts.set(categoryId, total);
      return total;
    };

    rootCategories.forEach(category => collectServerCount(category.id));
    return counts;
  }, [categoryChildrenMap, rootCategories, serversByCategory]);

  return (
    <div className={sidebarStyles.leftSidebar} data-closed={!isOpen}>
      {rootCategories.map(category => (
        <CategoryNode
          key={category.id}
          category={category}
          categoryChildrenMap={categoryChildrenMap}
          serversByCategory={serversByCategory}
          expandedCategories={expandedCategories}
          toggleCategory={toggleCategory}
          onCategoryContextMenu={onCategoryContextMenu}
          onSelectServer={onSelectServer}
          onSelectCategory={onSelectCategory}
          onCreateServer={onCreateServer}
          onCreateSubCategory={onCreateSubCategory}
          onConnectServer={onConnectServer}
          onDisconnectServer={onDisconnectServer}
          onServerContextMenu={onServerContextMenu}
          activeServer={activeServer}
          activeCategory={activeCategory}
          categoryServerCounts={categoryServerCounts}
          depth={0}
        />
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
            depth={1}
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
});
