import React, { createContext, useContext, useRef } from 'react';
import { XtermTerminalRef } from '../components/XtermTerminal';

interface TerminalContextType {
  terminalRefs: React.MutableRefObject<Map<string, XtermTerminalRef>>;
}

const TerminalContext = createContext<TerminalContextType | undefined>(undefined);

export const TerminalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const terminalRefs = useRef<Map<string, XtermTerminalRef>>(new Map());

  return (
    <TerminalContext.Provider value={{ terminalRefs }}>
      {children}
    </TerminalContext.Provider>
  );
};

export const useTerminalManager = () => {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminalManager must be used within a TerminalProvider');
  }
  return context;
};