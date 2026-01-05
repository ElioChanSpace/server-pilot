import { useState, useRef, useEffect } from "react";
import { ServerProvider, Server, Category, useServer } from "./context/ServerContext";
import { AddServerModal } from "./components/AddServerModal";
import { AddCategoryModal } from "./components/AddCategoryModal";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { BottomBar } from "./components/BottomBar";
import { MainContent } from "./components/MainContent";
import { ContextMenu, ContextMenuAction } from "./components/ContextMenu";
import { FaPlus, FaFolderPlus } from 'react-icons/fa';
import "./App.css";

const MenuBar: React.FC<{
  onNewCategory: () => void;
  onNewServer: () => void;
}> = ({ onNewCategory, onNewServer }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleItemClick = (action: () => void) => {
    action();
    setIsMenuOpen(false);
  };

  return (
    <div className="menuBar">
      <div className="menuItem" ref={menuRef}>
        <button 
          className="menuButton" 
          onClick={() => setIsMenuOpen(prev => !prev)}
          data-active={isMenuOpen}
        >
          File
        </button>
        {isMenuOpen && (
          <div className="dropdown">
            <button className="dropdownItem" onClick={() => handleItemClick(onNewCategory)}>
              New Category...
            </button>
            <button className="dropdownItem" onClick={() => handleItemClick(onNewServer)}>
              New Server...
            </button>
            <div className="separator" />
            <button className="dropdownItem" onClick={() => window.close()}>
              Quit
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

interface ContextMenuState {
  x: number;
  y: number;
  actions: ContextMenuAction[];
}

const AppContent: React.FC = () => {
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  const [activeServer, setActiveServer] = useState<Server | null>(null);
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [connectingServer, setConnectingServer] = useState<Server | null>(null);

  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [initialCategoryId, setInitialCategoryId] = useState<string | undefined>(undefined);
  const [initialParentId, setInitialParentId] = useState<string | undefined>(undefined);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const { connectToServer } = useServer();

  const handleSelectServer = (server: Server) => {
    setActiveServer(server);
    setActiveCategory(null);
    setConnectingServer(null);
  };

  const handleConnectServer = (server: Server) => {
    setConnectingServer(server);
    connectToServer(server.id);
  };

  const handleSelectCategory = (category: Category | null) => {
    setActiveCategory(category);
    setActiveServer(null);
    setConnectingServer(null);
  };

  const handleCategoryContextMenu = (event: React.MouseEvent, category: Category | null) => {
    const actions: ContextMenuAction[] = [
      {
        label: "New Server",
        icon: <FaPlus />,
        action: () => {
          setInitialCategoryId(category?.id);
          setIsServerModalOpen(true);
        }
      },
      {
        label: "New Sub-Category",
        icon: <FaFolderPlus />,
        action: () => {
          setInitialParentId(category?.id);
          setIsCategoryModalOpen(true);
        }
      }
    ];

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      actions: actions
    });
  };

  const closeContextMenu = () => setContextMenu(null);

  useEffect(() => {
    if (contextMenu) {
      window.addEventListener('click', closeContextMenu);
      return () => window.removeEventListener('click', closeContextMenu);
    }
  }, [contextMenu]);

  return (
    <div className="app-wrapper" onContextMenu={(e) => e.preventDefault()}>
      <MenuBar 
        onNewCategory={() => {
          setInitialParentId(undefined);
          setIsCategoryModalOpen(true);
        }}
        onNewServer={() => {
          setInitialCategoryId(undefined);
          setIsServerModalOpen(true);
        }}
      />
      <div className="content-wrapper">
        <LeftSidebar 
          isOpen={isLeftSidebarOpen} 
          activeServer={activeServer}
          activeCategory={activeCategory}
          onSelectServer={handleSelectServer}
          onSelectCategory={handleSelectCategory}
          onCategoryContextMenu={handleCategoryContextMenu}
          onDoubleClickServer={handleConnectServer}
        />
        <MainContent activeView="dashboard" activeCategory={activeCategory} connectingServer={connectingServer} />
        <RightSidebar isOpen={isRightSidebarOpen} activeServer={activeServer} />
      </div>
      <BottomBar 
        isLeftSidebarOpen={isLeftSidebarOpen}
        isRightSidebarOpen={isRightSidebarOpen}
        toggleLeftSidebar={() => setIsLeftSidebarOpen(prev => !prev)}
        toggleRightSidebar={() => setIsRightSidebarOpen(prev => !prev)}
      />
      {isServerModalOpen && <AddServerModal onClose={() => setIsServerModalOpen(false)} initialCategoryId={initialCategoryId} />}
      {isCategoryModalOpen && <AddCategoryModal onClose={() => setIsCategoryModalOpen(false)} parentId={initialParentId} />}
      {contextMenu && <ContextMenu {...contextMenu} onClose={closeContextMenu} />}
    </div>
  );
}

function App() {
  return (
    <ServerProvider>
      <AppContent />
    </ServerProvider>
  );
}

export default App;