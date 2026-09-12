import React, { useEffect, useState } from 'react';
import { Card, Skeleton, Tooltip, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  ApiOutlined,
  ArrowRightOutlined,
  LockOutlined,
  ShopOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { apiGet } from '../../api';
import { useAuthStore } from '../../store';
import { FOUR_SUBJECT_LINES, type ContainerAccess, type ContainerKey } from '../../types/containers';

interface ContainersResp extends Partial<ContainerAccess> {
  roleKey?: string;
  subRole?: string | null;
}

interface PortalCard {
  id: ContainerKey;
  icon: React.ReactNode;
  allowed?: boolean;
}

/**
 * [DUAL-PORTAL-P0/XDP-ECO] OAS 登录后容器分流页 (生态四主体)
 * 个人 #xhpz · 消费与派岗 / 企业 #xepz · 开店经营 / 经营户 #xdpz · 铺位管理 / 平台方 #xvpz · 生态治理
 * 可进性由 /auth/containers 按 OAS 原角色判定; 未开通容器显示「未开通」
 */
export const ContainerPortal: React.FC = () => {
  const navigate = useNavigate();
  const setContainer = useAuthStore((s) => s.setContainer);
  const setContainers = useAuthStore((s) => s.setContainers);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState<ContainerAccess>({ xhpz: true, xepz: true, xdpz: false, xvpz: false });

  useEffect(() => {
    let alive = true;
    apiGet<{ success: boolean; data: ContainersResp }>('/auth/containers')
      .then((resp) => {
        if (!alive) return;
        // [XDP-ECO] 兼容 apiGet 剥壳(envelope data 已解) 与未剥壳两种响应结构
        const envelope = resp as { data?: Partial<ContainersResp> } & Partial<ContainersResp>;
        const data = envelope?.data ?? envelope ?? {};
        const next: ContainerAccess = {
          xhpz: data.xhpz !== false,
          xepz: data.xepz !== false,
          xdpz: !!data.xdpz,
          xvpz: !!data.xvpz,
        };
        setAllowed(next);
        setContainers(next);
      })
      .catch(() => {
        // 拉取失败按个人/企业双容器放行 (登录态真实存在, 后续跨端访问由容器守卫兜底)
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [setContainers]);

  const cards: PortalCard[] = [
    { id: 'xhpz', icon: <UserOutlined />, allowed: allowed.xhpz },
    { id: 'xepz', icon: <TeamOutlined />, allowed: allowed.xepz },
    { id: 'xdpz', icon: <ShopOutlined style={{ color: '#13c2c2' }} />, allowed: allowed.xdpz },
    { id: 'xvpz', icon: <ApiOutlined />, allowed: allowed.xvpz },
  ];

  const enter = (id: PortalCard['id']) => {
    if (allowed[id]) {
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
          生态四主体 · 同账号多容器可随时切换; 未开通容器由平台方审核开通
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
              const line = FOUR_SUBJECT_LINES[c.id];
              const enabled = !!c.allowed;
              const card = (
                <Card
                  hoverable={enabled}
                  style={{ ...cardStyle, ...(enabled ? {} : reservedCardStyle) }}
                  onClick={() => (enabled ? enter(c.id) : message.info(`${line.title} 容器未开通, 由平台方审核开通`))}
                >
                  <div style={cardHeadStyle}>
                    <span style={{ ...iconStyle, ...(enabled ? {} : reservedIconStyle) }}>{c.icon}</span>
                    <span style={hashStyle}>#{c.id}</span>
                  </div>
                  <div style={cardTitleStyle}>{line.title}</div>
                  <div style={cardDescStyle}>{line.desc}</div>
                  <div style={cardFootStyle}>
                    {enabled ? (
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
              return enabled ? (
                <React.Fragment key={c.id}>{card}</React.Fragment>
              ) : (
                <Tooltip key={c.id} title={`${line.title} · 未开通`}>
                  {card}
                </Tooltip>
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
