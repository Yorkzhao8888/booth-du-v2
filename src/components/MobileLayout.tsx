import React, { useState, useEffect } from 'react';
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
  ToolOutlined,
  CheckSquareOutlined,
  AuditOutlined,
  CarOutlined,
  CustomerServiceOutlined,
  ApartmentOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../store';

const { Header, Content } = Layout;

type ModuleType = 'fab' | 'fab-zone' | 'wh' | 'dl' | 'svc' | 'stocktake';

// 工单视角 tabs
const fabTabs = [
  { key: '/dexx/fab/queue', label: '待接单', icon: <ClockCircleOutlined /> },
  { key: '/dexx/fab/active', label: '制作中', icon: <SyncOutlined /> },
  { key: '/dexx/fab/operations', label: '报工', icon: <ToolOutlined /> },
  { key: '/dexx/qc', label: '质检', icon: <CheckSquareOutlined /> },
  { key: '/dexx/fab/history', label: '历史', icon: <HistoryOutlined /> },
];

// 产线视角 tabs（四大生产区只读看板）
const fabZoneTabs = [
  { key: '/dexx/fab/zone/preprocessing', label: '前置工序', icon: <ApartmentOutlined /> },
  { key: '/dexx/fab/zone/production', label: '制作', icon: <ApartmentOutlined /> },
  { key: '/dexx/fab/zone/packaging', label: '包装', icon: <ApartmentOutlined /> },
  { key: '/dexx/fab/zone/sorting', label: '分拣', icon: <ApartmentOutlined /> },
];

const whTabs = [
  { key: '/dexx/wh/inventory', label: '库存', icon: <InboxOutlined /> },
  { key: '/dexx/wh/inbound', label: '入库', icon: <LoginOutlined /> },
  { key: '/dexx/wh/outbound', label: '出库', icon: <LogoutOutlined /> },
  { key: '/dexx/wh/txns', label: '流水', icon: <UnorderedListOutlined /> },
];

const dlTabs = [
  { key: '/dexx/dl', label: '配送任务', icon: <CarOutlined /> },
];

const svcTabs = [
  { key: '/dexx/svc', label: '服务任务', icon: <CustomerServiceOutlined /> },
];

const stocktakeTabs = [
  { key: '/dexx/stocktake', label: '盘点', icon: <AuditOutlined /> },
];

const MobileLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, hasHat, logout } = useAuthStore();

  const getInitialModule = (): ModuleType => {
    const p = location.pathname;
    if (p.includes('/fab/zone/')) return 'fab-zone';
    if (p.includes('/wh/')) return 'wh';
    if (p.includes('/dl')) return 'dl';
    if (p.includes('/svc')) return 'svc';
    if (p.includes('/stocktake')) return 'stocktake';
    return 'fab';
  };

  const [module, setModule] = useState<ModuleType>(getInitialModule);

  const showFab = hasHat('FAB');
  const showWh = hasHat('WH');
  const showDl = hasHat('DL');
  const showSvc = hasHat('SVC');

  const segmentedOptions = [
    showFab ? { label: '工单', value: 'fab' as ModuleType } : null,
    showFab ? { label: '产线', value: 'fab-zone' as ModuleType } : null,
    showWh ? { label: '仓储', value: 'wh' as ModuleType } : null,
    showDl ? { label: '配送', value: 'dl' as ModuleType } : null,
    showSvc ? { label: '服务', value: 'svc' as ModuleType } : null,
  ].filter(Boolean) as { label: string; value: ModuleType }[];

  const showSwitch = segmentedOptions.length > 1;

  const tabsMap: Record<ModuleType, typeof fabTabs> = {
    fab: fabTabs,
    'fab-zone': fabZoneTabs,
    wh: whTabs,
    dl: dlTabs,
    svc: svcTabs,
    stocktake: stocktakeTabs,
  };

  const currentTabs = module === 'stocktake' ? stocktakeTabs : (tabsMap[module] || fabTabs);
  const activeKey = currentTabs.find((t) => location.pathname === t.key)?.key || currentTabs[0].key;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const moduleDefaultPath: Record<ModuleType, string> = {
    fab: '/dexx/fab/queue',
    'fab-zone': '/dexx/fab/zone/preprocessing',
    wh: '/dexx/wh/inventory',
    dl: '/dexx/dl',
    svc: '/dexx/svc',
    stocktake: '/dexx/stocktake',
  };

  const handleModuleChange = (val: ModuleType) => {
    setModule(val);
    navigate(moduleDefaultPath[val]);
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
              onChange={(v) => handleModuleChange(v as ModuleType)}
              options={segmentedOptions}
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
