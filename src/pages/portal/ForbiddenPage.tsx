import React from 'react';
import { Button, Card, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { SafetyCertificateOutlined } from '@ant-design/icons';

/**
 * [DUAL-PORTAL-P0] 单容器账号跨端访问 → 无权限友好页 (不白屏)
 */
export const ForbiddenPage: React.FC<{ container: 'xhpz' | 'xepz' }> = ({ container }) => {
  const navigate = useNavigate();
  const label = container === 'xhpz' ? 'Booth 个人版' : 'Booth 企业版';
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      <Card style={{ maxWidth: 400, width: '100%', textAlign: 'center', borderRadius: 14 }}>
        <SafetyCertificateOutlined style={{ fontSize: 46, color: '#faad14' }} />
        <Typography.Title level={4} style={{ marginTop: 12 }}>
          无权限访问 #{container}
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          当前账号未开通「{label}」容器，请联系管理员开通后重试。
        </Typography.Paragraph>
        <Button type="primary" block onClick={() => navigate('/containers', { replace: true })}>
          返回容器分流页
        </Button>
      </Card>
    </div>
  );
};
