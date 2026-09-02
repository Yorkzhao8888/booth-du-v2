import React from 'react';
import { Layout, Menu, Button, Dropdown, Space } from 'antd';
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
} from '@ant-design/icons';
import { useAuthStore } from '../store';

const { Header, Sider, Content } = Layout;

// 五大供给功能域菜单结构
// MKT 铺子管理 / FAB 制造铺 / WH 仓管铺 / DL 物流铺 / SVC 服务铺

const getMenuItemsByRole = (role: string) => {
  const canSeePrice = ['du', 'dx', 'dm'].includes(role);
  const canWrite = ['du', 'dx', 'dxx', 'ex', 'exx'].includes(role);
  const isReadOnly = role === 'dm';

  // MKT 铺子管理
  const mktItems = {
    key: 'mkt',
    icon: <ShopOutlined />,
    label: 'MKT 铺子管理',
    children: [
      // /du/* 管理项仅对决策/管理层展示（dex 守卫仅放行 /dex，dex/exx 点 /du/* 会被 RequireAuth 弹回）
      ...(['du', 'dx', 'dm'].includes(role) ? [
        { key: '/du', label: '经营看板' },
        { key: '/du/orders', label: '订单管理' },
        { key: '/du/purchase-orders', label: '采购管理' },
        { key: '/du/profit', label: '毛利核算' },
        { key: '/du/boms', label: '商品/BOM' },
        { key: '/du/replenishment', label: '智能补货' },
        { key: '/du/suppliers', label: '供应商管理' },
        { key: '/du/fulfillment-track', label: '履约追踪' },
        { key: '/du/inventory-transfer', label: '库存调拨' },
        { key: '/du/realtime-dashboard', label: '实时大屏' },
        { key: '/du/org-chart', label: '组织架构' },
        ...(['du', 'dm'].includes(role) ? [{ key: '/du/employees', label: '员工管理' }] : []),
      ] : []),
      // dex 自有路由项（/dex/skus、/dex/boms 已在 App.tsx 注册）
      ...(role === 'ex' ? [{ key: '/ex/skus', label: 'SKU管理' }] : []),
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
      ...(role === 'exx' ? [
        { key: '/exx/fab/queue', label: '待接单' },
        { key: '/exx/fab/active', label: '制作中' },
        { key: '/exx/fab/operations', label: '工序报工' },
        { key: '/exx/fab/dashboard', label: '产线看板' },
        { key: '/exx/fab/yield', label: '良品率追踪' },
        { key: '/exx/qc', label: '质检任务' },
        { key: '/exx/fab/trace', label: '追溯查询' },
        { key: '/exx/fab/defects', label: '不良分析' },
        { key: '/exx/fab/history', label: '历史工单' },
      ] : []),
      ...(['du', 'dx', 'dm'].includes(role) ? [
        { key: '/du/work-orders', label: '工单管理' },
      ] : []),
    ],
  };

  // FAB 制造铺 - 产线视角（四大生产区只读看板）——全角色可见（FAB-MES-03-FIX3: 保留可见+可进入+只读）
  // key 前缀按角色: du/dx/dm→/du/fab, dex→/dex/fab, exx→/exx/fab（各自 RequireAuth 放行前缀, 绝不弹回）
  const fabBase = role === 'exx' ? '/exx/fab' : role === 'ex' ? '/ex/fab' : role === 'em' ? '/em/fab' : '/du/fab';
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
      ...(role === 'exx'
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
      // 管理视角仅 du/dx/dm（守卫放行 /du）；dex/exx 点 /du/* 会被 RequireAuth 弹回首页
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
      ...(role === 'exx' ? [
        { key: '/exx/stocktake', label: '盘点执行' },
        { key: '/exx/wh/inbound', label: '入库' },
        { key: '/exx/wh/outbound', label: '出库' },
        { type: 'divider' },
        { key: 'wh-supply-group', label: '供给执行', type: 'group', children: [
          { key: '/exx/wh/supply-orders', label: '供给单' },
          { key: '/exx/wh/supply-line-feed', label: '补给产线' },
          { key: '/exx/wh/device-supply', label: '设备供给' },
          { key: '/exx/wh/plaza-supply', label: '场地供给' },
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
      ...(role === 'exx' ? [{ key: '/exx/dl', label: '配送执行' }] : []),
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
      ...(role === 'exx' ? [{ key: '/exx/svc', label: '服务执行' }] : []),
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

  // EM 角色：EM 供应链 + 产线只读监控 (FAB-MES-04-FIX4) + Market
  if (role === 'em') {
    items.push(emItems, fabItems, marketItems);
  }
  // DM/DU/DX 可以看到所有五个域 + Market
  else if (['dm', 'du', 'dx'].includes(role)) {
    items.push(mktItems, fabItems, whItems, dlItems, svcItems, marketItems);
  }
  // DXX 一线经营：MKT（只读）+ WH + DL + SVC
  else if (role === 'dxx') {
    items.push(
      // dxx 守卫仅放行 /dxx 与 /exx；收敛后 mkt/wh/dl/svc 对 dxx 均为空组，会被末尾 filter 移除
      { key: 'dxx-home', icon: <DashboardOutlined />, label: '一线经营', children: [{ key: '/dxx', label: '经营首页' }] },
      { ...mktItems, label: 'MKT 铺子（只读）' },
      { ...whItems, children: whItems.children.filter(i => !['/du/wh/warehouse-dashboard'].includes(i.key)) },
      dlItems,
      svcItems,
    );
  }
  // EX 铺长：MKT + WH（盘点）+ DL + SVC
  else if (role === 'ex') {
    items.push(mktItems, fabItems, whItems, dlItems, svcItems);
  }
  // EXX 铺员：FAB + WH + DL + SVC（四帽）
  else if (role === 'exx') {
    items.push(fabItems, whItems, dlItems, svcItems);
  }

  return items.filter(item => item.children && item.children.length > 0);
};

const AppLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const menuItems = getMenuItemsByRole(user?.role || 'du');

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

  const selectedKey = findSelectedKey(menuItems);

  // 找到展开的子菜单
  const findOpenKeys = (items: any[], targetPath: string): string[] => {
    const openKeys: string[] = [];
    for (const item of items) {
      if (item.children) {
        const hasMatch = item.children.some((child: any) =>
          child.key === targetPath || location.pathname.startsWith(child.key)
        );
        if (hasMatch && item.key) {
          openKeys.push(item.key);
        }
      }
    }
    return openKeys;
  };

  const openKeys = findOpenKeys(menuItems, location.pathname);

  const userMenu = {
    items: [
      // dex/exx 无 /{role}/org-chart 路由（点击会落 '*' 弹回首页），仅对有路由的角色展示
      ...(user?.role !== 'ex' && user?.role !== 'exx' ? [
        { key: 'org', icon: <AppstoreOutlined />, label: '组织架构', onClick: () => navigate(`/${user?.role}/org-chart`) },
      ] : []),
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: logout },
    ],
  };

  const roleLabels: Record<string, string> = {
    dm: 'DM 运营',
    du: 'DU 店主',
    dx: 'DX 店长',
    dxx: 'DXX 店员',
    ex: 'EX 铺长',
    exx: 'EXX 铺员',
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} style={{ background: '#1F3A5F' }}>
        <div style={{ 
          padding: '16px', 
          textAlign: 'center', 
          fontWeight: 'bold', 
          fontSize: '16px', 
          color: '#FFFFFF',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          letterSpacing: '0.05em'
        }}>
          Booth 供给系统
        </div>
        <Menu
          mode="inline"
          theme="dark"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={openKeys}
          items={menuItems}
          onClick={(e) => navigate(e.key)}
          style={{ 
            background: '#1F3A5F',
            borderRight: 0,
          }}
        />
      </Sider>
      <Layout>
        <Header style={{ 
          background: '#FFFFFF', 
          padding: '0 24px', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          borderBottom: '1px solid #E5E9F0',
          boxShadow: '0 1px 3px rgba(31, 58, 95, 0.04)'
        }}>
          <div style={{ fontSize: '14px', color: '#1F3A5F', fontWeight: 500 }}>
            Booth 供给履约系统
          </div>
          <Space>
            <span style={{ color: '#6B7280', fontSize: '13px' }}>{roleLabels[user?.role || 'du']}</span>
            <Dropdown menu={userMenu}>
              <Button type="text" icon={<UserOutlined />} style={{ color: '#1F3A5F' }}>
                {user?.name || '用户'}
              </Button>
            </Dropdown>
          </Space>
        </Header>
        <Content style={{ margin: '24px', padding: '24px', background: '#FFFFFF', borderRadius: '8px', minHeight: 'auto', boxShadow: '0 1px 3px rgba(31, 58, 95, 0.04)' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
