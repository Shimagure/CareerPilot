import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { apiClient } from '../api/client';
import type { DemoStatus, DemoActionResponse } from '../api/types';

interface DemoModeContextType {
  isDemoMode: boolean;
  demoStatus: DemoStatus | null;
  loading: boolean;
  error: string | null;
  toggleDemoMode: (enable: boolean) => Promise<void>;
  bootstrapDemo: () => Promise<DemoActionResponse | null>;
  resetDemo: () => Promise<DemoActionResponse | null>;
  refreshDemoStatus: () => Promise<void>;
}

const DemoModeContext = createContext<DemoModeContextType | undefined>(undefined);

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [demoStatus, setDemoStatus] = useState<DemoStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshDemoStatus = useCallback(async () => {
    try {
      const status = await apiClient.getDemoStatus();
      setDemoStatus(status);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch demo status');
    }
  }, []);

  const toggleDemoMode = useCallback(async (enable: boolean) => {
    setLoading(true);
    setError(null);
    try {
      if (enable) {
        // Bootstrap demo data
        await apiClient.demoBootstrap();
      } else {
        // Reset demo mode
        await apiClient.demoReset();
      }
      setIsDemoMode(enable);
      await refreshDemoStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle demo mode');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [refreshDemoStatus]);

  const bootstrapDemo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.demoBootstrap();
      setIsDemoMode(true);
      await refreshDemoStatus();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to bootstrap demo');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [refreshDemoStatus]);

  const resetDemo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.demoReset();
      setIsDemoMode(false);
      await refreshDemoStatus();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset demo');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [refreshDemoStatus]);

  // Check demo status on mount
  useEffect(() => {
    refreshDemoStatus();
  }, [refreshDemoStatus]);

  return (
    <DemoModeContext.Provider
      value={{
        isDemoMode,
        demoStatus,
        loading,
        error,
        toggleDemoMode,
        bootstrapDemo,
        resetDemo,
        refreshDemoStatus,
      }}
    >
      {children}
    </DemoModeContext.Provider>
  );
}

export function useDemoMode() {
  const context = useContext(DemoModeContext);
  if (!context) {
    throw new Error('useDemoMode must be used within a DemoModeProvider');
  }
  return context;
}