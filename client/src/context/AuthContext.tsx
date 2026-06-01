import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

// Tolerate VITE_API_URL with or without the /api suffix (see api/index.ts).
const RAW_BASE = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/+$/, '');
const BASE = /\/api$/.test(RAW_BASE) ? RAW_BASE : `${RAW_BASE}/api`;
const TOKEN_KEY = 'bom_token';
const USER_KEY  = 'bom_user';

export interface AuthUser {
  id:       string | number;
  username: string;
  name:     string;
  role:     string;
}

interface AuthContextValue {
  user:            AuthUser | null;
  token:           string | null;
  isAuthenticated: boolean;
  login:           (username: string, code: string) => Promise<void>;
  logout:          () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user:            null,
  token:           null,
  isAuthenticated: false,
  login:           async () => {},
  logout:          () => {},
});

function readStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user,  setUser]  = useState<AuthUser | null>(readStoredUser);

  // Refresh the cached user from the server whenever we hold a token, so
  // name / role changes (e.g. an admin renaming a user) show up on the
  // next load without forcing a re-login.  Failures are ignored — the
  // cached user keeps working; expired tokens are handled by the API layer.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`${BASE}/users/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (cancelled || !me) return;
        setUser((prev) => {
          const next = {
            ...(prev ?? {}),
            id: me.id, username: me.username, name: me.name, role: me.role,
          } as AuthUser;
          localStorage.setItem(USER_KEY, JSON.stringify(next));
          return next;
        });
      })
      .catch(() => { /* keep cached user on network error */ });
    return () => { cancelled = true; };
  }, [token]);

  const login = useCallback(async (username: string, code: string) => {
    const res = await fetch(`${BASE}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, code }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message ?? 'Login failed');
    }

    const data: { token: string; user: AuthUser } = await res.json();

    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY,  JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isAuthenticated: !!token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
