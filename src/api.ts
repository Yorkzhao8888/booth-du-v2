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

  if (res.status === 401) {
    localStorage.removeItem('booth_token');
    localStorage.removeItem('booth_user');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  const data = await res.json();

  if (!res.ok) {
    const err = new Error(data.error || 'Request failed') as ApiError;
    err.code = res.status;
    err.error = data.error || 'Request failed';
    throw err;
  }

  return data as T;
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
