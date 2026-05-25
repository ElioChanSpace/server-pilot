import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface UseInvokeState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useInvoke<T>(command: string, initialData: T | null = null) {
  const [state, setState] = useState<UseInvokeState<T>>({
    data: initialData,
    loading: false,
    error: null,
  });

  const execute = useCallback(async (args?: Record<string, unknown>) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const result = await invoke<T>(command, args);
      setState({ data: result, loading: false, error: null });
      return result;
    } catch (err) {
      const errorMessage = typeof err === 'string' ? err : 'An unknown error occurred';
      setState(prev => ({ ...prev, loading: false, error: errorMessage }));
      throw err;
    }
  }, [command]);

  return { ...state, execute };
}