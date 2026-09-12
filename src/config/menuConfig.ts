/**
 * [W1-A] 菜单收敛 41→16 —— 配置驱动的 feature toggle（不删码，每项可独立开回）
 *
 * 口径：
 * - 延后隐藏（12 条目）：毛利核算/智能补货/履约追踪/订单类型配置/角色权限/组织架构/实时大屏/
 *   OEE 稼动率/采集看板/保养日历/安灯异常中心/四仓看板+效期管控+库存预警（收敛进 WH 批次页 tab）
 * - 待契约隐藏（3 项）：Market 通货 / 供应铺管理（MKT 铺子管理）/ 供给报价（SVC）
 * - 合并：FAB 产线四页 → 作业流视图（fabZones toggle 控制原四页入口与路由）
 * - toggle 置 true = 菜单项与直连路由同步恢复（AppLayout 与 App.tsx 共用本文件的判定）
 */

export const MENU_TOGGLES: Record<string, boolean> = {
  // —— 延后隐藏（经营域）
  profit: false, // 毛利核算
  replenishment: false, // 智能补货
  fulfillmentTrack: false, // 履约追踪
  orderTypes: false, // 订单类型配置
  roles: false, // 角色权限（先收为只读模板）
  orgChart: false, // 组织架构
  realtimeDashboard: false, // 实时大屏
  // —— 延后隐藏（作业域）
  oee: false, // OEE 稼动率
  telemetry: false, // 采集看板
  maintenance: false, // 保养日历
  andon: false, // 安灯异常中心
  // —— 延后隐藏（WH 收敛：四仓看板/效期管控/库存预警 → WH 批次页 tab）
  whSubPages: false,
  // —— 待契约隐藏
  market: false, // Market 通货
  supplyShops: false, // 供应铺管理（MKT 铺子管理）
  supplyQuotes: false, // 供给报价（SVC）
  // —— 合并视图（FAB 产线四页 → 作业流）
  fabZones: false,
};

export type MenuToggleKey = keyof typeof MENU_TOGGLES;

/** 隐藏后直连 URL 的优雅重定向落点（最近可用页，禁止 404/白屏） */
export const HIDDEN_FALLBACKS: Record<string, string> = {
  '/du/profit': '/du',
  '/du/replenishment': '/du',
  '/du/fulfillment-track': '/du/orders',
  '/du/order-types': '/du',
  '/du/roles': '/du',
  '/du/realtime-dashboard': '/du',
  '/du/org-chart': '/du',
  '/du/supply-shops': '/du',
  '/du/supply-quotes': '/du/svc',
  '/du/inventory-alerts': '/du/batches?tab=alerts',
  '/du/expiry-control': '/du/batches?tab=expiry',
  '/du/wh/warehouse-dashboard': '/du/batches?tab=wh',
  '/market': '/du',
};

/** 精确路径 → toggle flag */
const PATH_FLAG_MAP: Record<string, string> = {
  '/du/profit': 'profit',
  '/du/replenishment': 'replenishment',
  '/du/fulfillment-track': 'fulfillmentTrack',
  '/du/order-types': 'orderTypes',
  '/du/roles': 'roles',
  '/du/realtime-dashboard': 'realtimeDashboard',
  '/du/org-chart': 'orgChart',
  '/du/supply-shops': 'supplyShops',
  '/du/supply-quotes': 'supplyQuotes',
  '/du/inventory-alerts': 'whSubPages',
  '/du/expiry-control': 'whSubPages',
  '/du/wh/warehouse-dashboard': 'whSubPages',
  '/market': 'market',
};

/** FAB 域按 fabBase 变体的后缀匹配（du/ex/em/edxx 四树共用） */
const SUFFIX_FLAG_MAP: Array<[string, string]> = [
  ['/equipment/oee', 'oee'],
  ['/telemetry', 'telemetry'],
  ['/maintenance', 'maintenance'],
  ['/andon', 'andon'],
];

/**
 * 菜单项/路由是否处于隐藏态（toggle=false 时隐藏）。
 * - 精确路径走 PATH_FLAG_MAP
 * - FAB 域变体路径走后缀匹配
 * - FAB 产线四页（/zone/:stage）由 fabZones flag 控制
 */
export function isPathHidden(path: string): boolean {
  if (!path) return false;
  if (path.includes('/zone/')) return !MENU_TOGGLES.fabZones;
  const flag = PATH_FLAG_MAP[path];
  if (flag) return !MENU_TOGGLES[flag];
  for (const [suffix, f] of SUFFIX_FLAG_MAP) {
    if (path.endsWith(suffix)) return !MENU_TOGGLES[f];
  }
  return false;
}

/** 隐藏路由的默认重定向落点（供 App.tsx / MaybeHiddenRoute 使用；未知路径回 /du） */
export function fallbackForPath(path: string): string {
  return HIDDEN_FALLBACKS[path] || '/du';
}
