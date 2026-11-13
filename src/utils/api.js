const SESSION_TOKEN_KEY = 'Nook-session-token';
const DEFAULT_API_BASE = 'http://localhost:3001';

export function getApiBase() {
  // VITE_API_URL is the documented name; VITE_CONVERT_API_URL is accepted as
  // an alias so existing local setups keep pointing at the right server.
  const configured = import.meta.env.VITE_API_URL || import.meta.env.VITE_CONVERT_API_URL;
  return String(configured || DEFAULT_API_BASE).replace(/\/+$/, '');
}

export function getSessionToken() {
  return typeof window === 'undefined' ? '' : localStorage.getItem(SESSION_TOKEN_KEY) || '';
}

export function setSessionToken(token) {
  if (typeof window !== 'undefined') {
    if (token) localStorage.setItem(SESSION_TOKEN_KEY, token);
    else localStorage.removeItem(SESSION_TOKEN_KEY);
  }
}

export async function apiFetch(path, options = {}) {
  const { unauthenticated = false, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers || {});
  if (fetchOptions.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = !unauthenticated && getSessionToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${getApiBase()}${path}`, { ...fetchOptions, headers });
  if (response.status === 401 && !unauthenticated) {
    setSessionToken('');
    window.dispatchEvent(new Event('Nook:unauthorized'));
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text || 'Request failed.' };
  }
  if (!response.ok) {
    const error = new Error(data?.error || data?.message || 'Request failed.');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export const api = {
  get: (path) => apiFetch(path),
  post: (path, body) => apiFetch(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  delete: (path) => apiFetch(path, { method: 'DELETE' }),
};

// The converted videos this account still has on the server. The server owns
// the list, so no database is involved.
export function fetchMyStreams() {
  return apiFetch('/api/streams/mine');
}
