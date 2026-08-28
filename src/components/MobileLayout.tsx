import React, { useState } from 'react';
import { Layout, Tabs, Segmented, Space, Button } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ClockCircleOutlined,
  SyncOutlined,
  HistoryOutlined,
  InboxOutlined,
  LoginOutlined,
  UnorderedListOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../store';

const { Header, Content } = Layout;

const fabTabs = [
  { key: '/exx/fab/queue', label: '待接单', icon: <ClockCircleOutlined /> },
  { key: '/exx/fab/active', label: '制作中', icon: <SyncOutlined /> },
  { key: '/exx/fab/history', label: '历史', icon: <HistoryOutlined /> },
];

const whTabs = [
  { key: '/exx/wh/inventory', label: '库存', icon: <InboxOutlined /> },
  { key: '/exx/wh/inbound', label: '入库', icon: <LoginOutlined /> },
  { key: '/exx/wh/outbound', label: '出库', icon: <LogoutOutlined /> },
  { key: '/exx/wh/txns', label: '流水', icon: <UnorderedListOutlined /> },
];

const MobileLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, hasHat, logout } = useAuthStore();
  const [module, setModule] = useState<'fab' | 'wh'>(() =>
    location.pathname.includes('/wh/') ? 'wh' : 'fab'
  );

  const showFab = hasHat('FAB');
  const showWh = hasHat('WH');
  const showSwitch = showFab && showWh;

  const currentTabs = module === 'fab' ? fabTabs : whTabs;
  const activeKey = currentTabs.find((t) => location.pathname === t.key)?.key || currentTabs[0].key;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleModuleChange = (val: 'fab' | 'wh') => {
    setModule(val);
    if (val === 'fab') {
      navigate('/exx/fab/queue');
    } else {
      navigate('/exx/wh/inventory');
    }
  };

  return (
    <Layout style={{ minHeight: '100vh', maxWidth: 480, margin: '0 auto', background: '#f5f5f5' }}>
      <Header
        style={{
          background: '#fff',
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #f0f0f0',
          height: 52,
          lineHeight: '52px',
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 600 }}>Booth</span>
        <Space size={8}>
          {showSwitch && (
            <Segmented
              size="small"
              value={module}
              onChange={(v) => handleModuleChange(v as 'fab' | 'wh')}
              options={[
                { label: '生产', value: 'fab' },
                { label: '仓储', value: 'wh' },
              ]}
            />
          )}
          <Button type="text" size="small" icon={<LogoutOutlined />} onClick={handleLogout} />
        </Space>
      </Header>
      <Content style={{ paddingBottom: 60, overflow: 'auto' }}>
        <Outlet />
      </Content>
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          maxWidth: 480,
          zIndex: 100,
        }}
      >
        <Tabs
          activeKey={activeKey}
          onChange={(key) => navigate(key)}
          tabBarStyle={{
            margin: 0,
            background: '#fff',
            borderTop: '1px solid #f0f0f0',
          }}
          size="large"
          items={currentTabs.map((t) => ({
            key: t.key,
            label: (
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: 11 }}>
                {t.icon}
                <span style={{ marginTop: 2 }}>{t.label}</span>
              </span>
            ),
          }))}
        />
      </div>
    </Layout>
  );
};

export default MobileLayout;
