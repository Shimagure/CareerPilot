import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { apiClient } from '../api/client';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  created_at: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: (tokenOverride?: string) => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Token storage key
const TOKEN_KEY = 'careerpilot_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Synchronize auth state when the API client detects an expired/invalid token.
  useEffect(() => {
    const onUnauthorized = () => {
      setToken(null);
      setUser(null);
    };
    window.addEventListener('careerpilot:unauthorized', onUnauthorized);
    return () => window.removeEventListener('careerpilot:unauthorized', onUnauthorized);
  }, []);

  // Initialize auth state from localStorage on mount
  useEffect(() => {
    const initAuth = async () => {
      const storedToken = localStorage.getItem(TOKEN_KEY);
      if (storedToken) {
        setToken(storedToken);
        // Set the token in the apiClient for subsequent requests
        apiClient.instance.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
        try {
          await refreshUser(storedToken);
        } catch {
          // Token invalid or expired, clear it
          await logout();
        }
      }
      setLoading(false);
    };
    initAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshUser = useCallback(async (tokenOverride?: string) => {
    // token state is stale right after setToken(), so read the active token
    // explicitly rather than from the closure
    const activeToken = tokenOverride ?? token;
    if (!activeToken) return;
    try {
      const response = await apiClient.instance.get('/api/auth/me');
      setUser(response.data.user);
      setError(null);
    } catch (err) {
      throw err;
    }
  }, [token]);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.instance.post('/api/auth/login', { email, password });
      const { access_token } = response.data;
      setToken(access_token);
      localStorage.setItem(TOKEN_KEY, access_token);
      apiClient.instance.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
      await refreshUser(access_token);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [refreshUser]);

  const register = useCallback(async (name: string, email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.instance.post('/api/auth/register', { name, email, password });
      const { access_token } = response.data;
      setToken(access_token);
      localStorage.setItem(TOKEN_KEY, access_token);
      apiClient.instance.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
      await refreshUser(access_token);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [refreshUser]);

  const logout = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Call logout endpoint (optional, for API consistency)
      if (token) {
        try {
          await apiClient.instance.post('/api/auth/logout');
        } catch {
          // Ignore logout endpoint errors
        }
      }
    } finally {
      // Clear local state regardless of API call result
      setToken(null);
      setUser(null);
      localStorage.removeItem(TOKEN_KEY);
      delete apiClient.instance.defaults.headers.common['Authorization'];
      setLoading(false);
    }
  }, [token]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const isAuthenticated = !!token && !!user;

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated,
        loading,
        error,
        login,
        register,
        logout,
        refreshUser,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}