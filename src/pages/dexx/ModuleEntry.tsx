import React from 'react';
import { Card, Typography } from 'antd';
import { ToolOutlined, InboxOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store';

const { Title, Text } = Typography;

const ModuleEntry: React.FC = () => {
  const navigate = useNavigate();
  const { hasHat } = useAuthStore();

  return (
    <div style={{ padding: 16 }}>
      <Title level={4} style={{ marginBottom: 24 }}>选择模块</Title>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {hasHat('FAB') && (
          <Card
            hoverable
            onClick={() => navigate('/dexx/fab/queue')}
            style={{ textAlign: 'center', borderRadius: 12, padding: '8px 0' }}
          >
            <ToolOutlined style={{ fontSize: 48, color: '#1890ff', marginBottom: 12 }} />
            <Title level={5} style={{ marginBottom: 4 }}>生产 FAB</Title>
            <Text type="secondary">工单接单与制作</Text>
          </Card>
        )}
        {hasHat('WH') && (
          <Card
            hoverable
            onClick={() => navigate('/dexx/wh/inventory')}
            style={{ textAlign: 'center', borderRadius: 12, padding: '8px 0' }}
          >
            <InboxOutlined style={{ fontSize: 48, color: '#52c41a', marginBottom: 12 }} />
            <Title level={5} style={{ marginBottom: 4 }}>仓储 WH</Title>
            <Text type="secondary">库存管理与出入库</Text>
          </Card>
        )}
      </div>
    </div>
  );
};

export default ModuleEntry;
