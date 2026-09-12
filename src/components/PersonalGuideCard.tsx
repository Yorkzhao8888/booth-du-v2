import React from 'react';
import { Card, Button, Space, Typography } from 'antd';
import { UserSwitchOutlined, ShopOutlined, CompassOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const { Text, Title } = Typography;

// [Xfactory-ONBOARDING] 个人类身份引导卡: OAS 原角色 CU/GU (subRole) 视角可见
// 话术定版: 「个人参与须经 X-Mate 人事铺派岗」+「想开厂请注册企业主体」
// [ONBOARDING] OAS 原角色判定: subRole 字段缺失时从已验签 token payload 解 active_role (只读, 不动认证链)
export const decodeOASActiveRole = (): string => {
  try {
    const token = localStorage.getItem('booth_token') || '';
    const payloadB64 = token.split('.')[1] || '';
    const norm = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(decodeURIComponent(escape(atob(norm)))) as { active_role?: string };
    return String(payload.active_role || '').toUpperCase();
  } catch {
    return '';
  }
};

export const isPersonalOASRole = (): boolean => {
  const role = decodeOASActiveRole();
  return role === 'CU' || role === 'GU' || role === 'CUSTOMER' || role === 'VIEWER';
};

const PersonalGuideCard: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const navigate = useNavigate();
  return (
    <Card
      style={{ borderRadius: 12, marginBottom: compact ? 12 : 16, background: 'linear-gradient(135deg, #f6f7ff 0%, #f3eefa 100%)' }}
      styles={{ body: { padding: compact ? 12 : 16 } }}
    >
      <Space align="start" style={{ width: '100%' }}>
        <span style={{ fontSize: compact ? 22 : 26, lineHeight: 1 }}>🧑‍💼</span>
        <div style={{ flex: 1 }}>
          <Title level={5} style={{ margin: '0 0 6px', fontSize: compact ? 14 : undefined }}>个人身份参与指引</Title>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
            <Space size={6} align="start">
              <UserSwitchOutlined style={{ color: '#667eea', marginTop: 3 }} />
              <Text style={{ fontSize: 13 }}>
                <b>个人参与须经 X-Mate 人事铺派岗</b>——派岗后即可进入企业铺协作作业 (FAB/WH 执行端)
              </Text>
            </Space>
            <Space size={6} align="start">
              <ShopOutlined style={{ color: '#764ba2', marginTop: 3 }} />
              <Text style={{ fontSize: 13 }}>
                <b>想开厂?</b> 请注册企业主体, 以 EDU 经营身份登录后走企业三步开通
              </Text>
            </Space>
          </div>
          <Space wrap>
            <Button size="small" icon={<CompassOutlined />} onClick={() => window.open('https://fhrrxb4t8g.coze.site', '_blank')}>
              逛集市 (X-Market)
            </Button>
            <Button size="small" type="primary" ghost onClick={() => navigate('/quickstart')}>
              了解开通方式
            </Button>
          </Space>
        </div>
      </Space>
    </Card>
  );
};

export default PersonalGuideCard;
