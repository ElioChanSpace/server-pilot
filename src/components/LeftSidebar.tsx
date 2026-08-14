import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useServer, Server, Category, OsType } from '../context/ServerContext';
import {
  FaChevronDown, FaChevronRight, FaEdit, FaFolder, FaFolderOpen,
  FaGripVertical, FaHistory, FaLinux, FaPlus, FaPlug, FaServer, FaSearch,
  FaTimes, FaUnlink, FaWindows,
} from 'react-icons/fa';
import treeStyles from './TreeView.module.css';
import sidebarStyles from './LeftSidebar.module.css';

const EMPTY_CATEGORIES: Category[] = [];
const EMPTY_SERVERS: Server[] = [];

const getStatusColor = (status: string) => {
  switch (status) {
    case 'connected': return 'var(--success-color)';
    case 'connecting': return 'var(--warning-color)';
    default: return 'var(--danger-color)';
  }
};

// ---- 分类节点（可拖拽 + 可放置）----

interface CategoryNodeProps {
  category: Category;
  depth: number;
  expandedCategories: Set<string>;
  toggleCategory: (id: string) => void;
  categoryChildrenMap: Map<string, Category[]>;
  serversByCategory: Map<string, Server[]>;
  categoryServerCounts: Map<string, number>;
  activeCategory: Category | null;
  activeServer: Server | null;
  overCategoryId: string | null;
  dropPosition: 'before' | 'inside' | 'after' | null;
  activeDragId: string | null;
  matchingServerIds: Set<string> | null;
  visibleCategoryIds: Set<string> | null;
  onCategoryContextMenu: (e: React.MouseEvent, cat: Category | null) => void;
  onSelectCategory: (cat: Category) => void;
  onCreateServer: (cat: Category | null) => void;
  onCreateSubCategory: (cat: Category | null) => void;
  onEditCategory: (cat: Category) => void;
  onSelectServer: (server: Server) => void;
  onConnectServer: (server: Server) => void;
  onDisconnectServer: (server: Server) => void;
  onOpenCommandHistory?: (server: Server) => void;
  onServerContextMenu?: (e: React.MouseEvent, server: Server) => void;
}

const CategoryNode = memo<CategoryNodeProps>((props) => {
  const {
    category, depth, expandedCategories, toggleCategory,
    categoryChildrenMap, serversByCategory, categoryServerCounts,
    activeCategory, activeServer, overCategoryId, dropPosition, activeDragId,
    matchingServerIds, visibleCategoryIds,
    onCategoryContextMenu, onSelectCategory, onCreateServer, onCreateSubCategory,
    onEditCategory, onSelectServer, onConnectServer, onDisconnectServer, onOpenCommandHistory, onServerContextMenu,
  } = props;

  const isSearching = matchingServerIds !== null;
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({ id: category.id, disabled: isSearching });
  const { setNodeRef: setDropRef } = useDroppable({ id: category.id, disabled: isSearching });

  // 搜索时过滤子分类和子服务器
  const allChildCategories = categoryChildrenMap.get(category.id) ?? EMPTY_CATEGORIES;
  const allChildServers = serversByCategory.get(category.id) ?? EMPTY_SERVERS;
  const childCategories = isSearching
    ? allChildCategories.filter(c => visibleCategoryIds?.has(c.id))
    : allChildCategories;
  const childServers = isSearching
    ? allChildServers.filter(s => matchingServerIds.has(s.id))
    : allChildServers;
  const hasChildren = childCategories.length > 0 || childServers.length > 0;
  // 搜索时显示匹配数量，否则显示总数
  const serverCount = isSearching
    ? childServers.length
    : (categoryServerCounts.get(category.id) ?? 0);
  // 搜索时强制展开
  const isExpanded = isSearching || expandedCategories.has(category.id);

  const isOver = overCategoryId === category.id && activeDragId !== category.id;
  const showBefore = isOver && dropPosition === 'before';
  const showInside = isOver && dropPosition === 'inside';
  const showAfter = isOver && dropPosition === 'after';

  const style: React.CSSProperties = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, opacity: isDragging ? 0.3 : 1 }
    : { opacity: isDragging ? 0.3 : 1 };

  // 合并 drag ref 和 drop ref
  const setRefs = useCallback((el: HTMLElement | null) => {
    setDragRef(el);
    setDropRef(el);
  }, [setDragRef, setDropRef]);

  return (
    <div className={treeStyles.treeNode} ref={setRefs} style={style} data-category-id={category.id}>
      {showBefore && <div className={treeStyles.dropLine} />}
      <div
        className={treeStyles.header}
        style={{ paddingLeft: `${depth * 20}px` }}
        data-active={activeCategory?.id === category.id}
        data-drop-inside={showInside || undefined}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onCategoryContextMenu(e, category); }}
      >
        {!isSearching && (
          <div className={treeStyles.dragHandle} {...attributes} {...listeners} title="拖拽排序或移入其他分类">
            <FaGripVertical size={10} />
          </div>
        )}
        <button
          type="button"
          className={treeStyles.expander}
          onClick={(e) => { e.stopPropagation(); if (hasChildren) toggleCategory(category.id); }}
        >
          {hasChildren
            ? (isExpanded ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />)
            : <span className={treeStyles.expanderSpacer} />}
        </button>
        <button
          type="button"
          className={treeStyles.headerMain}
          onClick={() => { onSelectCategory(category); if (hasChildren && !isExpanded) toggleCategory(category.id); }}
        >
          {isExpanded ? <FaFolderOpen className={treeStyles.folderIcon} /> : <FaFolder className={treeStyles.folderIcon} />}
          <div className={treeStyles.nodeBody}>
            <span className={treeStyles.nodeTitle}>{category.name}</span>
            <span className={treeStyles.nodeMeta}>{serverCount} 台服务器</span>
          </div>
        </button>
        <div className={treeStyles.nodeActions}>
          <button type="button" className={treeStyles.nodeAction} onClick={(e) => { e.stopPropagation(); onCreateServer(category); }} title="新建服务器">
            <FaServer size={11} />
          </button>
          <button type="button" className={treeStyles.nodeAction} onClick={(e) => { e.stopPropagation(); onCreateSubCategory(category); }} title="新建子分类">
            <FaPlus size={11} />
          </button>
          <button type="button" className={treeStyles.nodeAction} onClick={(e) => { e.stopPropagation(); onEditCategory(category); }} title="编辑分类">
            <FaEdit size={11} />
          </button>
        </div>
      </div>
      {isExpanded && (
        <>
          {childCategories.map(child => (
            <CategoryNode key={child.id} {...props} category={child} depth={depth + 1} />
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
              onOpenCommandHistory={onOpenCommandHistory}
              onServerContextMenu={onServerContextMenu}
            />
          ))}
        </>
      )}
      {showAfter && <div className={treeStyles.dropLine} />}
    </div>
  );
});

// ---- 服务器节点 ----

interface ServerNodeProps {
  server: Server;
  depth: number;
  activeServer: Server | null;
  onSelectServer: (server: Server) => void;
  onConnectServer: (server: Server) => void;
  onDisconnectServer: (server: Server) => void;
  onOpenCommandHistory?: (server: Server) => void;
  onServerContextMenu?: (e: React.MouseEvent, server: Server) => void;
}

const ServerNode = memo<ServerNodeProps>(({ server, depth, activeServer, onSelectServer, onConnectServer, onDisconnectServer, onOpenCommandHistory, onServerContextMenu }) => {
  const handleActionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (server.osType !== OsType.Linux) return;
    if (server.status === 'connected' || server.status === 'connecting') onDisconnectServer(server);
    else onConnectServer(server);
  };
  const handleHistoryClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenCommandHistory?.(server);
  };
  return (
    <div
      className={treeStyles.serverItem}
      data-active={activeServer?.id === server.id}
      style={{ paddingLeft: `${24 + depth * 20}px` }}
      onClick={() => onSelectServer(server)}
      onDoubleClick={() => onConnectServer(server)}
      onContextMenu={(e) => { if (onServerContextMenu) { e.preventDefault(); e.stopPropagation(); onServerContextMenu(e, server); } }}
    >
      <span className={treeStyles.serverOsIcon}>
        {server.osType === OsType.Windows ? <FaWindows /> : <FaLinux />}
        <span className={treeStyles.statusDot} style={{ backgroundColor: getStatusColor(server.status) }} />
      </span>
      <div className={treeStyles.nodeBody}>
        <span className={treeStyles.nodeTitle}>{server.name}</span>
        <span className={treeStyles.nodeMeta}>{server.username}@{server.host}:{server.port}</span>
      </div>
      <button type="button" className={treeStyles.nodeHistoryAction} onClick={handleHistoryClick} title="命令历史">
        <FaHistory size={10} />
      </button>
      <button type="button" className={treeStyles.nodeAction} onClick={handleActionClick} disabled={server.osType !== OsType.Linux}
        title={server.osType !== OsType.Linux ? '暂不支持 Windows' : server.status === 'connected' || server.status === 'connecting' ? '断开连接' : '连接服务器'}
      >
        {server.status === 'connected' || server.status === 'connecting' ? <FaUnlink size={11} /> : <FaPlug size={11} />}
      </button>
    </div>
  );
});

// ---- 主组件 ----

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
  onEditCategory: (category: Category) => void;
  onConnectServer: (server: Server) => void;
  onDisconnectServer: (server: Server) => void;
  onOpenCommandHistory: (server: Server) => void;
  onServerContextMenu?: (event: React.MouseEvent, server: Server) => void;
}

export const LeftSidebar = memo<LeftSidebarProps>(({
  isOpen, activeServer, activeCategory, isUncategorizedActive, onSelectServer, onSelectCategory,
  onCategoryContextMenu, onCreateServer, onCreateSubCategory, onEditCategory,
  onConnectServer, onDisconnectServer, onOpenCommandHistory, onServerContextMenu,
}) => {
  console.log('[Search] LeftSidebar render');
  const { categories, servers, updateCategoryOrder, moveCategoryToParent } = useServer();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overCategoryId, setOverCategoryId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'before' | 'inside' | 'after' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // refs 用于在回调中读取最新值
  const overCategoryIdRef = useRef<string | null>(null);
  const dropPositionRef = useRef<'before' | 'inside' | 'after' | null>(null);
  const activeDragIdRef = useRef<string | null>(null);

  // useLayoutEffect 同步 ref，确保 handleDragEnd 读取时已是最新值
  useLayoutEffect(() => { overCategoryIdRef.current = overCategoryId; }, [overCategoryId]);
  useLayoutEffect(() => { dropPositionRef.current = dropPosition; }, [dropPosition]);
  useLayoutEffect(() => { activeDragIdRef.current = activeDragId; }, [activeDragId]);

  // 新增分类时自动展开
  useEffect(() => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      let changed = false;
      categories.forEach(c => { if (!next.has(c.id)) { next.add(c.id); changed = true; } });
      next.add('__uncategorized__');
      return changed ? next : prev;
    });
  }, [categories]);

  const toggleCategory = useCallback((id: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ---- 传感器 ----
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // ---- pointermove：确定目标分类 + drop 位置 ----
  useEffect(() => {
    if (!activeDragId) return;
    const handler = (e: PointerEvent) => {
      // elementsFromPoint 返回所有元素（含被 overlay 挡住的）
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      let catEl: HTMLElement | null = null;
      for (const el of els) {
        const found = (el as HTMLElement).closest('[data-category-id]') as HTMLElement | null;
        if (found) { catEl = found; break; }
      }
      if (!catEl) { setOverCategoryId(null); setDropPosition(null); return; }
      const targetId = catEl.getAttribute('data-category-id');
      if (!targetId || targetId === activeDragId) { setOverCategoryId(null); setDropPosition(null); return; }
      setOverCategoryId(targetId);
      const rect = catEl.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      if (ratio < 0.33) setDropPosition('before');
      else if (ratio > 0.67) setDropPosition('after');
      else setDropPosition('inside');
    };
    window.addEventListener('pointermove', handler);
    return () => window.removeEventListener('pointermove', handler);
  }, [activeDragId]);

  // ---- 拖拽事件 ----
  const handleDragStart = useCallback((e: DragStartEvent) => { setActiveDragId(e.active.id as string); }, []);

  const handleDragEnd = useCallback(async (_e: DragEndEvent) => {
    const dragId = activeDragIdRef.current;
    const overId = overCategoryIdRef.current;
    const position = dropPositionRef.current;
    setActiveDragId(null); setOverCategoryId(null); setDropPosition(null);
    if (!dragId || !overId || dragId === overId || !position) return;
    const dragged = categories.find(c => c.id === dragId);
    const target = categories.find(c => c.id === overId);
    if (!dragged || !target) return;
    if (target.parentId === dragged.id) return; // 防止移入子分类

    if (position === 'inside') {
      if (dragged.parentId === target.id) return;
      const siblings = categories.filter(c => c.parentId === target.id && c.id !== dragId);
      await moveCategoryToParent(dragId, target.id, siblings.length).catch(console.error);
    } else {
      const targetParentId = target.parentId;
      if (dragged.parentId !== targetParentId) {
        // 跨级：移到目标父级，放在目标旁边
        const siblings = categories.filter(c => c.parentId === targetParentId && c.id !== dragId);
        const idx = siblings.findIndex(c => c.id === overId);
        const insertIdx = position === 'before' ? idx : idx + 1;
        await moveCategoryToParent(dragId, targetParentId, insertIdx).catch(console.error);
      } else {
        // 同级排序
        const siblings = categories.filter(c => c.parentId === targetParentId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const draggedIdx = siblings.findIndex(c => c.id === dragId);
        const targetIdx = siblings.findIndex(c => c.id === overId);
        if (draggedIdx === -1 || targetIdx === -1) return;
        const arr = [...siblings];
        const [removed] = arr.splice(draggedIdx, 1);
        const insertIdx = arr.findIndex(c => c.id === overId);
        arr.splice(position === 'before' ? insertIdx : insertIdx + 1, 0, removed);
        await updateCategoryOrder(arr.map((c, i) => ({ id: c.id, order: i }))).catch(console.error);
      }
    }
  }, [categories, moveCategoryToParent, updateCategoryOrder]);

  // ---- 数据 ----
  const rootCategories = useMemo(() => categories.filter(c => !c.parentId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [categories]);
  const categoryChildrenMap = useMemo(() => {
    const map = new Map<string, Category[]>();
    categories.forEach(c => { if (c.parentId) { const arr = map.get(c.parentId); if (arr) arr.push(c); else map.set(c.parentId, [c]); } });
    map.forEach((arr, pid) => map.set(pid, arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))));
    return map;
  }, [categories]);
  const serversByCategory = useMemo(() => {
    const map = new Map<string, Server[]>();
    servers.forEach(s => { if (s.categoryId) { const arr = map.get(s.categoryId); if (arr) arr.push(s); else map.set(s.categoryId, [s]); } });
    return map;
  }, [servers]);
  const uncategorizedServers = useMemo(() => servers.filter(s => !s.categoryId), [servers]);
  const categoryServerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const collect = (id: string): number => {
      const direct = serversByCategory.get(id)?.length ?? 0;
      const nested = (categoryChildrenMap.get(id) ?? []).reduce((s, c) => s + collect(c.id), 0);
      counts.set(id, direct + nested);
      return direct + nested;
    };
    rootCategories.forEach(c => collect(c.id));
    return counts;
  }, [categoryChildrenMap, rootCategories, serversByCategory]);

  const activeDragCategory = useMemo(() => activeDragId ? categories.find(c => c.id === activeDragId) : null, [activeDragId, categories]);

  // ---- 搜索过滤 ----
  const trimmedQuery = searchQuery.trim();
  const isSearching = trimmedQuery.length > 0;
  const { matchingServerIds, visibleCategoryIds } = useMemo(() => {
    if (!trimmedQuery) { return { matchingServerIds: null, visibleCategoryIds: null }; }

    const q = trimmedQuery.toLowerCase();

    // 预构建索引
    const parentMap = new Map<string, string | undefined>();
    categories.forEach(c => parentMap.set(c.id, c.parentId));
    const serversByCatId = new Map<string, Server[]>();
    servers.forEach(s => { if (s.categoryId) { const arr = serversByCatId.get(s.categoryId); if (arr) arr.push(s); else serversByCatId.set(s.categoryId, [s]); } });
    const childrenByParentId = new Map<string, Category[]>();
    categories.forEach(c => { if (c.parentId) { const arr = childrenByParentId.get(c.parentId); if (arr) arr.push(c); else childrenByParentId.set(c.parentId, [c]); } });

    const serverIds = new Set<string>();
    const catIds = new Set<string>();

    // 向上收集祖先分类
    const collectAncestors = (startId: string | undefined) => {
      let cur = startId;
      let depth = 0;
      while (cur) {
        if (depth > 50) break;
        catIds.add(cur);
        cur = parentMap.get(cur);
        depth++;
      }
    };

    // 匹配服务器
    servers.forEach(s => {
      if (s.name.toLowerCase().includes(q) || s.host.toLowerCase().includes(q) || s.username.toLowerCase().includes(q) || String(s.port).includes(q)) {
        serverIds.add(s.id);
        collectAncestors(s.categoryId);
      }
    });

    // 匹配分类名
    categories.forEach(c => {
      if (c.name.toLowerCase().includes(q)) {
        catIds.add(c.id);
        const collectDescendants = (catId: string, visited: Set<string>) => {
          if (visited.has(catId)) return;
          visited.add(catId);
          (serversByCatId.get(catId) ?? []).forEach(s => serverIds.add(s.id));
          (childrenByParentId.get(catId) ?? []).forEach(cc => {
            catIds.add(cc.id);
            collectDescendants(cc.id, visited);
          });
        };
        collectDescendants(c.id, new Set());
        collectAncestors(c.parentId);
      }
    });

    return { matchingServerIds: serverIds, visibleCategoryIds: catIds };
  }, [trimmedQuery, servers, categories]);

  // 过滤根分类和未分类服务器
  const filteredRootCategories = useMemo(() => {
    if (!visibleCategoryIds) return rootCategories;
    return rootCategories.filter(c => visibleCategoryIds.has(c.id));
  }, [rootCategories, visibleCategoryIds]);

  const filteredUncategorizedServers = useMemo(() => {
    if (!matchingServerIds) return uncategorizedServers;
    return uncategorizedServers.filter(s => matchingServerIds.has(s.id));
  }, [uncategorizedServers, matchingServerIds]);

  console.log(`[Search] render: isSearching=${isSearching} trimmedQuery="${trimmedQuery}" rootCats:${filteredRootCategories.length} uncategorized:${filteredUncategorizedServers.length} expanded:${expandedCategories.size}`);

  // 搜索时展开所有匹配的分类
  // 用 trimmedQuery 而非 visibleCategoryIds（Set 引用每次渲染都不同，会导致无限循环）
  useEffect(() => {
    if (!isSearching || !visibleCategoryIds) return;
    console.log(`[Search] useEffect expand: query="${trimmedQuery}" catIds:${visibleCategoryIds.size} uncategorized:${filteredUncategorizedServers.length}`);
    setExpandedCategories(prev => {
      const next = new Set(prev);
      let added = 0;
      visibleCategoryIds.forEach(id => { if (!next.has(id)) { next.add(id); added++; } });
      if (filteredUncategorizedServers.length > 0 && !next.has('__uncategorized__')) {
        next.add('__uncategorized__');
        added++;
      }
      console.log(`[Search] setExpandedCategories: prev:${prev.size} added:${added} → next:${next.size} changed:${added > 0}`);
      return added > 0 ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedQuery]);

  // Escape 快捷键聚焦搜索框
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const nodeProps = {
    depth: 0, expandedCategories, toggleCategory, categoryChildrenMap, serversByCategory, categoryServerCounts,
    activeCategory, activeServer, overCategoryId, dropPosition, activeDragId,
    matchingServerIds, visibleCategoryIds,
    onCategoryContextMenu, onSelectCategory, onCreateServer, onCreateSubCategory, onEditCategory,
    onSelectServer, onConnectServer, onDisconnectServer, onOpenCommandHistory, onServerContextMenu,
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => { setActiveDragId(null); setOverCategoryId(null); setDropPosition(null); }}>
      <div className={sidebarStyles.leftSidebar} data-closed={!isOpen}>
        {/* 搜索框 */}
        <div className={sidebarStyles.searchBox}>
          <FaSearch className={sidebarStyles.searchIcon} size={11} />
          <input
            ref={searchInputRef}
            className={sidebarStyles.searchInput}
            placeholder="搜索名称、IP..."
            value={searchQuery}
            onChange={e => {
              const t0 = performance.now();
              setSearchQuery(e.target.value);
              console.log(`[Search] input onChange → setSearchQuery done in ${(performance.now() - t0).toFixed(1)}ms`);
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                if (searchQuery) { e.stopPropagation(); setSearchQuery(''); }
                searchInputRef.current?.blur();
              }
            }}
          />
          {searchQuery && (
            <button type="button" className={sidebarStyles.searchClear} onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }} title="清除">
              <FaTimes size={9} />
            </button>
          )}
        </div>

        {/* 树节点 */}
        {filteredRootCategories.map(cat => <CategoryNode key={cat.id} category={cat} {...nodeProps} />)}
        {/* 未分类 */}
        {(filteredUncategorizedServers.length > 0 || !isSearching) && (
          <div className={treeStyles.treeNode}>
            <div className={treeStyles.header} data-active={isUncategorizedActive}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onCategoryContextMenu(e, null); }}>
              {!isSearching && (
                <button type="button" className={treeStyles.expander}
                  onClick={(e) => { e.stopPropagation(); if (filteredUncategorizedServers.length > 0) toggleCategory('__uncategorized__'); }}>
                  {filteredUncategorizedServers.length > 0
                    ? (expandedCategories.has('__uncategorized__') ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />)
                    : <span className={treeStyles.expanderSpacer} />}
                </button>
              )}
              <button type="button" className={treeStyles.headerMain}
                onClick={() => { onSelectCategory(null); if (filteredUncategorizedServers.length > 0 && !expandedCategories.has('__uncategorized__')) toggleCategory('__uncategorized__'); }}>
                {(isSearching || expandedCategories.has('__uncategorized__')) ? <FaFolderOpen className={treeStyles.folderIcon} /> : <FaFolder className={treeStyles.folderIcon} />}
                <div className={treeStyles.nodeBody}>
                  <span className={treeStyles.nodeTitle}>未分类</span>
                  <span className={treeStyles.nodeMeta}>{filteredUncategorizedServers.length} 台服务器</span>
                </div>
              </button>
              {!isSearching && (
                <div className={treeStyles.nodeActions}>
                  <button type="button" className={treeStyles.nodeAction} onClick={(e) => { e.stopPropagation(); onCreateServer(null); }} title="新建服务器">
                    <FaServer size={11} />
                  </button>
                </div>
              )}
            </div>
            {(isSearching || expandedCategories.has('__uncategorized__')) && filteredUncategorizedServers.map(s => (
              <ServerNode key={s.id} server={s} depth={1} activeServer={activeServer}
                onSelectServer={onSelectServer} onConnectServer={onConnectServer} onDisconnectServer={onDisconnectServer}
                onOpenCommandHistory={onOpenCommandHistory} onServerContextMenu={onServerContextMenu} />
            ))}
          </div>
        )}
        {/* 搜索无结果 */}
        {isSearching && filteredRootCategories.length === 0 && filteredUncategorizedServers.length === 0 && (
          <div className={sidebarStyles.searchEmpty}>无匹配结果</div>
        )}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeDragCategory ? (
          <div className={treeStyles.dragOverlay}>
            <FaFolder className={treeStyles.folderIcon} />
            <span className={treeStyles.nodeTitle}>{activeDragCategory.name}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
});
