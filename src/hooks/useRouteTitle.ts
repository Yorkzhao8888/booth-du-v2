import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
// 路由 → 页面标题映射（⑥ 路由 title 打磨）：前缀最长匹配
const ROUTE_TITLES: Array<[string, string]> = [
  ['/du/onboarding', '开通向导'],
  ['/du/realtime-dashboard', '实时大屏'],
  ['/du/production-orders', '生产单'],
  ['/du/supply-shops', '供给铺管理'],
  ['/du/order-types', '订单类型'],
  ['/du/crafts', '工艺管理'],
  ['/du/fab/equipment', '设备台账'],
  ['/du/fab/score', '供给信用'],
  ['/du/fab/station', '作业站'],
  ['/du/inventory', '库存台账'],
  ['/du/suppliers', '供应商'],
  ['/du/batches', '批次台账'],
  ['/du/orders', '订单管理'],
  ['/du/market-watch', 'Market 观察窗'],
  ['/du', '经营看板'],
  ['/edx/delivery-receipts', '交付回执'],
  ['/edx/production-orders', '交付工作台'],
  ['/edx', '交付工作台'],
  ['/edxx/fab', 'FAB 制造铺'],
  ['/edxx/wh', '仓管铺'],
  ['/edxx/station', '作业站'],
  ['/edxx', '执行工作台'],
  ['/emx/purchase-requests', '采购确认'],
  ['/em/supply-quotes', '供给报价'],
  ['/em', '运营工作台'],
  ['/market', 'Market 通货市场'],
  ['/xhpz', '个人工作台'],
  ['/xepz/hats', '选择视角'],
  ['/xepz/market-watch', 'Market 观察窗'],
  ['/xepz', '企业工作台'],
  ['/xdpz', '经营户工作台'],
  ['/xvpz', '生态治理台'],
  ['/containers', '选择工作台'],
  ['/quickstart', '快速上手']
];

const DEFAULT_TITLE = 'Xfactory · 供给履约系统';

export function useRouteTitle(_pathHint?: string): void {
  void _pathHint;
  const location = useLocation();
  useEffect(() => {
    const hit = ROUTE_TITLES.find(([prefix]) => location.pathname.startsWith(prefix));
    document.title = hit ? `${hit[1]} · Xfactory` : DEFAULT_TITLE;
  }, [location.pathname]);
}
