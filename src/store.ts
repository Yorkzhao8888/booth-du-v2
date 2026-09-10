import { create } from 'zustand';
import { apiPost } from './api';

export interface AuthUser {
  id: number;
  name: string;
  role: string;
  hats: string[];
  orgId: number;
  orgMode: string;
  /** [BOOTH-PRD-002] DEU 分身标记: DU 以分身身份进入履约铺后台 (会话级, 保留经营决策权) */
  actingAs?: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  /** [BOOTH-PRD-002] DU 履约铺分身切换 (前端视图层; 后端以 X-Acting-As 头同步) */
  actingAsDeu: boolean;
  setActingAsDeu: (on: boolean) => void;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
  hasHat: (hat: string) => boolean;
  canSeePrice: () => boolean;
  canSeeSalePrice: () => boolean;
  isReadOnly: () => boolean;
  fetchUser: () => void;
  /** [AUTH-02] 写入已就绪会话 (dev-token 生成成功后免手动复制) */
  applySession: (token: string, user: AuthUser) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem('booth_token'),
  user: (() => {
    const raw = localStorage.getItem('booth_user');
    return raw ? JSON.parse(raw) as AuthUser : null;
  })(),
  loading: false,
  actingAsDeu: false,

  setActingAsDeu: (on) => set({ actingAsDeu: on }),

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

  applySession: (token, user) => {
    localStorage.setItem('booth_token', token);
    localStorage.setItem('booth_user', JSON.stringify(user));
    set({ token, user });
  },

  hasHat: (hat: string) => {
    const user = get().user;
    return !!user && user.hats.includes(hat);
  },

  canSeePrice: () => {
    const user = get().user;
    if (!!user && user.actingAs === 'deu') return true; // DEU 分身保留经营决策权
    return !!user && (user.role === 'du' || user.role === 'dx' || user.role === 'dm') && user.orgMode === 'du';
  },

  canSeeSalePrice: () => {
    const user = get().user;
    // [PM-004 红线修正] 仅 M 层(dm/du)+X 层管理(dx) 可见售价; EDX(ex)/EDXX(edxx)/emxx 一律不可见; DEU 分身豁免
    if (!!user && user.actingAs === 'deu') return true;
    return !!user && ['du', 'dx', 'dm'].includes(user.role);
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
