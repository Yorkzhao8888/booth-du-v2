import React from 'react';
import { Card, Typography } from 'antd';
import { ToolOutlined, InboxOutlined, CarOutlined, CustomerServiceOutlined, AuditOutlined, CheckSquareOutlined, SendOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store';

const { Title, Text } = Typography;

const ModuleEntry: React.FC = () => {
  const navigate = useNavigate();
  const { hasHat } = useAuthStore();

  const cards = [
    {
      hat: 'FAB',
      path: '/dexx/fab/queue',
      icon: <ToolOutlined style={{ fontSize: 40, color: '#1890ff', marginBottom: 8 }} />,
      title: '生产 FAB',
      desc: '工单接单与制作',
    },
    {
      hat: 'FAB',
      path: '/dexx/qc',
      icon: <CheckSquareOutlined style={{ fontSize: 40, color: '#722ed1', marginBottom: 8 }} />,
      title: '质检 QC',
      desc: '成品质量检验',
    },
    {
      hat: 'WH',
      path: '/dexx/wh/inventory',
      icon: <InboxOutlined style={{ fontSize: 40, color: '#52c41a', marginBottom: 8 }} />,
      title: '仓储 WH',
      desc: '库存管理与出入库',
    },
    {
      hat: 'WH',
      path: '/dexx/wh/supply-orders',
      icon: <SendOutlined style={{ fontSize: 40, color: '#fa541c', marginBottom: 8 }} />,
      title: '供给',
      desc: '供给单与补给执行',
    },
    {
      hat: 'WH',
      path: '/dexx/stocktake',
      icon: <AuditOutlined style={{ fontSize: 40, color: '#fa8c16', marginBottom: 8 }} />,
      title: '盘点',
      desc: '库存盘点执行',
    },
    {
      hat: 'DL',
      path: '/dexx/dl',
      icon: <CarOutlined style={{ fontSize: 40, color: '#13c2c2', marginBottom: 8 }} />,
      title: '配送 DL',
      desc: '配送任务执行',
    },
    {
      hat: 'SVC',
      path: '/dexx/svc',
      icon: <CustomerServiceOutlined style={{ fontSize: 40, color: '#eb2f96', marginBottom: 8 }} />,
      title: '服务 SVC',
      desc: '服务任务执行',
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Title level={4} style={{ marginBottom: 16 }}>选择模块</Title>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {cards.filter(c => hasHat(c.hat as any)).map((c, idx) => (
          <Card
            key={idx}
            hoverable
            onClick={() => navigate(c.path)}
            style={{ textAlign: 'center', borderRadius: 12, padding: '8px 0' }}
            styles={{ body: { padding: '12px 8px' } }}
          >
            {c.icon}
            <Title level={5} style={{ marginBottom: 2, fontSize: 14 }}>{c.title}</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>{c.desc}</Text>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default ModuleEntry;
