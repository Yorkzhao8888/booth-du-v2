import React, { useMemo } from 'react';
import { Button, Space, Tag, Tooltip } from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  LogoutOutlined,
  ReloadOutlined,
  SwapOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../store';
import { CONTAINER_META, CONTAINER_SWITCH_TO, type ContainerKey } from '../types/containers';

const HAT_LABELS: Record<string, string> = {
  FAB: '制作',
  WH: '仓储',
  DL: '配送',
  SVC: '服务',
  MKT: '营销',
  OPS: '运营',
};

/**
 * [DUAL-PORTAL-P0/XDP-ECO] 四主体轻量工作台壳 (个人/企业/经营户/平台方共用)
 * 顶栏: 容器徽标 + 当前帽视角 + 切换角色(视角清空重建) + 切换端 + 退出; 375px 单列友好
 */
export const PortalShell: React.FC<{
  container: ContainerKey;
  children: React.ReactNode;
}> = ({ container, children }) => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const hat = useAuthStore((s) => s.hat);
  const containers = useAuthStore((s) => s.containers);
  const resetPerspective = useAuthStore((s) => s.resetPerspective);
  const logout = useAuthStore((s) => s.logout);
  const meta = CONTAINER_META[container];
  const userName = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('booth_user') || 'null')?.name || user?.name || '';
    } catch {
      return user?.name || '';
    }
  }, [user]);

  // [XDP-ECO] 同账号多容器切换入口 (映射表: xhpz↔xepz 互切; 经营户/平台方切对应端)
  const other = CONTAINER_SWITCH_TO[container];
  const canSwitch = containers ? containers[other] : false;

  const handleSwitchRole = () => {
    resetPerspective(); // 视角状态清空重建
    navigate(`/${container}/hats`);
  };

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div style={brandStyle}>
          <span style={badgeStyle}>#{container}</span>
          <div>
            <div style={titleStyle}>{meta.label}</div>
            <div style={subStyle}>{meta.sub}</div>
          </div>
        </div>
        <Space wrap size={8} style={{ justifyContent: 'flex-end' }}>
          <Tooltip title="产品定位: Xfactory 履约端">
            <Tag color="gold" style={hatTagStyle}>Xfactory 履约端</Tag>
          </Tooltip>
          {hat ? (
            <Tooltip title={`当前视角: ${HAT_LABELS[hat] || hat} (${hat})`}>
              <Tag color="processing" icon={<UserOutlined />} style={hatTagStyle}>
                {HAT_LABELS[hat] || hat}
              </Tag>
            </Tooltip>
          ) : null}
          <Button size="small" icon={<ReloadOutlined />} onClick={handleSwitchRole}>
            切换角色
          </Button>
          {canSwitch ? (
            <Button size="small" icon={<SwapOutlined />} onClick={() => navigate('/containers')}>
              切换端
            </Button>
          ) : null}
          <Button
            size="small"
            type="text"
            icon={<LogoutOutlined />}
            onClick={() => {
              logout();
              navigate('/login', { replace: true });
            }}
          >
            退出
          </Button>
        </Space>
      </header>
      <main style={mainStyle}>{children}</main>
      <footer style={footerStyle}>Xfactory 双端 · {meta.label} P0 骨架</footer>
    </div>
  );
};

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  padding: '16px 12px 24px',
  boxSizing: 'border-box',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  alignItems: 'center',
  justifyContent: 'space-between',
  color: '#fff',
  maxWidth: 960,
  margin: '0 auto 16px',
};

const brandStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  background: 'rgba(255,255,255,0.18)',
  border: '1px solid rgba(255,255,255,0.35)',
  borderRadius: 8,
  padding: '4px 10px',
  fontWeight: 700,
  fontSize: 15,
  letterSpacing: 0.5,
};

const titleStyle: React.CSSProperties = { fontWeight: 600, fontSize: 15, lineHeight: 1.3 };
const subStyle: React.CSSProperties = { fontSize: 12, opacity: 0.82 };

const hatTagStyle: React.CSSProperties = { fontSize: 13, padding: '2px 10px', borderRadius: 6 };

const mainStyle: React.CSSProperties = { maxWidth: 960, margin: '0 auto' };

const footerStyle: React.CSSProperties = {
  textAlign: 'center',
  color: 'rgba(255,255,255,0.55)',
  fontSize: 12,
  marginTop: 20,
};
