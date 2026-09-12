import React, { useEffect, useState } from 'react';
import { Card, Skeleton, Tooltip, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  ApiOutlined,
  ArrowRightOutlined,
  BankOutlined,
  LockOutlined,
  ShopOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { apiGet } from '../../api';
import { useAuthStore } from '../../store';

interface ContainersResp {
  xhpz: boolean;
  xepz: boolean;
  roleKey?: string;
  subRole?: string | null;
}

interface PortalCard {
  id: 'xhpz' | 'xepz' | 'xopz' | 'xgpz';
  label: string;
  desc: string;
  icon: React.ReactNode;
  allowed?: boolean;
  reserved?: boolean;
}

/**
 * [DUAL-PORTAL-P0] OAS 登录后容器分流页
 * 两张可进卡 (#xhpz 个人 / #xepz 企业) + 两张置灰预留卡 (#xopz 生态主体 / #xgpz 政府)
 */
export const ContainerPortal: React.FC = () => {
  const navigate = useNavigate();
  const setContainer = useAuthStore((s) => s.setContainer);
  const setContainers = useAuthStore((s) => s.setContainers);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState<ContainersResp>({ xhpz: true, xepz: true });

  useEffect(() => {
    let alive = true;
    apiGet<{ success: boolean; data: ContainersResp }>('/auth/containers')
      .then((resp) => {
        if (!alive) return;
        const data = resp?.data ?? { xhpz: true, xepz: true };
        setAllowed({ xhpz: !!data.xhpz, xepz: !!data.xepz, roleKey: data.roleKey, subRole: data.subRole });
        setContainers({ xhpz: !!data.xhpz, xepz: !!data.xepz });
      })
      .catch(() => {
        // 拉取失败按双容器放行 (登录态真实存在, 后续跨端访问由容器守卫兜底)
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [setContainers]);

  const cards: PortalCard[] = [
    { id: 'xhpz', label: '个人版', desc: '我的消费 · 我的接单 · 我的小铺', icon: <ShopOutlined />, allowed: allowed.xhpz },
    { id: 'xepz', label: '企业版', desc: '我的铺子 · 经营系统 · 采购供给', icon: <TeamOutlined />, allowed: allowed.xepz },
    { id: 'xopz', label: '生态主体', desc: '生态伙伴协同入口', icon: <ApiOutlined />, reserved: true },
    { id: 'xgpz', label: '政府', desc: '政企对接入口', icon: <BankOutlined />, reserved: true },
  ];

  const enter = (id: PortalCard['id']) => {
    if (id === 'xhpz' || id === 'xepz') {
      setContainer(id);
      navigate(`/${id}/hats`);
    }
  };

  return (
    <div style={pageStyle}>
      <div style={headStyle}>
        <div style={logoStyle}>Xfactory</div>
        <Typography.Title level={4} style={{ color: '#fff', margin: '8px 0 2px' }}>
          选择进入的工作容器
        </Typography.Title>
        <div style={{ color: 'rgba(255,255,255,0.72)', fontSize: 13 }}>
          同账号多容器可随时切换; 置灰容器为平台预留
        </div>
      </div>
      <div style={gridStyle}>
        {loading
          ? [0, 1, 2, 3].map((i) => (
              <Card key={i} style={cardStyle}>
                <Skeleton active paragraph={{ rows: 2 }} />
              </Card>
            ))
          : cards.map((c) => {
              const enabled = !!c.allowed && !c.reserved;
              const card = (
                <Card
                  hoverable={enabled}
                  style={{ ...cardStyle, ...(enabled ? {} : reservedCardStyle) }}
                  onClick={() => (enabled ? enter(c.id) : message.info('该容器为平台预留, 敬请期待'))}
                >
                  <div style={cardHeadStyle}>
                    <span style={{ ...iconStyle, ...(enabled ? {} : reservedIconStyle) }}>{c.icon}</span>
                    <span style={hashStyle}>#{c.id}</span>
                  </div>
                  <div style={cardTitleStyle}>{c.label}</div>
                  <div style={cardDescStyle}>{c.desc}</div>
                  <div style={cardFootStyle}>
                    {c.reserved ? (
                      <span style={reservedTagStyle}>
                        <LockOutlined /> 预留
                      </span>
                    ) : enabled ? (
                      <span style={enterStyle}>
                        进入 <ArrowRightOutlined />
                      </span>
                    ) : (
                      <span style={reservedTagStyle}>
                        <LockOutlined /> 未开通
                      </span>
                    )}
                  </div>
                </Card>
              );
              return c.reserved ? (
                <Tooltip key={c.id} title="预留">
                  {card}
                </Tooltip>
              ) : (
                <React.Fragment key={c.id}>{card}</React.Fragment>
              );
            })}
      </div>
    </div>
  );
};

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  padding: '40px 16px',
  boxSizing: 'border-box',
};

const headStyle: React.CSSProperties = { textAlign: 'center', maxWidth: 720, margin: '0 auto 24px' };

const logoStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '6px 18px',
  border: '2px solid rgba(255,255,255,0.5)',
  borderRadius: 12,
  color: '#fff',
  fontWeight: 800,
  fontSize: 20,
  letterSpacing: 2,
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 14,
  maxWidth: 720,
  margin: '0 auto',
};

const cardStyle: React.CSSProperties = { borderRadius: 14, minHeight: 148 };

const reservedCardStyle: React.CSSProperties = { opacity: 0.55, cursor: 'not-allowed' };

const cardHeadStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };

const iconStyle: React.CSSProperties = {
  fontSize: 26,
  color: '#667eea',
  background: 'rgba(102,126,234,0.12)',
  borderRadius: 10,
  padding: '8px 10px',
};

const reservedIconStyle: React.CSSProperties = { color: '#999', background: 'rgba(0,0,0,0.05)' };

const hashStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontWeight: 700,
  fontSize: 13,
  color: '#764ba2',
  background: 'rgba(118,75,162,0.1)',
  borderRadius: 6,
  padding: '2px 8px',
};

const cardTitleStyle: React.CSSProperties = { fontSize: 17, fontWeight: 700, marginTop: 10 };

const cardDescStyle: React.CSSProperties = { fontSize: 12.5, color: '#888', marginTop: 2, minHeight: 18 };

const cardFootStyle: React.CSSProperties = { marginTop: 12 };

const enterStyle: React.CSSProperties = { color: '#667eea', fontWeight: 600, fontSize: 13 };

const reservedTagStyle: React.CSSProperties = { color: '#999', fontSize: 13 };
