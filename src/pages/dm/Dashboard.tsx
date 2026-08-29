import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Typography, Spin, Alert } from 'antd';
import { ShoppingCartOutlined, InboxOutlined, RiseOutlined, CarOutlined, ToolOutlined, DollarOutlined } from '@ant-design/icons';
import { api } from '../../api';
import { fmtMoney, fmtNum } from '../../utils/format';

const { Title } = Typography;

interface DmStats {
  totalOrders: number;
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  margin: number;
  lowStockCount: number;
  pendingDeliveries: number;
  pendingServices: number;
}

const DmDashboard: React.FC = () => {
  const [stats, setStats] = useState<DmStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        // Fetch from multiple endpoints to aggregate
        const [ordersRes, inventoryRes, dlRes, svcRes] = await Promise.all([
          api.get<{ items: unknown[]; total: number }>('/du/orders?pageSize=1'),
          api.get<{ items: unknown[]; lowStockCount: number }>('/du/inventory'),
          api.get<{ items: unknown[]; total: number }>('/du/dl/tasks?status=pending,assigned,accepted'),
          api.get<{ items: unknown[]; total: number }>('/du/svc/tasks?status=pending,assigned,accepted'),
        ]);

        // Fetch profit data
        const profitRes = await api.get<{ totalRevenue: number; totalCost: number; grossProfit: number; margin: number }>('/du/profit');

        setStats({
          totalOrders: ordersRes.total || 0,
          totalRevenue: profitRes.totalRevenue || 0,
          totalCost: profitRes.totalCost || 0,
          grossProfit: profitRes.grossProfit || 0,
          margin: profitRes.margin || 0,
          lowStockCount: inventoryRes.lowStockCount || 0,
          pendingDeliveries: dlRes.total || 0,
          pendingServices: svcRes.total || 0,
        });
      } catch (e) {
        setError('加载运营数据失败');
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (error) return <Alert message="错误" description={error} type="error" showIcon />;

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>DM 运营总览</Title>
      <Alert
        message="只读模式"
        description="DM 运营为只读角色，可查看全域数据但无法修改业务单据。"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="总订单数"
              value={stats?.totalOrders || 0}
              prefix={<ShoppingCartOutlined />}
              formatter={(v) => fmtNum(Number(v))}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="总营收"
              value={stats?.totalRevenue || 0}
              prefix={<DollarOutlined />}
              precision={2}
              formatter={(v) => fmtMoney(Number(v))}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="毛利"
              value={stats?.grossProfit || 0}
              prefix={<RiseOutlined />}
              precision={2}
              formatter={(v) => fmtMoney(Number(v))}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="毛利率"
              value={stats?.margin || 0}
              suffix="%"
              precision={1}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="库存预警"
              value={stats?.lowStockCount || 0}
              prefix={<InboxOutlined />}
              valueStyle={{ color: (stats?.lowStockCount || 0) > 0 ? '#cf1322' : undefined }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="待配送"
              value={stats?.pendingDeliveries || 0}
              prefix={<CarOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="待服务"
              value={stats?.pendingServices || 0}
              prefix={<ToolOutlined />}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default DmDashboard;
