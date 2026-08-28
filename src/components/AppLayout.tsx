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
} from '@ant-design/icons';
import { useAuthStore } from '../store';

const { Header, Sider, Content } = Layout;

const duMenuItems = [
  { key: '/du', icon: <DashboardOutlined />, label: '看板' },
  { key: '/du/orders', icon: <ShoppingCartOutlined />, label: '订单' },
  { key: '/du/work-orders', icon: <ToolOutlined />, label: '工单' },
  { key: '/du/inventory', icon: <InboxOutlined />, label: '库存' },
  { key: '/du/boms', icon: <ProfileOutlined />, label: 'BOM' },
];

const dexMenuItems = [
  { key: '/dex', icon: <DashboardOutlined />, label: '工作台' },
  { key: '/dex/work-orders', icon: <ToolOutlined />, label: '工单' },
  { key: '/dex/boms', icon: <ProfileOutlined />, label: 'BOM管理' },
  { key: '/dex/skus', icon: <TagsOutlined />, label: 'SKU管理' },
  { key: '/dex/inventory', icon: <InboxOutlined />, label: '库存' },
];

const AppLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const menuItems = user?.role === 'dex' ? dexMenuItems : duMenuItems;

  const selectedKey = menuItems
    .map((m) => m.key)
    .filter((k) => {
      if (location.pathname === k) return true;
      // For du/dx shared routes, match /du prefix
      if ((user?.role === 'du' || user?.role === 'dx') && k.startsWith('/du') && location.pathname.startsWith('/du')) return true;
      if (user?.role === 'dex' && k.startsWith('/dex') && location.pathname.startsWith('/dex')) return true;
      return false;
    })
    .sort((a, b) => b.length - a.length)[0] || (user?.role === 'dex' ? '/dex' : '/du');

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const roleLabel: Record<string, string> = { du: '店主', dx: '店长', dex: '交付长' };
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
