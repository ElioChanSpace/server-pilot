import { useState, useRef, useEffect, useCallback } from "react";
import type { TerminalSession } from "../types/terminal";
import type { TerminalOutputState } from "../types/app";

export function useTerminalOutputs(sessionsRef: React.RefObject<TerminalSession[]>) {
  const [terminalOutputs, setTerminalOutputs] = useState<Record<string, TerminalOutputState>>({});
  const pendingTerminalChunksRef = useRef<Record<string, string[]>>({});
  const terminalFlushFrameRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (terminalFlushFrameRef.current !== null) {
        cancelAnimationFrame(terminalFlushFrameRef.current);
        terminalFlushFrameRef.current = null;
      }
    };
  }, []);

  const flushPendingTerminalChunks = useCallback(() => {
    terminalFlushFrameRef.current = null;
    const pendingChunks = pendingTerminalChunksRef.current;
    pendingTerminalChunksRef.current = {};
    const entries = Object.entries(pendingChunks);
    if (entries.length === 0) {
      return;
    }

    setTerminalOutputs(prev => {
      const next = { ...prev };
      for (const [sessionId, chunks] of entries) {
        const existing = next[sessionId];
        next[sessionId] = {
          chunks: [...(existing?.chunks ?? []), ...chunks],
          resetToken: existing?.resetToken ?? 0,
        };
      }
      return next;
    });
  }, []);

  const appendTerminalChunk = useCallback((sessionId: string, chunk: string) => {
    if (!sessionsRef.current?.some(session => session.id === sessionId)) {
      return;
    }

    const pending = pendingTerminalChunksRef.current;
    (pending[sessionId] ??= []).push(chunk);

    if (terminalFlushFrameRef.current !== null) {
      return;
    }

    terminalFlushFrameRef.current = requestAnimationFrame(flushPendingTerminalChunks);
  }, [flushPendingTerminalChunks, sessionsRef]);

  const resetTerminalOutput = useCallback((sessionId: string, initialChunks: string[] = []) => {
    setTerminalOutputs(prev => ({
      ...prev,
      [sessionId]: {
        chunks: initialChunks,
        resetToken: (prev[sessionId]?.resetToken ?? 0) + 1,
      },
    }));
  }, []);

  const removeTerminalOutputs = useCallback((sessionIds: string[]) => {
    if (sessionIds.length === 0) {
      return;
    }

    const removedIds = new Set(sessionIds);
    setTerminalOutputs(prev => {
      const next = { ...prev };
      removedIds.forEach(sessionId => {
        delete next[sessionId];
      });
      return next;
    });
  }, []);

  return {
    terminalOutputs,
    appendTerminalChunk,
    resetTerminalOutput,
    removeTerminalOutputs,
  };
}
