import React, { useState, useEffect } from 'react';
import { Layout, Tabs, Segmented, Button } from 'antd';
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
  DashboardOutlined,
  LineChartOutlined,
  CalendarOutlined,
  SendOutlined,
  NodeIndexOutlined,
  SettingOutlined,
  HomeOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../store';

const { Header, Content } = Layout;

type ModuleType = 'fab' | 'fab-zone' | 'fab-eq' | 'wh' | 'wh-supply' | 'dl' | 'svc' | 'stocktake';

// 工单视角 tabs
const fabTabs = [
  { key: '/dexx/fab/queue', label: '待接单', icon: <ClockCircleOutlined /> },
  { key: '/dexx/fab/active', label: '制作中', icon: <SyncOutlined /> },
  { key: '/dexx/fab/operations', label: '报工', icon: <ToolOutlined /> },
  { key: '/dexx/fab/stations', label: '产线', icon: <ApartmentOutlined /> },
  { key: '/dexx/fab/dashboard', label: '看板', icon: <DashboardOutlined /> },
  { key: '/dexx/fab/yield', label: '良品率', icon: <LineChartOutlined /> },
  { key: '/dexx/qc', label: '质检', icon: <CheckSquareOutlined /> },
  { key: '/dexx/fab/history', label: '历史', icon: <HistoryOutlined /> },
];

// 设备视角 tabs（设备台账 / OEE / 保养）
const fabEqTabs = [
  { key: '/dexx/fab/equipment', label: '设备台账', icon: <ToolOutlined /> },
  { key: '/dexx/fab/equipment/oee', label: 'OEE', icon: <DashboardOutlined /> },
  { key: '/dexx/fab/maintenance', label: '保养', icon: <CalendarOutlined /> },
];

// 产线视角 tabs（四大生产区只读看板）
const fabZoneTabs = [
  { key: '/dexx/fab/zone/preprocessing', label: '前置', icon: <ApartmentOutlined /> },
  { key: '/dexx/fab/zone/production', label: '制作', icon: <ApartmentOutlined /> },
  { key: '/dexx/fab/zone/packaging', label: '包装', icon: <ApartmentOutlined /> },
  { key: '/dexx/fab/zone/sorting', label: '分拣', icon: <ApartmentOutlined /> },
];

const whTabs = [
  { key: '/dexx/wh/inventory', label: '库存', icon: <InboxOutlined /> },
  { key: '/dexx/wh/inbound', label: '入库', icon: <LoginOutlined /> },
  { key: '/dexx/wh/outbound', label: '出库', icon: <LogoutOutlined /> },
  { key: '/dexx/wh/txns', label: '流水', icon: <UnorderedListOutlined /> },
  { key: '/dexx/stocktake', label: '盘点', icon: <AuditOutlined /> },
];

// 供给视角 tabs
const whSupplyTabs = [
  { key: '/dexx/wh/supply-orders', label: '供给单', icon: <SendOutlined /> },
  { key: '/dexx/wh/supply-line-feed', label: '补给线', icon: <NodeIndexOutlined /> },
  { key: '/dexx/wh/device-supply', label: '设备', icon: <SettingOutlined /> },
  { key: '/dexx/wh/plaza-supply', label: '场地', icon: <HomeOutlined /> },
];

const dlTabs = [
  { key: '/dexx/dl', label: '配送', icon: <CarOutlined /> },
];

const svcTabs = [
  { key: '/dexx/svc', label: '服务', icon: <CustomerServiceOutlined /> },
];

const stocktakeTabs = [
  { key: '/dexx/stocktake', label: '盘点', icon: <AuditOutlined /> },
];

/** 根据 pathname 推断当前所属模块 */
const resolveModule = (pathname: string): ModuleType => {
  if (pathname.includes('/fab/zone/')) return 'fab-zone';
  if (pathname.includes('/fab/equipment') || pathname.includes('/fab/maintenance')) return 'fab-eq';
  if (pathname.includes('/wh/supply') || pathname.includes('/wh/device') || pathname.includes('/wh/plaza')) return 'wh-supply';
  if (pathname.includes('/wh/')) return 'wh';
  if (pathname.includes('/dl')) return 'dl';
  if (pathname.includes('/svc')) return 'svc';
  if (pathname.includes('/stocktake')) return 'stocktake';
  return 'fab';
};

const MobileLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, hasHat, logout } = useAuthStore();

  const [module, setModule] = useState<ModuleType>(() => resolveModule(location.pathname));

  // 问题1修复：监听路由变化，自动同步 module 状态
  useEffect(() => {
    const next = resolveModule(location.pathname);
    setModule((prev) => (prev !== next ? next : prev));
  }, [location.pathname]);

  const showFab = hasHat('FAB');
  const showWh = hasHat('WH');
  const showDl = hasHat('DL');
  const showSvc = hasHat('SVC');

  const segmentedOptions = [
    showFab ? { label: '工单', value: 'fab' as ModuleType } : null,
    showFab ? { label: '产线', value: 'fab-zone' as ModuleType } : null,
    showFab ? { label: '设备', value: 'fab-eq' as ModuleType } : null,
    showWh ? { label: '仓储', value: 'wh' as ModuleType } : null,
    showWh ? { label: '供给', value: 'wh-supply' as ModuleType } : null,
    showDl ? { label: '配送', value: 'dl' as ModuleType } : null,
    showSvc ? { label: '服务', value: 'svc' as ModuleType } : null,
  ].filter(Boolean) as { label: string; value: ModuleType }[];

  const showSwitch = segmentedOptions.length > 1;

  const tabsMap: Record<ModuleType, typeof fabTabs> = {
    fab: fabTabs,
    'fab-zone': fabZoneTabs,
    'fab-eq': fabEqTabs,
    wh: whTabs,
    'wh-supply': whSupplyTabs,
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
    'fab-eq': '/dexx/fab/equipment',
    wh: '/dexx/wh/inventory',
    'wh-supply': '/dexx/wh/supply-orders',
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
          padding: '0 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          borderBottom: '1px solid #f0f0f0',
          height: 48,
          lineHeight: '48px',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, flexShrink: 0, width: 42, overflow: 'hidden' }}>Booth</span>
        {showSwitch && (
          <div style={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}>
            <Segmented
              size="small"
              value={module}
              onChange={(v) => handleModuleChange(v as ModuleType)}
              options={segmentedOptions}
              style={{ whiteSpace: 'nowrap', maxWidth: '100%' }}
              block={false}
            />
          </div>
        )}
        <Button type="text" size="small" icon={<LogoutOutlined />} onClick={handleLogout} style={{ flexShrink: 0 }} />
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
            overflowX: 'auto',
          }}
          size="small"
          items={currentTabs.map((t) => ({
            key: t.key,
            label: (
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: 10, padding: '0 2px' }}>
                {t.icon}
                <span style={{ marginTop: 1, whiteSpace: 'nowrap', fontSize: 9 }}>{t.label}</span>
              </span>
            ),
          }))}
        />
      </div>
    </Layout>
  );
};

export default MobileLayout;
