import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch, setSessionToken } from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const handleUnauthorized = () => {
      if (active) setUser(null);
    };
    window.addEventListener('Nook:unauthorized', handleUnauthorized);
    apiFetch('/api/auth/me')
      .then((result) => {
        if (active) setUser(result.user);
      })
      .catch(() => {
        setSessionToken('');
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      window.removeEventListener('Nook:unauthorized', handleUnauthorized);
    };
  }, []);

  const signIn = useCallback(async (credential) => {
    const result = await apiFetch('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential }),
      unauthenticated: true,
    });
    setSessionToken(result.token);
    setUser(result.user);
  }, []);

  const signOut = useCallback(() => {
    setSessionToken('');
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, signIn, signOut }), [user, loading, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider.');
  return value;
}
