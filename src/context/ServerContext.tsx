import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

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
  password?: string;
}

export interface Category {
  id: string;
  name: string;
  parentId?: string;
}

interface ServerContextType {
  servers: Server[];
  categories: Category[];
  refreshServers: () => Promise<void>;
  refreshCategories: () => Promise<void>;
  addServer: (server: Omit<Server, 'id' | 'status'>) => Promise<void>;
  addCategory: (name: string, parentId?: string) => Promise<void>;
  connectToServer: (id: string) => Promise<void>;
  disconnectServer: (id: string) => Promise<void>; // <-- 新增
}

const ServerContext = createContext<ServerContextType | undefined>(undefined);

export const ServerProvider = ({ children }: { children: ReactNode }) => {
  const [servers, setServers] = useState<Server[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const refreshServers = async () => {
    try {
      const data = await invoke<Server[]>('get_servers');
      setServers(data);
    } catch (error) {
      console.error('Failed to fetch servers:', error);
    }
  };

  const refreshCategories = async () => {
    try {
      const data = await invoke<Category[]>('get_categories');
      setCategories(data);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  };

  const addServer = async (server: Omit<Server, 'id' | 'status'>) => {
    try {
      await invoke('create_server', { ...server });
      await refreshServers();
    } catch (error) {
      console.error("Invoke 'create_server' FAILED:", error);
      throw error;
    }
  };

  const addCategory = async (name: string, parentId?: string) => {
    try {
      await invoke('create_category', { name, parentId });
      await refreshCategories();
    } catch (error) {
      console.error("Invoke 'create_category' FAILED:", error);
      throw error;
    }
  };

  const connectToServer = async (id: string) => {
    try {
      await invoke('connect_server', { id });
    } catch (error) {
      console.error('Failed to invoke connect_server:', error);
      throw error;
    }
  };

  // --- 新增：断开连接 ---
  const disconnectServer = async (id: string) => {
    try {
      // 注意：后端参数名是 serverId (驼峰转下划线后是 server_id)
      await invoke('disconnect_server', { serverId: id });
    } catch (error) {
      console.error('Failed to invoke disconnect_server:', error);
      throw error;
    }
  };

  useEffect(() => {
    refreshServers();
    refreshCategories();

    const unlistenStatus = listen<Server>('server-status-changed', (event) => {
      setServers(prev => prev.map(s => s.id === event.payload.id ? event.payload : s));
    });

    return () => {
      unlistenStatus.then(f => f());
    };
  }, []);

  return (
    <ServerContext.Provider value={{ servers, categories, refreshServers, refreshCategories, addServer, addCategory, connectToServer, disconnectServer }}>
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