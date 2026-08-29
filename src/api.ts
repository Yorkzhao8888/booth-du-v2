const BASE = '/api/booth';

function getToken(): string | null {
  return localStorage.getItem('booth_token');
}

interface ApiError extends Error {
  code: number;
  error: string;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  const data = await res.json();

  // For non-login endpoints, 401 means token expired/invalid → clear session & redirect
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    localStorage.removeItem('booth_token');
    localStorage.removeItem('booth_user');
    window.location.href = '/login';
    const err = new Error('Unauthorized') as ApiError;
    err.code = 401;
    err.error = 'Unauthorized';
    throw err;
  }

  if (!res.ok) {
    const err = new Error(data.error || 'Request failed') as ApiError;
    err.code = res.status;
    err.error = data.error || 'Request failed';
    throw err;
  }

  // Unwrap the standard envelope: { success: true, data: <business_body> }
  return (data.data !== undefined ? data.data : data) as T;
}

export function apiGet<T = unknown>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

export function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
}

export function apiPut<T = unknown>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
}

export function apiDelete<T = unknown>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}

// Unified api object for convenience
export const api = {
  get: apiGet,
  post: apiPost,
  put: apiPut,
  delete: apiDelete,
};
