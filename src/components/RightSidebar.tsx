import React from "react";
import { FaFolderOpen, FaInfoCircle, FaServer } from "react-icons/fa";
import { Category, Server, useServer } from "../context/ServerContext";
import styles from "./RightSidebar.module.css";
import ServerDetails from "./ServerDetails";

interface RightSidebarProps {
  isOpen: boolean;
  activeServer: Server | null;
  activeCategory: Category | null;
  isUncategorizedSelected: boolean;
  connectionError: string | null;
  onConnectServer: (server: Server) => void;
  onDisconnectServer: (server: Server) => void;
  onDismissError: () => void;
  onViewLogs: (server: Server) => void;
}

const formatServerStatus = (status: string) => {
  switch (status) {
    case 'connected':
      return '已连接';
    case 'connecting':
      return '连接中';
    case 'disconnected':
      return '未连接';
    default:
      return status;
  }
};

const RightSidebarComponent: React.FC<RightSidebarProps> = ({
  isOpen,
  activeServer,
  activeCategory,
  isUncategorizedSelected,
  connectionError,
  onConnectServer,
  onDisconnectServer,
  onDismissError,
  onViewLogs,
}) => {
  const { categories, servers } = useServer();

  const selectedCategoryId = activeCategory?.id ?? null;
  const descendantCategoryIds = React.useMemo(() => {
    if (!selectedCategoryId) {
      return [];
    }

    const results: string[] = [];
    const queue = [selectedCategoryId];
    const visited = new Set(queue);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      categories
        .filter(category => category.parentId === currentId)
        .forEach(category => {
          if (!visited.has(category.id)) {
            visited.add(category.id);
            results.push(category.id);
            queue.push(category.id);
          }
        });
    }

    return results;
  }, [categories, selectedCategoryId]);

  const visibleServers = React.useMemo(() => {
    if (activeServer) {
      return [];
    }

    if (isUncategorizedSelected) {
      return servers.filter(server => !server.categoryId);
    }

    if (!activeCategory) {
      return [];
    }

    const availableIds = new Set([activeCategory.id, ...descendantCategoryIds]);
    return servers.filter(server => server.categoryId && availableIds.has(server.categoryId));
  }, [activeCategory, activeServer, descendantCategoryIds, isUncategorizedSelected, servers]);

  const connectedCount = visibleServers.filter(server => server.status === "connected").length;
  const childCategoryCount = activeCategory
    ? categories.filter(category => category.parentId === activeCategory.id).length
    : 0;

  return (
    <div
      className={styles.rightSidebar}
      data-closed={!isOpen}
    >
      <div className={styles.content}>
        {connectionError && (
          <div className={styles.errorBanner}>
            <div>
              <p className={styles.errorTitle}>连接失败</p>
              <p className={styles.errorMessage}>{connectionError}</p>
            </div>
            <button type="button" className={styles.errorClose} onClick={onDismissError}>
              关闭
            </button>
          </div>
        )}
        {activeServer ? (
          <ServerDetails
            server={activeServer}
            onConnectServer={onConnectServer}
            onDisconnectServer={onDisconnectServer}
            connectionError={connectionError}
            onDismissError={onDismissError}
            onViewLogs={onViewLogs}
          />
        ) : activeCategory || isUncategorizedSelected ? (
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div className={styles.panelIcon}>
                <FaFolderOpen />
              </div>
              <div>
                <p className={styles.panelEyebrow}>当前分组</p>
                <h3 className={styles.panelTitle}>{activeCategory?.name ?? "未分类"}</h3>
                <p className={styles.panelDescription}>
                  这里显示当前文件夹下的服务器规模与连接情况，便于先选分组再决定要连接的机器。
                </p>
              </div>
            </div>

            <div className={styles.summaryGrid}>
              <div className={styles.summaryCard}>
                <span className={styles.summaryLabel}>服务器总数</span>
                <strong className={styles.summaryValue}>{visibleServers.length}</strong>
              </div>
              <div className={styles.summaryCard}>
                <span className={styles.summaryLabel}>已连接</span>
                <strong className={styles.summaryValue}>{connectedCount}</strong>
              </div>
              <div className={styles.summaryCard}>
                <span className={styles.summaryLabel}>子分类</span>
                <strong className={styles.summaryValue}>{childCategoryCount}</strong>
              </div>
            </div>

            <div className={styles.listSection}>
              <h4 className={styles.sectionTitle}>本组服务器</h4>
              {visibleServers.length > 0 ? (
                <div className={styles.serverList}>
                  {visibleServers.slice(0, 6).map(server => (
                    <div key={server.id} className={styles.serverListItem}>
                      <div>
                        <div className={styles.serverNameRow}>
                          <FaServer className={styles.inlineIcon} />
                          <span>{server.name}</span>
                        </div>
                        <p className={styles.serverMeta}>{server.username}@{server.host}:{server.port}</p>
                      </div>
                      <span className={styles.serverState} data-status={server.status}>
                        {formatServerStatus(server.status)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.emptyText}>当前分组还没有服务器，适合先新增一台服务器或继续整理分类结构。</p>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.placeholder}>
            <div className={styles.placeholderCard}>
              <FaInfoCircle className={styles.placeholderIcon} />
              <p>先在左侧选择一个文件夹或服务器，这里会展示更符合操作流程的详情与建议。</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const RightSidebar = React.memo(RightSidebarComponent);
