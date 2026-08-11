import type { TerminalSession } from "../types/terminal";

export interface SessionRemovalOptions {
  preferredNextSessionId?: string | null;
  anchorSessionId?: string | null;
}

export const reindexSessions = (sessionList: TerminalSession[]) => {
  const serverSessionCounts = new Map<string, number>();

  return sessionList.map(session => {
    const nextIndex = (serverSessionCounts.get(session.serverId) ?? 0) + 1;
    serverSessionCounts.set(session.serverId, nextIndex);

    if (session.terminalIndex === nextIndex) {
      return session;
    }

    return {
      ...session,
      terminalIndex: nextIndex,
    };
  });
};

export const resolveNextSessionId = (
  previousSessions: TerminalSession[],
  remainingSessions: TerminalSession[],
  currentSessionId: string | null,
  { preferredNextSessionId = null, anchorSessionId = null }: SessionRemovalOptions = {},
) => {
  if (preferredNextSessionId && remainingSessions.some(session => session.id === preferredNextSessionId)) {
    return preferredNextSessionId;
  }

  if (currentSessionId && remainingSessions.some(session => session.id === currentSessionId)) {
    return currentSessionId;
  }

  const anchorId = anchorSessionId ?? currentSessionId;
  const remainingIds = new Set(remainingSessions.map(session => session.id));

  if (anchorId) {
    const anchorIndex = previousSessions.findIndex(session => session.id === anchorId);

    if (anchorIndex >= 0) {
      for (let index = anchorIndex; index < previousSessions.length; index += 1) {
        const candidateId = previousSessions[index]?.id;
        if (candidateId && remainingIds.has(candidateId)) {
          return candidateId;
        }
      }

      for (let index = anchorIndex - 1; index >= 0; index -= 1) {
        const candidateId = previousSessions[index]?.id;
        if (candidateId && remainingIds.has(candidateId)) {
          return candidateId;
        }
      }
    }
  }

  return remainingSessions.length > 0 ? remainingSessions[remainingSessions.length - 1].id : null;
};
