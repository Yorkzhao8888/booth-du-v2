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

const euMenuItems = [
  { key: '/eu', icon: <DashboardOutlined />, label: '看板' },
  { key: '/eu/orders', icon: <ShoppingCartOutlined />, label: '订单' },
  { key: '/eu/work-orders', icon: <ToolOutlined />, label: '工单' },
  { key: '/eu/inventory', icon: <InboxOutlined />, label: '库存' },
  { key: '/eu/boms', icon: <ProfileOutlined />, label: 'BOM' },
];

const exMenuItems = [
  { key: '/ex', icon: <DashboardOutlined />, label: '工作台' },
  { key: '/ex/work-orders', icon: <ToolOutlined />, label: '工单' },
  { key: '/ex/boms', icon: <ProfileOutlined />, label: 'BOM管理' },
  { key: '/ex/skus', icon: <TagsOutlined />, label: 'SKU管理' },
  { key: '/ex/inventory', icon: <InboxOutlined />, label: '库存' },
];

const AppLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const menuItems = user?.role === 'ex' ? exMenuItems : euMenuItems;

  const selectedKey = menuItems
    .map((m) => m.key)
    .filter((k) => location.pathname === k || (k !== `/${user?.role}` && location.pathname.startsWith(k)))
    .sort((a, b) => b.length - a.length)[0] || `/${user?.role}`;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const roleLabel = user?.role === 'eu' ? '经营单元' : user?.role === 'ex' ? '履约中心' : user?.role;

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
                <span style={{ color: '#999', fontSize: 12 }}>({roleLabel})</span>
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
