const DEFAULT_BASE = 'http://localhost:3001';

export function getConvertApiBase() {
  const base = import.meta.env.VITE_CONVERT_API_URL || DEFAULT_BASE;
  return base.replace(/\/$/, '');
}

export async function convertApiFetch(path, options = {}) {
  const base = getConvertApiBase();
  const apiKey = import.meta.env.VITE_CONVERT_API_KEY || '';
  const url = `${base}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = { message: text || 'Request failed.' };
  }

  if (!response.ok) {
    const message = data?.message || 'Request failed.';
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export const convertApi = {
  get: (path) => convertApiFetch(path, { method: 'GET' }),
  post: (path, body) => convertApiFetch(path, { method: 'POST', body: JSON.stringify(body) }),
  del: (path) => convertApiFetch(path, { method: 'DELETE' }),
};
