import React from 'react';
import { Navigate } from 'react-router-dom';
import type { MenuToggleKey } from '../config/menuConfig';
import { MENU_TOGGLES } from '../config/menuConfig';

interface MaybeHiddenRouteProps {
  /** 对应 MENU_TOGGLES 的 flag */
  flag: MenuToggleKey;
  /** 隐藏时的优雅重定向落点（最近可用页） */
  fallback: string;
  children: React.ReactNode;
}

/**
 * [W1-SIMPLIFY] 隐藏入口的直连 URL 守卫：
 * - hidden（flag=false）→ 优雅重定向 fallback（禁止 404/白屏）
 * - toggle 开回（flag=true）→ 渲染原页面（菜单与路由原子恢复）
 */
export const MaybeHiddenRoute: React.FC<MaybeHiddenRouteProps> = ({ flag, fallback, children }) => {
  if (!MENU_TOGGLES[flag]) return <Navigate to={fallback} replace />;
  return <>{children}</>;
};
