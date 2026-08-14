import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ConnectServerResult } from '../types/terminal';

export enum OsType {
  Linux = 'linux',
  Windows = 'windows',
}

export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  categoryId?: string;
  status: string;
  osType: OsType;
  authMethod?: 'password' | 'key';
  keyPath?: string;
  proxyJump?: string;
  hasPassword?: boolean;
  hasKeyPassphrase?: boolean;
}

export interface Category {
  id: string;
  name: string;
  parentId?: string;
  order?: number;
}

interface ServerContextType {
  servers: Server[];
  categories: Category[];
  refreshServers: () => Promise<void>;
  refreshCategories: () => Promise<void>;
  addServer: (server: Omit<Server, 'id' | 'status'>) => Promise<void>;
  updateServer: (server: Omit<Server, 'status'>) => Promise<Server>;
  addCategory: (name: string, parentId?: string) => Promise<void>;
  updateCategoryOrder: (items: Array<{ id: string; order: number }>) => Promise<void>;
  moveCategoryToParent: (id: string, newParentId: string | undefined, newOrder: number) => Promise<void>;
  connectToServer: (id: string) => Promise<ConnectServerResult>;
  disconnectServer: (id: string) => Promise<void>;
  closeTerminalSession: (sessionId: string) => Promise<void>;
}

const ServerContext = createContext<ServerContextType | undefined>(undefined);

export const ServerProvider = ({ children }: { children: ReactNode }) => {
  const [servers, setServers] = useState<Server[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refreshServers = useCallback(async () => {
    try {
      const data = await invoke<Server[]>('get_servers');
      if (mountedRef.current) setServers(data);
    } catch (error) {
      console.error('Failed to fetch servers:', error);
    }
  }, []);

  const refreshCategories = useCallback(async () => {
    try {
      const data = await invoke<Category[]>('get_categories');
      if (mountedRef.current) setCategories(data);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  }, []);

  const addServer = useCallback(async (server: Omit<Server, 'id' | 'status'>) => {
    try {
      await invoke('create_server', { ...server });
      await refreshServers();
    } catch (error) {
      console.error("Invoke 'create_server' FAILED:", error);
      throw error;
    }
  }, [refreshServers]);

  const updateServer = useCallback(async (server: Omit<Server, 'status'>) => {
    try {
      const updated = await invoke<Server>('update_server', { ...server });
      await refreshServers();
      return updated;
    } catch (error) {
      console.error("Invoke 'update_server' FAILED:", error);
      throw error;
    }
  }, [refreshServers]);

  const addCategory = useCallback(async (name: string, parentId?: string) => {
    try {
      await invoke('create_category', { name, parentId });
      await refreshCategories();
    } catch (error) {
      console.error("Invoke 'create_category' FAILED:", error);
      throw error;
    }
  }, [refreshCategories]);

  const updateCategoryOrder = useCallback(async (items: Array<{ id: string; order: number }>) => {
    try {
      await invoke('update_category_order', { items });
      await refreshCategories();
    } catch (error) {
      console.error("Invoke 'update_category_order' FAILED:", error);
      throw error;
    }
  }, [refreshCategories]);

  const moveCategoryToParent = useCallback(async (id: string, newParentId: string | undefined, newOrder: number) => {
    try {
      await invoke('move_category', { id, newParentId, newOrder });
      await refreshCategories();
    } catch (error) {
      console.error("Invoke 'move_category' FAILED:", error);
      throw error;
    }
  }, [refreshCategories]);

  const connectToServer = useCallback(async (id: string) => {
    try {
      const result = await invoke<ConnectServerResult>('connect_server', { id });
      // 立即刷新以同步连接状态，不完全依赖事件
      await refreshServers();
      return result;
    } catch (error) {
      console.error('Failed to invoke connect_server:', error);
      throw error;
    }
  }, [refreshServers]);

  const disconnectServer = useCallback(async (id: string) => {
    try {
      await invoke('disconnect_server', { serverId: id });
      // 立即刷新以同步断开状态
      await refreshServers();
    } catch (error) {
      console.error('Failed to invoke disconnect_server:', error);
      throw error;
    }
  }, [refreshServers]);

  const closeTerminalSession = useCallback(async (sessionId: string) => {
    try {
      await invoke('close_terminal_session', { sessionId });
    } catch (error) {
      console.error('Failed to invoke close_terminal_session:', error);
      throw error;
    }
  }, []);

  useEffect(() => {
    refreshServers();
    refreshCategories();

    const unlistenPromise = listen<Server>('server-status-changed', (event) => {
      if (!mountedRef.current) return;
      setServers(prev => {
        const idx = prev.findIndex(s => s.id === event.payload.id);
        if (idx === -1) {
          // 未知 ID — 追加而非丢弃，避免状态不同步
          return [...prev, event.payload];
        }
        const next = [...prev];
        next[idx] = event.payload;
        return next;
      });
    });

    return () => {
      unlistenPromise.then(unlisten => unlisten()).catch(() => {});
    };
  }, [refreshServers, refreshCategories]);

  const value = useMemo(() => ({
    servers, categories, refreshServers, refreshCategories,
    addServer, updateServer, addCategory, updateCategoryOrder, moveCategoryToParent,
    connectToServer, disconnectServer, closeTerminalSession,
  }), [servers, categories, refreshServers, refreshCategories, addServer, updateServer, addCategory, updateCategoryOrder, moveCategoryToParent, connectToServer, disconnectServer, closeTerminalSession]);

  return (
    <ServerContext.Provider value={value}>
      {children}
    </ServerContext.Provider>
  );
};

export const useServer = () => {
  const context = useContext(ServerContext);
  if (context === undefined) {
    throw new Error('useServer must be used within a ServerProvider');
  }
  return context;
};
