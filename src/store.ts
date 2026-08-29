import { create } from 'zustand';
import { apiPost } from './api';

export interface AuthUser {
  id: number;
  name: string;
  role: string;
  hats: string[];
  orgId: number;
  orgMode: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
  hasHat: (hat: string) => boolean;
  canSeePrice: () => boolean;
  canSeeSalePrice: () => boolean;
  isReadOnly: () => boolean;
  fetchUser: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem('booth_token'),
  user: (() => {
    const raw = localStorage.getItem('booth_user');
    return raw ? JSON.parse(raw) as AuthUser : null;
  })(),
  loading: false,

  login: async (phone: string, password: string) => {
    set({ loading: true });
    try {
      const res = await apiPost<{ token: string; user: AuthUser }>('/auth/login', { phone, password });
      localStorage.setItem('booth_token', res.token);
      localStorage.setItem('booth_user', JSON.stringify(res.user));
      set({ token: res.token, user: res.user, loading: false });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  logout: () => {
    localStorage.removeItem('booth_token');
    localStorage.removeItem('booth_user');
    set({ token: null, user: null });
  },

  hasHat: (hat: string) => {
    const user = get().user;
    return !!user && user.hats.includes(hat);
  },

  canSeePrice: () => {
    const user = get().user;
    return !!user && (user.role === 'du' || user.role === 'dx' || user.role === 'dm') && user.orgMode === 'du';
  },

  canSeeSalePrice: () => {
    const user = get().user;
    return !!user && ['du', 'dx', 'dm', 'dxx'].includes(user.role);
  },

  isReadOnly: () => {
    const user = get().user;
    return !!user && user.role === 'dm';
  },

  fetchUser: () => {
    const token = localStorage.getItem('booth_token');
    const raw = localStorage.getItem('booth_user');
    if (token && raw) {
      set({ token, user: JSON.parse(raw) as AuthUser });
    }
  },
}));
