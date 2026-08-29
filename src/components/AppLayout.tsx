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
} from '@ant-design/icons';
import { useAuthStore } from '../store';

const { Header, Sider, Content } = Layout;

// 五大供给功能域菜单结构
// MKT 铺子管理 / FAB 制造铺 / WH 仓管铺 / DL 物流铺 / SVC 服务铺

const getMenuItemsByRole = (role: string) => {
  const canSeePrice = ['du', 'dx', 'dm'].includes(role);
  const canWrite = ['du', 'dx', 'dxx', 'dex', 'dexx'].includes(role);
  const isReadOnly = role === 'dm';

  // MKT 铺子管理
  const mktItems = {
    key: 'mkt',
    icon: <ShopOutlined />,
    label: 'MKT 铺子管理',
    children: [
      { key: '/du', label: '经营看板' },
      { key: '/du/orders', label: '订单管理' },
      { key: '/du/purchase-orders', label: '采购管理' },
      { key: '/du/profit', label: '毛利核算' },
      { key: '/du/boms', label: '商品/BOM' },
      { key: '/du/replenishment', label: '智能补货' },
      { key: '/du/suppliers', label: '供应商结算' },
      { key: '/du/fulfillment-track', label: '履约追踪' },
      { key: '/du/inventory-transfer', label: '库存调拨' },
      { key: '/du/realtime-dashboard', label: '实时大屏' },
      ...(role === 'dex' ? [{ key: '/dex/skus', label: 'SKU管理' }] : []),
      ...(role === 'dex' ? [{ key: '/dex/boms', label: 'BOM管理' }] : []),
      { key: '/du/org-chart', label: '组织架构' },
      ...(['du', 'dm'].includes(role) ? [{ key: '/du/employees', label: '员工管理' }] : []),
    ].map(item => ({
      ...item,
      label: isReadOnly && !item.label.includes('只读') && item.key !== '/du/org-chart' && item.key !== '/du/employees'
        ? `${item.label}（只读）`
        : item.label,
    })),
  };

  // FAB 制造铺
  const fabItems = {
    key: 'fab',
    icon: <ExperimentOutlined />,
    label: 'FAB 制造铺',
    children: [
      ...(role === 'dex' ? [
        { key: '/dex/work-orders', label: '工单调度' },
      ] : []),
      ...(role === 'dexx' ? [
        { key: '/dexx/fab-queue', label: '待接单' },
        { key: '/dexx/fab-active', label: '制作中' },
        { key: '/dexx/fab-operations', label: '工序报工' },
        { key: '/dexx/fab/dashboard', label: '产线看板' },
        { key: '/dexx/fab/yield', label: '良品率追踪' },
        { key: '/dexx/qc', label: '质检执行' },
      ] : []),
      ...(['du', 'dx', 'dm'].includes(role) ? [
        { key: '/du/work-orders', label: '工单管理' },
      ] : []),
    ],
  };

  // WH 仓管铺
  const whItems = {
    key: 'wh',
    icon: <HomeOutlined />,
    label: 'WH 仓管铺',
    children: [
      { key: '/du/batches', label: '批次库存' },
      { key: '/du/inventory', label: '库存总览' },
      { key: '/du/inventory-alerts', label: '库存预警' },
      { key: '/du/inventory-transfer', label: '库存调拨' },
      { key: '/du/expiry-control', label: '效期管控' },
      { key: '/du/wh/warehouse-dashboard', label: '四仓看板' },
      ...(role === 'dex' ? [{ key: '/dex/stocktakes', label: '盘点审批' }] : []),
      ...(role === 'dexx' ? [
        { key: '/dexx/stocktake', label: '盘点执行' },
        { key: '/dexx/wh/inbound', label: '入库' },
        { key: '/dexx/wh/outbound', label: '出库' },
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
      ...(role === 'dex' ? [{ key: '/dex/dl-dispatch', label: '配送派单' }] : []),
      ...(role === 'dexx' ? [{ key: '/dexx/dl', label: '配送执行' }] : []),
    ],
  };

  // SVC 服务铺
  const svcItems = {
    key: 'svc',
    icon: <HeartOutlined />,
    label: 'SVC 服务铺',
    children: [
      ...(['du', 'dx', 'dm'].includes(role) ? [{ key: '/du/svc', label: '服务任务' }] : []),
      ...(role === 'dex' ? [{ key: '/dex/svc-dispatch', label: '服务派单' }] : []),
      ...(role === 'dexx' ? [{ key: '/dexx/svc', label: '服务执行' }] : []),
    ],
  };

  // 按角色过滤菜单
  const items = [];

  // DM/DU/DX 可以看到所有五个域
  if (['dm', 'du', 'dx'].includes(role)) {
    items.push(mktItems, fabItems, whItems, dlItems, svcItems);
  }
  // DXX 一线经营：MKT（只读）+ WH + DL + SVC
  else if (role === 'dxx') {
    items.push(
      { ...mktItems, label: 'MKT 铺子（只读）' },
      { ...whItems, children: whItems.children.filter(i => !['/du/wh/warehouse-dashboard'].includes(i.key)) },
      dlItems,
      svcItems,
    );
  }
  // DEX 铺长：MKT + WH（盘点）+ DL + SVC
  else if (role === 'dex') {
    items.push(mktItems, fabItems, whItems, dlItems, svcItems);
  }
  // DEXX 铺员：FAB + WH + DL + SVC（四帽）
  else if (role === 'dexx') {
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
      { key: 'org', icon: <AppstoreOutlined />, label: '组织架构', onClick: () => navigate(`/${user?.role}/org-chart`) },
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: logout },
    ],
  };

  const roleLabels: Record<string, string> = {
    dm: 'DM 运营',
    du: 'DU 店主',
    dx: 'DX 店长',
    dxx: 'DXX 店员',
    dex: 'DEX 铺长',
    dexx: 'DEXX 铺员',
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} theme="light">
        <div style={{ padding: '16px', textAlign: 'center', fontWeight: 'bold', fontSize: '16px', borderBottom: '1px solid #f0f0f0' }}>
          Booth-DU v2
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={openKeys}
          items={menuItems}
          onClick={(e) => navigate(e.key)}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ fontSize: '14px', color: '#666' }}>
            供给履约系统
          </div>
          <Space>
            <span style={{ color: '#999' }}>{roleLabels[user?.role || 'du']}</span>
            <Dropdown menu={userMenu}>
              <Button type="text" icon={<UserOutlined />}>
                {user?.name || '用户'}
              </Button>
            </Dropdown>
          </Space>
        </Header>
        <Content style={{ margin: '24px', padding: '24px', background: '#fff', borderRadius: '8px', minHeight: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
