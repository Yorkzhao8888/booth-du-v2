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
} from '@ant-design/icons';
import { useAuthStore } from '../store';

const { Header, Sider, Content } = Layout;

const duMenuItems = [
  { key: '/du', icon: <DashboardOutlined />, label: '看板' },
  { key: '/du/orders', icon: <ShoppingCartOutlined />, label: '订单' },
  { key: '/du/work-orders', icon: <ToolOutlined />, label: '工单' },
  { key: '/du/inventory', icon: <InboxOutlined />, label: '库存' },
  { key: '/du/boms', icon: <ProfileOutlined />, label: 'BOM' },
  { type: 'divider' },
  { key: '/du/purchase-orders', icon: <ShoppingCartOutlined />, label: '采购管理' },
  { key: '/du/profit', icon: <DollarOutlined />, label: '毛利分析' },
  { key: '/du/batches', icon: <DatabaseOutlined />, label: '批次库存' },
  { type: 'divider' },
  { key: '/du/dl', icon: <CarOutlined />, label: '配送任务' },
  { key: '/du/svc', icon: <CustomerServiceOutlined />, label: '服务任务' },
  { type: 'divider' },
  { key: '/du/employees', icon: <UserOutlined />, label: '员工管理' },
  { key: '/du/org-chart', icon: <AppstoreOutlined />, label: '组织架构' },
];

const dmMenuItems = [
  { key: '/dm', icon: <DashboardOutlined />, label: '运营总览' },
  { type: 'divider' },
  { key: '/dm/orders', icon: <ShoppingCartOutlined />, label: '订单（只读）' },
  { key: '/dm/work-orders', icon: <ToolOutlined />, label: '工单（只读）' },
  { key: '/dm/inventory', icon: <InboxOutlined />, label: '库存（只读）' },
  { key: '/dm/boms', icon: <ProfileOutlined />, label: 'BOM（只读）' },
  { key: '/dm/purchase-orders', icon: <ShoppingCartOutlined />, label: '采购（只读）' },
  { key: '/dm/profit', icon: <DollarOutlined />, label: '毛利（只读）' },
  { key: '/dm/batches', icon: <DatabaseOutlined />, label: '批次（只读）' },
  { key: '/dm/dl', icon: <CarOutlined />, label: '配送（只读）' },
  { key: '/dm/svc', icon: <CustomerServiceOutlined />, label: '服务（只读）' },
  { type: 'divider' },
  { key: '/dm/employees', icon: <UserOutlined />, label: '员工管理' },
  { key: '/dm/org-chart', icon: <AppstoreOutlined />, label: '组织架构' },
];

const dxxMenuItems = [
  { key: '/dxx', icon: <DashboardOutlined />, label: '工作台' },
  { type: 'divider' },
  { key: '/dxx/dl', icon: <CarOutlined />, label: '配送执行' },
  { key: '/dxx/svc', icon: <CustomerServiceOutlined />, label: '服务执行' },
  { type: 'divider' },
  { key: '/dxx/org-chart', icon: <AppstoreOutlined />, label: '组织架构' },
];

const dexMenuItems = [
  { key: '/dex', icon: <DashboardOutlined />, label: '工作台' },
  { key: '/dex/work-orders', icon: <ToolOutlined />, label: '工单' },
  { key: '/dex/boms', icon: <ProfileOutlined />, label: 'BOM管理' },
  { key: '/dex/skus', icon: <TagsOutlined />, label: 'SKU管理' },
  { key: '/dex/inventory', icon: <InboxOutlined />, label: '库存' },
  { type: 'divider' },
  { key: '/dex/stocktakes', icon: <AuditOutlined />, label: '盘点审批' },
  { type: 'divider' },
  { key: '/dex/dl-dispatch', icon: <SendOutlined />, label: '配送派单' },
  { key: '/dex/svc-dispatch', icon: <CustomerServiceOutlined />, label: '服务派单' },
];

const AppLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const getMenuItems = () => {
    switch (user?.role) {
      case 'dm': return dmMenuItems;
      case 'dxx': return dxxMenuItems;
      case 'dex': return dexMenuItems;
      default: return duMenuItems;
    }
  };

  const menuItems = getMenuItems();

  const selectedKey = menuItems
    .filter((m: any) => m.key)
    .map((m: any) => m.key)
    .filter((k: string) => {
      if (location.pathname === k) return true;
      if ((user?.role === 'du' || user?.role === 'dx') && k.startsWith('/du') && location.pathname.startsWith('/du')) return true;
      if (user?.role === 'dm' && k.startsWith('/dm') && location.pathname.startsWith('/dm')) return true;
      if (user?.role === 'dxx' && k.startsWith('/dxx') && location.pathname.startsWith('/dxx')) return true;
      if (user?.role === 'dex' && k.startsWith('/dex') && location.pathname.startsWith('/dex')) return true;
      return false;
    })
    .sort((a: string, b: string) => b.length - a.length)[0] || (user?.role === 'dex' ? '/dex' : user?.role === 'dm' ? '/dm' : user?.role === 'dxx' ? '/dxx' : '/du');

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const roleLabel: Record<string, string> = { dm: '运营', du: '店主', dx: '店长', dxx: '店员', dex: '交付长', dexx: '铺员' };
  const displayRole = roleLabel[user?.role || ''] || user?.role;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" width={220} breakpoint="lg" collapsedWidth={0}>
        <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18, fontWeight: 700 }}>
          <AppstoreOutlined style={{ marginRight: 8 }} />
          Booth
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', borderBottom: '1px solid #f0f0f0' }}>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: '退出登录',
                  onClick: handleLogout,
                },
              ],
            }}
          >
            <Button type="text">
              <Space>
                <UserOutlined />
                {user?.name}
                <span style={{ color: '#999', fontSize: 12 }}>({displayRole})</span>
              </Space>
            </Button>
          </Dropdown>
        </Header>
        <Content style={{ margin: 24, padding: 24, background: '#fff', borderRadius: 8, minHeight: 280 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
