import { useState, useRef, useEffect, useCallback } from "react";
import type { TerminalSession } from "../types/terminal";
import type { TerminalOutputState } from "../types/app";

/**
 * Upper bound of chunks kept per session in React state. The visible scrollback
 * is limited by xterm anyway; this cap prevents unbounded memory growth on long
 * busy sessions (build logs, yes, ...) while keeping enough headroom for the
 * xterm scrollback buffer.
 */
const MAX_CHUNKS_PER_SESSION = 4000;

function appendCapped(
  existing: TerminalOutputState | undefined,
  chunks: string[],
): TerminalOutputState {
  const base: TerminalOutputState = existing ?? {
    chunks: [],
    resetToken: 0,
    droppedChunks: 0,
  };
  const merged = [...base.chunks, ...chunks];
  if (merged.length <= MAX_CHUNKS_PER_SESSION) {
    return { ...base, chunks: merged };
  }
  const overflow = merged.length - MAX_CHUNKS_PER_SESSION;
  return {
    ...base,
    chunks: merged.slice(overflow),
    droppedChunks: base.droppedChunks + overflow,
  };
}

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
        next[sessionId] = appendCapped(next[sessionId], chunks);
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
    // Drop chunks queued before the reset so they cannot leak into the new buffer.
    delete pendingTerminalChunksRef.current[sessionId];
    setTerminalOutputs(prev => ({
      ...prev,
      [sessionId]: {
        chunks: initialChunks,
        resetToken: (prev[sessionId]?.resetToken ?? 0) + 1,
        droppedChunks: 0,
      },
    }));
  }, []);

  const removeTerminalOutputs = useCallback((sessionIds: string[]) => {
    if (sessionIds.length === 0) {
      return;
    }

    const removedIds = new Set(sessionIds);
    for (const sessionId of sessionIds) {
      delete pendingTerminalChunksRef.current[sessionId];
    }
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
