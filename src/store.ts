import { create } from 'zustand';
import { apiPost } from './api';
import type { ContainerKey, ContainerAccess } from './types/containers';

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
  /** [DUAL-PORTAL-P0/XDP-ECO] 当前容器 (#xhpz 个人 / #xepz 企业 / #xdpz 经营户 / #xvpz 平台方) */
  container: ContainerKey | null;
  /** [DUAL-PORTAL-P0] 当前帽(角色视角); 切换角色=清空重建 */
  hat: string | null;
  /** [DUAL-PORTAL-P0] 容器可进性缓存 (会话级, /auth/containers 结果) */
  containers: ContainerAccess | null;
  setContainers: (c: ContainerAccess) => void;
  setContainer: (c: ContainerKey) => void;
  setHat: (hat: string | null) => void;
  /** 切换角色: 视角状态清空重建 (回角色选择页重进) */
  resetPerspective: () => void;
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
  container: (localStorage.getItem('booth_container') as ContainerKey | null) || null,
  hat: localStorage.getItem('booth_hat') || null,
  containers: null,

  setActingAsDeu: (on) => set({ actingAsDeu: on }),

  setContainers: (containers) => set({ containers }),

  setContainer: (container) => {
    localStorage.setItem('booth_container', container);
    set({ container });
  },

  setHat: (hat) => {
    if (hat) localStorage.setItem('booth_hat', hat);
    else localStorage.removeItem('booth_hat');
    set({ hat });
  },

  // [DUAL-PORTAL-P0] 切换角色=视角状态清空重建 (回角色选择页重进)
  resetPerspective: () => {
    localStorage.removeItem('booth_hat');
    set({ hat: null });
  },

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
    localStorage.removeItem('booth_container');
    localStorage.removeItem('booth_hat');
    set({ token: null, user: null, container: null, hat: null, containers: null });
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
