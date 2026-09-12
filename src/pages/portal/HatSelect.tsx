import React, { useEffect, useState } from 'react';
import { Button, Card, Skeleton, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { AimOutlined, ArrowLeftOutlined, SafetyOutlined } from '@ant-design/icons';
import { apiGet } from '../../api';
import { useAuthStore } from '../../store';
import PersonalGuideCard, { isPersonalOASRole } from '../../components/PersonalGuideCard';
import { CONTAINER_META, type ContainerKey } from '../../types/containers';

interface HatItem {
  key: string;
  name: string;
  isDefault: boolean;
}

const CONTAINER_TITLE: Record<ContainerKey, string> = {
  xhpz: `${CONTAINER_META.xhpz.label} · 选择工作帽`,
  xepz: `${CONTAINER_META.xepz.label} · 选择工作帽`,
  xdpz: `${CONTAINER_META.xdpz.label} · 选择工作帽`,
  xvpz: `${CONTAINER_META.xvpz.label} · 选择工作帽`,
};

/**
 * [DUAL-PORTAL-P0/XDP-ECO] 角色层: 帽卡片选择页
 * OAS 三权 checkPower 动态帽列表 + 默认帽标记 (端点不可达时降级登录态组装, source 标注)
 */
export const HatSelect: React.FC<{ container: ContainerKey }> = ({ container }) => {
  const navigate = useNavigate();
  const setHat = useAuthStore((s) => s.setHat);
  const resetPerspective = useAuthStore((s) => s.resetPerspective);
  const [loading, setLoading] = useState(true);
  const [hats, setHats] = useState<HatItem[]>([]);
  const [source, setSource] = useState<string>('');

  useEffect(() => {
    let alive = true;
    // [XDP-ECO] 兼容 apiGet 剥壳(envelope data 已解) 与未剥壳两种响应结构
    apiGet<{ data?: { hats?: HatItem[]; source?: string }; hats?: HatItem[]; source?: string }>('/auth/hats')
      .then((resp) => {
        if (!alive) return;
        const payload = resp?.data ?? resp ?? {};
        setHats(payload.hats ?? []);
        setSource(payload.source ?? '');
      })
      .catch(() => {
        if (alive) setHats([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const pick = (hat: HatItem) => {
    setHat(hat.key);
    navigate(`/${container}`);
  };

  return (
    <div style={pageStyle}>
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        style={{ color: 'rgba(255,255,255,0.85)', marginBottom: 8 }}
        onClick={() => navigate('/containers')}
      >
        返回容器分流
      </Button>
      <Typography.Title level={4} style={{ color: '#fff', margin: '0 0 4px' }}>
        {CONTAINER_TITLE[container]}
      </Typography.Title>
      <div style={{ color: 'rgba(255,255,255,0.72)', fontSize: 13, marginBottom: 18 }}>
        一角色一登入独立工作台容器; 切换角色将清空当前视角状态
        {source === 'oas-checkpower' ? ' · checkPower 动态返回' : ''}
      </div>
      <div style={gridStyle}>
        {loading
          ? [0, 1, 2].map((i) => (
              <Card key={i} style={cardStyle}>
                <Skeleton active paragraph={{ rows: 1 }} />
              </Card>
            ))
          : hats.map((hat) => (
              <Card
                key={hat.key}
                hoverable
                style={cardStyle}
                onClick={() => pick(hat)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={iconStyle}>
                    <SafetyOutlined />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 16 }}>{hat.name}</span>
                      {hat.isDefault ? (
                        <Tag color="purple" icon={<AimOutlined />} style={{ marginRight: 0 }}>
                          默认
                        </Tag>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>帽标识: {hat.key}</div>
                  </div>
                </div>
              </Card>
            ))}
        {!loading && hats.length === 0 ? (
          <Card style={cardStyle}>
            <div style={{ textAlign: 'center', padding: '10px 6px' }}>
              <Typography.Text strong style={{ fontSize: 15 }}>暂无可用帽</Typography.Text>
              <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 14, fontSize: 13 }}>
                当前身份还没有被授权任何作业帽。帽由管理员在 OAS 平台配置, 配置后重新登录即可生效。
                你也可以先回到容器分流页查看其他可用视角。
              </Typography.Paragraph>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/containers')}>
                  返回容器分流
                </Button>
                <Button
                  icon={<SafetyOutlined />}
                  onClick={() => {
                    resetPerspective();
                    navigate('/login');
                  }}
                >
                  重新登录
                </Button>
                <Button type="link" onClick={() => navigate('/quickstart')}>
                  快速上手
                </Button>
              </div>
            </div>
          </Card>
        ) : null}
      </div>
      {/* [ONBOARDING] 个人类身份 (OAS 原角色 CU/GU) 在帽选择层即见 X-Mate 派岗引导 */}
      {isPersonalOASRole() ? (
        <div style={{ maxWidth: 720, margin: '18px auto 0' }}>
          <PersonalGuideCard compact />
        </div>
      ) : null}
    </div>
  );
};

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  padding: '32px 16px',
  boxSizing: 'border-box',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
  gap: 14,
  maxWidth: 720,
  margin: '0 auto',
};

const cardStyle: React.CSSProperties = { borderRadius: 14 };

const iconStyle: React.CSSProperties = {
  fontSize: 24,
  color: '#764ba2',
  background: 'rgba(118,75,162,0.12)',
  borderRadius: 10,
  padding: '8px 10px',
};
