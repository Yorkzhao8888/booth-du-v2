import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Typography, Spin, Alert, Button, Space, Tag } from 'antd';
import { ShoppingCartOutlined, DollarOutlined, UserOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { fmtMoney, fmtNum } from '../../utils/format';

const { Title, Text } = Typography;

interface DxxStats {
  todayOrders: number;
  todayRevenue: number;
  customerCount: number;
  lowStockItems: number;
}

const DxxDashboard: React.FC = () => {
  const [stats, setStats] = useState<DxxStats | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchStats = async () => {
      try {
        // Fetch basic stats - DXX can see sale prices but not costs
        const [ordersRes, inventoryRes] = await Promise.all([
          api.get<{ items: unknown[]; total: number }>('/du/orders?pageSize=1'),
          api.get<{ items: unknown[]; lowStockCount: number }>('/du/inventory'),
        ]);

        setStats({
          todayOrders: ordersRes.total || 0,
          todayRevenue: 0, // Would need a specific endpoint for today's revenue
          customerCount: 0,
          lowStockItems: inventoryRes.lowStockCount || 0,
        });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>店员工作台</Title>
      <Alert
        message="一线经营"
        description="您是一线店员，负责收银、商品维护、客户接待和现场服务。"
        type="success"
        showIcon
        style={{ marginBottom: 24 }}
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="今日订单"
              value={stats?.todayOrders || 0}
              prefix={<ShoppingCartOutlined />}
              formatter={(v) => fmtNum(Number(v))}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="库存预警"
              value={stats?.lowStockItems || 0}
              valueStyle={{ color: (stats?.lowStockItems || 0) > 0 ? '#cf1322' : undefined }}
            />
          </Card>
        </Col>
      </Row>

      <Title level={5} style={{ marginTop: 32, marginBottom: 16 }}>快捷操作</Title>
      <Space wrap>
        <Button icon={<PlusOutlined />} onClick={() => navigate('/dxx/pos')}>
          收银开单
        </Button>
        <Button onClick={() => navigate('/dxx/products')}>
          商品管理
        </Button>
        <Button onClick={() => navigate('/dxx/customers')}>
          客户接待
        </Button>
        <Button onClick={() => navigate('/dexx/wh/inventory')}>
          库存查看
        </Button>
      </Space>

      <Title level={5} style={{ marginTop: 32, marginBottom: 16 }}>执行任务</Title>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12}>
          <Card
            title="配送执行"
            extra={<Tag color="blue">{stats?.todayOrders || 0} 待处理</Tag>}
            hoverable
            onClick={() => navigate('/dexx/dl')}
          >
            <Text type="secondary">查看待配送任务，执行配送</Text>
          </Card>
        </Col>
        <Col xs={24} sm={12}>
          <Card
            title="服务执行"
            extra={<Tag color="green">0 待处理</Tag>}
            hoverable
            onClick={() => navigate('/dexx/svc')}
          >
            <Text type="secondary">查看待服务任务，执行服务</Text>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default DxxDashboard;
