import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch, setSessionToken } from '../utils/api';

const AuthContext = createContext(null);

// The signed in person is cached next to the session token. The token lives
// in localStorage, so it is already shared by every tab; the cached user lets
// a tab that could not reach the server keep working instead of being signed
// out by a failed check.
const USER_KEY = 'Nook-session-user';

function readCachedUser() {
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.id ? parsed : null;
  } catch {
    return null;
  }
}

function cacheUser(user) {
  try {
    if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(USER_KEY);
  } catch {
    /* the cache is a convenience, not a requirement */
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const handleUnauthorized = () => {
      if (!active) return;
      // The server rejected the token in another tab, so the session is gone.
      cacheUser(null);
      setUser(null);
    };
    window.addEventListener('Nook:unauthorized', handleUnauthorized);

    const finish = () => {
      if (active) setLoading(false);
    };

    // Check the session, but never sign the person out because the server
    // was busy. A rate limit or a dropped connection is not a rejection: the
    // session is only dropped when the server says the token is invalid.
    const checkSession = async (attempt) => {
      try {
        const result = await apiFetch('/api/auth/me');
        if (!active) return;
        cacheUser(result.user);
        setUser(result.user);
        finish();
      } catch (error) {
        if (!active) return;
        if (error?.status === 401) {
          // The server rejected the token, so the session really is gone.
          setSessionToken('');
          cacheUser(null);
          setUser(null);
          finish();
          return;
        }
        // A rate limit or a network error. Try again in a moment, and keep
        // the app loading so it never bounces to the sign in screen.
        if (attempt < 2) {
          window.setTimeout(() => { void checkSession(attempt + 1); }, attempt === 0 ? 2000 : 5000);
          return;
        }
        // Still failing. Keep the saved session so the person stays signed in
        // and the app keeps working.
        const cached = readCachedUser();
        if (cached) setUser(cached);
        else setUser(null);
        finish();
      }
    };

    void checkSession(0);

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
    cacheUser(result.user);
    setUser(result.user);
  }, []);

  const signOut = useCallback(() => {
    setSessionToken('');
    cacheUser(null);
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
