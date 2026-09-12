import React, { useMemo, useState } from 'react';
import { Layout, Menu, Button, Dropdown, Space, Drawer, Grid, Tooltip } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  DashboardOutlined,
  ShoppingCartOutlined,
  ToolOutlined,
  InboxOutlined,
  ProfileOutlined,
  LogoutOutlined,
  UserOutlined,
  AppstoreOutlined,
  TagsOutlined,
  DollarOutlined,
  CarOutlined,
  CustomerServiceOutlined,
  DatabaseOutlined,
  AuditOutlined,
  SendOutlined,
  ShopOutlined,
  ExperimentOutlined,
  HomeOutlined,
  TruckOutlined,
  HeartOutlined,
  ApartmentOutlined,
  CalendarOutlined,
  HeatMapOutlined,
  DeliveredProcedureOutlined,
  QuestionCircleOutlined,
  MenuOutlined
} from '@ant-design/icons';
import { useAuthStore } from '../store';
import { useRouteTitle } from '../hooks/useRouteTitle';

const { Header, Sider, Content } = Layout;

// 五大供给功能域菜单结构
// MKT 铺子管理 / FAB 制造铺 / WH 仓管铺 / DL 物流铺 / SVC 服务铺

const getMenuItemsByRole = (role: string, actingDeuMode = false) => {
  const canSeePrice = ['du', 'dx', 'dm'].includes(role);
  const canWrite = ['du', 'dx', 'emxx', 'ex', 'edxx'].includes(role);
  const isReadOnly = role === 'dm';

  // MKT 铺子管理
  const mktItems = {
    key: 'mkt',
    icon: <ShopOutlined />,
    label: 'MKT 铺子管理',
    children: [
      // /du/* 管理项仅对决策/管理层展示（edx 守卫仅放行 /edx，edx/edxx 点 /du/* 会被 RequireAuth 弹回）
      ...(['du', 'dx', 'dm'].includes(role) ? [
        { key: '/du', label: '经营看板' },
        { key: '/du/orders', label: '订单管理' },
        { key: '/du/purchase-orders', label: '采购管理' },
        { key: '/du/profit', label: '毛利核算' },
        { key: '/du/boms', label: '商品/BOM' },
        { key: '/du/replenishment', label: '智能补货' },
        { key: '/du/suppliers', label: '供应商管理' },
        { key: '/du/fulfillment-track', label: '履约追踪' },
        { key: '/du/production-orders', label: '生产单全链路' }, // [BOOTH-PRD-001]
        { key: '/du/crafts', label: '工艺管理' }, // [BOOTH-PRD-003 RD-005]
        { key: '/du/supply-shops', label: '供应铺管理' }, // [BOOTH-PRD-002 PM-001]
        { key: '/du/order-types', label: '订单类型配置' }, // [BOOTH-PRD-002 PM-002]
        ...(['du', 'dx', 'dm'].includes(role) ? [{ key: '/du/roles', label: '角色权限' }] : []), // [BOOTH-PRD-002 PM-004]
        { key: '/du/inventory-transfer', label: '库存调拨' },
        { key: '/du/realtime-dashboard', label: '实时大屏' },
        { key: '/du/org-chart', label: '组织架构' },
        ...(['du', 'dm'].includes(role) ? [{ key: '/du/employees', label: '员工管理' }] : []),
      ] : []),
      // edx 自有路由项（/edx/skus、/edx/boms 已在 App.tsx 注册）
      ...(role === 'ex' ? [{ key: '/ex/skus', label: 'SKU管理' }] : []),
      ...(role === 'ex' ? [{ key: '/ex/crafts', label: '工艺管理' }] : []), // [BOOTH-PRD-003 RD-005]
      ...(role === 'ex' ? [{ key: '/ex/boms', label: 'BOM管理' }] : []),
    ].map(item => ({
      ...item,
      label: isReadOnly && !item.label.includes('只读') && item.key !== '/du/org-chart' && item.key !== '/du/employees'
        ? `${item.label}（只读）`
        : item.label,
    })),
  };

  // FAB 制造铺 - 工单视角
  const fabOrderItems = {
    key: 'fab-orders',
    icon: <ExperimentOutlined />,
    label: 'FAB 工单视角',
    children: [
      ...(role === 'ex' ? [
        { key: '/ex/work-orders', label: '工单调度' },
      ] : []),
      ...(role === 'edxx' ? [
        { key: '/edxx/fab/queue', label: '待接单' },
        { key: '/edxx/fab/active', label: '制作中' },
        { key: '/edxx/fab/operations', label: '工序报工' },
        { key: '/edxx/fab/dashboard', label: '产线看板' },
        { key: '/edxx/fab/yield', label: '良品率追踪' },
        { key: '/edxx/qc', label: '质检任务' },
        { key: '/edxx/fab/trace', label: '追溯查询' },
        { key: '/edxx/fab/defects', label: '不良分析' },
        { key: '/edxx/fab/history', label: '历史工单' },
      ] : []),
      ...(['du', 'dx', 'dm'].includes(role) ? [
        { key: '/du/work-orders', label: '工单管理' },
      ] : []),
    ],
  };

  // FAB 制造铺 - 产线视角（四大生产区只读看板）——全角色可见（FAB-MES-03-FIX3: 保留可见+可进入+只读）
  // key 前缀按角色: du/dx/dm→/du/fab, edx→/edx/fab, edxx→/edxx/fab（各自 RequireAuth 放行前缀, 绝不弹回）
  const fabBase = role === 'edxx' ? '/edxx/fab' : role === 'ex' ? '/ex/fab' : role === 'em' ? '/em/fab' : '/du/fab';
  const fabZoneItems = {
    key: 'fab-zones',
    icon: <ApartmentOutlined />,
    label: 'FAB 产线视角',
    children: [
      { key: `${fabBase}/zone/preprocessing`, label: '前置工序' },
      { key: `${fabBase}/zone/production`, label: '制作' },
      { key: `${fabBase}/zone/packaging`, label: '包装' },
      { key: `${fabBase}/zone/sorting`, label: '分拣' },
    ],
  };

  // FAB 制造铺（合并）
  const fabItems = {
    key: 'fab',
    icon: <ExperimentOutlined />,
    label: 'FAB 制造铺',
    children: [
      ...fabOrderItems.children,
      { type: 'divider' as const },
      { key: 'fab-zone-group', label: '产线视角', type: 'group' as const, children: fabZoneItems.children },
      { type: 'divider' as const },
      { key: `${fabBase}/station`, label: 'Station 作业站' },
      { key: `${fabBase}/equipment`, label: '设备台账' },
      { key: `${fabBase}/equipment/oee`, label: 'OEE 稼动率' },
      { key: `${fabBase}/telemetry`, label: '采集看板' },
      { key: `${fabBase}/score`, label: '供给信用' },
      { key: `${fabBase}/maintenance`, label: '保养日历' },
      { key: `${fabBase}/andon`, label: '安灯异常中心' },
      ...(role === 'edxx'
        ? [
            { type: 'divider' as const },
            { key: `${fabBase}/plugins`, label: '能力市场' },
          ]
        : []),
    ],
  };

  // WH 仓管铺（供给视角）
  const whItems = {
    key: 'wh',
    icon: <HomeOutlined />,
    label: 'WH 供给铺',
    children: [
      // 管理视角仅 du/dx/dm（守卫放行 /du）；edx/edxx 点 /du/* 会被 RequireAuth 弹回首页
      ...(['du', 'dx', 'dm'].includes(role) ? [
        { key: '/du/batches', label: '批次库存' },
        { key: '/du/inventory', label: '库存总览' },
        { key: '/du/inventory-alerts', label: '库存预警' },
        { key: '/du/inventory-transfer', label: '库存调拨' },
        { key: '/du/expiry-control', label: '效期管控' },
        { key: '/du/wh/warehouse-dashboard', label: '四仓看板' },
        { key: '/du/supply-orders', label: '供给订单' },
      ] : []),
      ...(role === 'ex' ? [{ key: '/ex/stocktakes', label: '盘点审批' }, { key: '/ex/capacity', label: '产能查询' }, { key: '/ex/supply-quotes', label: '供给报价' }] : []),
      ...(role === 'edxx' ? [
        { key: '/edxx/stocktake', label: '盘点执行' },
        { key: '/edxx/wh/inbound', label: '入库' },
        { key: '/edxx/wh/outbound', label: '出库' },
        { type: 'divider' },
        { key: 'wh-supply-group', label: '供给执行', type: 'group', children: [
          { key: '/edxx/wh/supply-orders', label: '供给单' },
          { key: '/edxx/wh/supply-line-feed', label: '补给产线' },
          { key: '/edxx/wh/device-supply', label: '设备供给' },
          { key: '/edxx/wh/plaza-supply', label: '场地供给' },
        ]},
      ] : []),
    ],
  };

  // DL 物流铺
  const dlItems = {
    key: 'dl',
    icon: <TruckOutlined />,
    label: 'DL 物流铺',
    children: [
      ...(['du', 'dx', 'dm'].includes(role) ? [{ key: '/du/dl', label: '配送任务' }] : []),
      ...(role === 'ex' ? [{ key: '/ex/dl-dispatch', label: '配送派单' }] : []),
      ...(role === 'edxx' ? [{ key: '/edxx/dl', label: '配送执行' }] : []),
    ],
  };

  // SVC 服务铺
  const svcItems = {
    key: 'svc',
    icon: <HeartOutlined />,
    label: 'SVC 服务铺',
    children: [
      ...(['du', 'dx', 'dm'].includes(role) ? [{ key: '/du/svc', label: '服务任务' }] : []),
      ...(['du', 'dx'].includes(role) ? [{ key: '/du/supply-quotes', label: '供给报价' }] : []),
      ...(role === 'ex' ? [{ key: '/ex/svc-dispatch', label: '服务派单' }] : []),
      ...(role === 'edxx' ? [{ key: '/edxx/svc', label: '服务执行' }] : []),
    ],
  };

  // EM 全局供应链层（仅 EM 角色可见）
  const emItems = {
    key: 'em',
    icon: <AppstoreOutlined />,
    label: 'EM 供应链',
    children: [
      { key: '/em', label: '供应链概览' },
      { key: '/em/admissions', label: '供应商准入' },
      { key: '/em/strategies', label: '供给策略' },
      { key: '/em/capacity-plans', label: '产能规划' },
      { key: '/em/capacity-resources', label: '产能资源' },
      { key: '/em/atp-commitments', label: 'ATP承诺' },
      { key: '/em/sgu-catalog', label: 'SGU目录' },
      { key: '/em/sgu-listings', label: '挂牌管理' },
      { key: '/em/sgu-pending', label: 'SKU待办' },
      { key: '/em/supply-quotes', label: '供给报价' },
    ],
  };

  // C3 Market 通货售卖（EM/DU/DX/DM 可见）
  const marketItems = {
    key: 'market',
    icon: <DollarOutlined />,
    label: 'Market 通货',
    children: [
      { key: '/market', label: '通货市场' },
    ],
  };

  // 按角色过滤菜单
  const items = [];

  // [BOOTH-PRD-002 PM-004] DEU = DU 履约铺分身 (非独立角色): 分身态菜单 = EDX(ex) 执行视图 + DU 经营决策项
  if (role === 'du' && actingDeuMode) {
    items.push(mktItems, fabItems, whItems, dlItems, svcItems);
    items.push({ key: 'deu-decision', icon: <ShoppingCartOutlined />, label: '经营决策 (DEU)', children: [
      { key: '/du/production-orders', label: '生产单全链路' },
    ] });
  }
  // EM 角色：EM 供应链 + 产线只读监控 (FAB-MES-04-FIX4) + Market
  else if (role === 'em') {
    items.push(emItems, fabItems, marketItems);
  }
  // DM/DU/DX 可以看到所有五个域 + Market
  else if (['dm', 'du', 'dx'].includes(role)) {
    items.push(mktItems, fabItems, whItems, dlItems, svcItems, marketItems);
  }
  // EMXX 一线经营：MKT（只读）+ WH + DL + SVC
  else if (role === 'emxx') {
    items.push(
      // emxx 守卫仅放行 /emxx 与 /edxx；收敛后 mkt/wh/dl/svc 对 emxx 均为空组，会被末尾 filter 移除
      { key: 'emxx-home', icon: <DashboardOutlined />, label: '一线经营', children: [{ key: '/emxx', label: '经营首页' }] },
      { ...mktItems, label: 'MKT 铺子（只读）' },
      { ...whItems, children: whItems.children.filter(i => i.key && !['/du/wh/warehouse-dashboard'].includes(i.key)) },
      dlItems,
      svcItems,
    );
  }
  // [XFACTORY-P1] EDX 业务执行线（供给生产管理 + 交付回执 DDU/XU）
  else if (role === 'edx') {
    items.push(
      { key: 'edx-exec', icon: <ToolOutlined />, label: '业务执行线', children: [
        { key: '/edx/production-orders', label: '供给生产单' },
        { key: '/edx/receipts', label: '交付回执 (DDU/XU)' },
      ] },
      { ...mktItems, label: 'MKT 铺子（只读）' },
      fabItems, whItems, dlItems, svcItems,
    );
  }
  // [XFACTORY-P1] EMX 运营线（X-Supply 采购商城桩接）
  else if (role === 'emx') {
    items.push(
      { key: 'emx-ops', icon: <ShoppingCartOutlined />, label: '运营线', children: [
        { key: '/emx/purchase-requests', label: 'X-Supply 采购请求' },
        { key: '/emx/production-orders', label: '供给生产单' },
      ] },
    );
  }
  // EX 铺长：MKT + WH（盘点）+ DL + SVC
  else if (role === 'ex') {
    items.push(mktItems, fabItems, whItems, dlItems, svcItems);
  }
  // EDXX 铺员：FAB + WH + DL + SVC（四帽）
  else if (role === 'edxx') {
    items.push(fabItems, whItems, dlItems, svcItems);
  }

  return items.filter(item => item.children && item.children.length > 0);
};

// [Xfactory-C8] 26 菜单三层重组: 经营/作业/台账 三组 (菜单项文字措辞不动, 术语口径待定)
// [UX-BOOST] 顶层组由 submenu 改 type:'group'——消除三级嵌套折叠, 修复二级菜单在窄 Sider 内点击被遮挡/不可达 (P1-d 零响应根因)
const wrapMenuGroups = (items: any[]): any[] => {
  const groups: Array<{ key: string; icon: React.ReactNode; label: string; pred: (l: string) => boolean }> = [
    { key: 'grp-biz', icon: <DollarOutlined />, label: '经营', pred: (l) => /^(MKT|Market|EM |经营决策|一线经营)/.test(l) },
    { key: 'grp-ops', icon: <ToolOutlined />, label: '作业', pred: (l) => /^(FAB|DL|SVC|业务执行线|运营线)/.test(l) },
    { key: 'grp-ledger', icon: <DatabaseOutlined />, label: '台账', pred: (l) => /^WH/.test(l) },
  ];
  return groups
    .map((g) => ({ key: g.key, type: 'group' as const, icon: g.icon, label: g.label, children: items.filter((i) => g.pred(String(i.label || ''))) }))
    .filter((g) => (g.children || []).length > 0);
};

const AppLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  // [UX-BOOST P1-a] 响应式断点: <768px 走移动布局 (Drawer 侧栏 + Header 收纳)
  const screens = Grid.useBreakpoint();
  const isMobile = !!screens.xs && !screens.md;
  const [drawerOpen, setDrawerOpen] = useState(false);

  // [BOOTH-PRD-002] DEU 分身状态 (会话期 localStorage; 菜单与 Header 共用)
  const actingDeu = user?.role === 'du' && !!localStorage.getItem('booth-acting-deu');
  const setActingDeu = (v: boolean) => { if (v) localStorage.setItem('booth-acting-deu', '1'); else localStorage.removeItem('booth-acting-deu'); };

  // [Xfactory-C8] 菜单三层重组: 域组包入 经营/作业/台账 三大组 ([UX-BOOST] 顶层已 group 化)
  const menuItems = useMemo(() => wrapMenuGroups(getMenuItemsByRole(user?.role || 'du', actingDeu)), [user?.role, actingDeu]);

  // [Xfactory-C8] 身份帽卡: EDU(经营线)/EDX(执行线) 按登录身份显隐
  const capCard = (() => {
    if (!user) return null;
    if (actingDeu || user.actingAs === 'deu') return { code: 'EDX', label: '执行帽 · DEU 分身' };
    if (['du', 'dx', 'dm', 'em', 'emxx', 'emx'].includes(user.role)) return { code: 'EDU', label: '经营帽' };
    if (['ex', 'edx', 'edxx'].includes(user.role)) return { code: 'EDX', label: '执行帽' };
    return null;
  })();

  // 找到当前选中的菜单项
  const findSelectedKey = (items: any[]): string => {
    for (const item of items) {
      if (item.key && location.pathname === item.key) return item.key;
      if (item.children) {
        const found = findSelectedKey(item.children);
        if (found) return found;
      }
    }
    return '';
  };

  const selectedKey = useMemo(() => findSelectedKey(menuItems), [menuItems, location.pathname]);

  // 找到展开的子菜单 ([Xfactory-C8] 递归; [UX-BOOST] 顶层 group 后仅一层域组)
  const findOpenKeys = (items: any[], targetPath: string): string[] => {
    const walk = (list: any[], ancestors: string[]): string[] | null => {
      for (const item of list) {
        if (item.key === targetPath) return ancestors;
        if (item.children?.length) {
          const found = walk(item.children, item.key && typeof item.key === 'string' ? [...ancestors, item.key] : ancestors);
          if (found) return found;
        }
      }
      return null;
    };
    return walk(items, []) ?? [];
  };

  // [UX-BOOST P1-e] openKeys 受控: 路由链路自动展开 ∪ 用户手动展开 (切路由不再重置手动展开状态)
  const routeOpenKeys = useMemo(() => findOpenKeys(menuItems, location.pathname), [menuItems, location.pathname]);
  const [manualOpenKeys, setManualOpenKeys] = useState<string[]>([]);
  const openKeys = useMemo(
    () => Array.from(new Set([...routeOpenKeys, ...manualOpenKeys])),
    [routeOpenKeys, manualOpenKeys]
  );
  const handleOpenKeys = (keys: string[]) => {
    setManualOpenKeys(keys.filter((k) => !routeOpenKeys.includes(k)));
  };

  // [UX-BOOST ⑥] 路由 title
  useRouteTitle(location.pathname);

  const userMenu = {
    items: [
      // edx/edxx 无 /{role}/org-chart 路由（点击会落 '*' 弹回首页），仅对有路由的角色展示
      ...(user?.role !== 'ex' && user?.role !== 'edxx' ? [
        { key: 'org', icon: <AppstoreOutlined />, label: '组织架构', onClick: () => navigate(`/${user?.role}/org-chart`) },
      ] : []),
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: logout },
    ],
  };

  const roleLabels: Record<string, string> = {
    dm: 'DM 运营',
    du: 'DU 店主',
    dx: 'DX 店长',
    emxx: 'EMXX 店员',
    ex: 'EX 铺长',
    edxx: 'EDXX 铺员',
  };

  const handleNavigate = (key: string) => {
    navigate(key);
    if (isMobile) setDrawerOpen(false);
  };

  // [UX-BOOST P1-a] 侧栏内容复用: 桌面 Sider / 移动 Drawer 共用
  const siderInner = (
    <>
      <div style={{
        padding: '14px 16px 10px',
        textAlign: 'center',
        fontWeight: 'bold',
        fontSize: '17px',
        color: '#FFFFFF',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        letterSpacing: '0.05em'
      }}>
        Xfactory
        <div style={{ fontSize: 11, fontWeight: 400, color: 'rgba(255,255,255,0.55)', marginTop: 2, letterSpacing: '0.2em' }}>制 造 厂</div>
      </div>
      {capCard && (
        <div style={{
          margin: '10px 12px 4px', padding: '7px 10px', borderRadius: 8,
          background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ background: capCard.code === 'EDU' ? '#C9A227' : '#2F6BFF', color: '#fff', borderRadius: 6, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>
            {capCard.code}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>{capCard.label}</span>
          {user?.hats?.length ? (
            <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.55)', fontSize: 11 }}>{user.hats.join('/')}</span>
          ) : null}
        </div>
      )}
      <Menu
        mode="inline"
        theme="dark"
        selectedKeys={[selectedKey]}
        openKeys={openKeys}
        onOpenChange={(keys) => handleOpenKeys(keys)}
        items={menuItems}
        onClick={(e) => handleNavigate(e.key)}
        style={{
          background: '#1F3A5F',
          borderRight: 0,
        }}
      />
    </>
  );

  return (
    // [G-001] 全局布局约束: 滚动独立 —— Header/Sider 固定, Content 独立滚动
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      {/* [UX-BOOST P1-a] 移动端: Sider → Drawer (375 不再挤压内容区) */}
      {isMobile ? (
        <Drawer
          placement="left"
          width={264}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          styles={{ body: { background: '#1F3A5F', padding: 0 }, header: { display: 'none' } }}
        >
          {siderInner}
        </Drawer>
      ) : (
        <Sider width={232} style={{ background: '#1F3A5F', overflow: 'auto', flexShrink: 0 }}>
          {siderInner}
        </Sider>
      )}
      <Layout style={{ minWidth: 0 }}>
        <Header style={{
          background: '#FFFFFF',
          padding: isMobile ? '0 12px' : '0 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #E5E9F0',
          boxShadow: '0 1px 3px rgba(31, 58, 95, 0.04)',
          flexShrink: 0,
          gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {/* [UX-BOOST P1-b] 移动端汉堡按钮打开侧栏 Drawer */}
            {isMobile && (
              <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} aria-label="打开菜单" style={{ color: '#1F3A5F' }} />
            )}
            <div style={{ fontSize: isMobile ? '13px' : '14px', color: '#1F3A5F', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isMobile ? 'Xfactory' : 'Xfactory 制造厂 · 供给履约系统'}
            </div>
          </div>
          <Space size={isMobile ? 0 : 8}>
            {/* [Xfactory-ONBOARDING] 应用内帮助入口: 快速上手三动线 ([UX-BOOST P1-b] 移动端 icon-only 不再裁切) */}
            <Tooltip title="快速上手">
              <Button
                size="small"
                type="text"
                icon={<QuestionCircleOutlined />}
                onClick={() => window.open('/quickstart', '_blank')}
              >
                {isMobile ? '' : '快速上手'}
              </Button>
            </Tooltip>
            {/* [BOOTH-PRD-002 PM-004] DEU 分身入口: DU 可切换进入履约铺后台 (保留经营决策权) */}
            {user?.role === 'du' && (
              <Tooltip title={actingDeu ? '退出履约铺 (回 DU)' : '进入履约铺后台 (DEU)'}>
                <Button
                  size="small"
                  type={actingDeu ? 'primary' : 'default'}
                  icon={<DeliveredProcedureOutlined />}
                  onClick={() => {
                    const next = !actingDeu;
                    setActingDeu(next);
                    navigate(next ? '/edx' : '/du');
                  }}
                >
                  {isMobile ? '' : actingDeu ? '退出履约铺 (回 DU)' : '进入履约铺后台 (DEU)'}
                </Button>
              </Tooltip>
            )}
            {!isMobile && (
              <span style={{ color: '#6B7280', fontSize: '13px' }}>{actingDeu && user?.role === 'du' ? 'DEU · DU 分身' : roleLabels[user?.role || 'du']}</span>
            )}
            <Dropdown menu={userMenu}>
              <Button type="text" icon={<UserOutlined />} style={{ color: '#1F3A5F' }} aria-label={user?.name || '用户'}>
                {isMobile ? '' : (user?.name || '用户')}
              </Button>
            </Dropdown>
          </Space>
        </Header>
        {/* [G-001] 主内容区独立滚动: Header/Sider 不随内容滚动 */}
        <Content style={{
          margin: isMobile ? '12px' : '24px',
          padding: isMobile ? '12px' : '24px',
          background: '#FFFFFF',
          borderRadius: '8px',
          overflow: 'auto',
          boxShadow: '0 1px 3px rgba(31, 58, 95, 0.04)',
        }}>
          {/* [UX-BOOST ④] 路由过渡: key 变化触发淡入动画 */}
          <div key={location.pathname} className="page-fade">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
