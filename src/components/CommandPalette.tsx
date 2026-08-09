import React, { useEffect, useMemo, useRef, useState } from "react";
import { FaFolder, FaServer, FaPlus, FaFolderPlus, FaCog } from "react-icons/fa";
import { Category, Server } from "../context/ServerContext";
import styles from "./CommandPalette.module.css";

interface CommandPaletteProps {
  servers: Server[];
  categories: Category[];
  onConnectServer: (server: Server) => void;
  onSelectCategory: (category: Category | null) => void;
  onNewServer: () => void;
  onNewCategory: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  action: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  servers,
  categories,
  onConnectServer,
  onSelectCategory,
  onNewServer,
  onNewCategory,
  onOpenSettings,
  onClose,
}) => {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo<PaletteItem[]>(() => {
    const normalized = query.trim().toLowerCase();
    const matches = (text: string) => !normalized || text.toLowerCase().includes(normalized);

    const results: PaletteItem[] = [
      {
        id: "new-server",
        label: "新建服务器",
        hint: "操作",
        icon: <FaPlus size={13} />,
        action: onNewServer,
      },
      {
        id: "new-category",
        label: "新建分类",
        hint: "操作",
        icon: <FaFolderPlus size={13} />,
        action: onNewCategory,
      },
      {
        id: "settings",
        label: "打开设置",
        hint: "操作",
        icon: <FaCog size={13} />,
        action: onOpenSettings,
      },
    ];

    categories
      .filter(category => matches(category.name))
      .forEach(category => {
        results.push({
          id: `category-${category.id}`,
          label: category.name,
          hint: "分类",
          icon: <FaFolder size={13} />,
          action: () => onSelectCategory(category),
        });
      });

    servers
      .filter(server => matches(`${server.name} ${server.host} ${server.username}`))
      .forEach(server => {
        results.push({
          id: `server-${server.id}`,
          label: server.name,
          hint: `${server.username}@${server.host}:${server.port}`,
          icon: <FaServer size={13} />,
          action: () => onConnectServer(server),
        });
      });

    return results.filter(item =>
      !normalized || item.label.toLowerCase().includes(normalized) || item.hint.toLowerCase().includes(normalized),
    );
  }, [categories, onConnectServer, onNewCategory, onNewServer, onOpenSettings, onSelectCategory, query, servers]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runItem = (item: PaletteItem | undefined) => {
    if (!item) {
      return;
    }
    item.action();
    onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(prev => Math.min(prev + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(prev => Math.max(prev - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runItem(items[activeIndex]);
    }
  };

  return (
    <div className={styles.overlay} onMouseDown={event => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}>
      <div className={styles.palette}>
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜索服务器、分类或执行操作..."
        />
        <div className={styles.list}>
          {items.length === 0 ? (
            <div className={styles.empty}>没有匹配的结果</div>
          ) : (
            items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={styles.item}
                data-active={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runItem(item)}
              >
                <span className={styles.itemIcon}>{item.icon}</span>
                <span className={styles.itemLabel}>{item.label}</span>
                <span className={styles.itemHint}>{item.hint}</span>
              </button>
            ))
          )}
        </div>
        <div className={styles.footer}>
          <span>↑↓ 选择</span>
          <span>Enter 执行</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
};
