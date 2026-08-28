import React, { useEffect, useState, useCallback } from 'react';
import { Row, Col, Table, Progress, Typography, Alert } from 'antd';
import { apiGet } from '../../api';
import StatCard from '../../components/StatCard';
import PriceText from '../../components/PriceText';
import type { ColumnsType } from 'antd/es/table';

const { Title } = Typography;

interface DashboardData {
  todayOrders: number;
  todayRevenue: number;
  grossProfit: number;
  pendingWorkOrders: number;
  statusDistribution: { status: string; count: number }[];
  lowStock: { id: number; skuCode: string; name: string; quantity: number; safetyStock: number; unit: string }[];
}

const statusLabels: Record<string, string> = {
  pending: '待接单',
  accepted: '已接单',
  preparing: '制作中',
  completed: '已完成',
  cancelled: '已取消',
};

const EuDashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await apiGet<DashboardData>('/du/dashboard');
      setData(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const handler = () => fetchData();
    window.addEventListener('booth:refresh', handler);
    return () => window.removeEventListener('booth:refresh', handler);
  }, [fetchData]);

  const totalStatus = data?.statusDistribution.reduce((s, d) => s + d.count, 0) || 1;

  const lowStockColumns: ColumnsType<DashboardData['lowStock'][0]> = [
    { title: 'SKU', dataIndex: 'skuCode', key: 'skuCode' },
    { title: '名称', dataIndex: 'name', key: 'name' },
    {
      title: '库存',
      key: 'qty',
      render: (_, r) => (
        <span style={{ color: r.quantity <= r.safetyStock ? '#ff4d4f' : undefined }}>
          {r.quantity} {r.unit}
        </span>
      ),
    },
    { title: '安全库存', dataIndex: 'safetyStock', key: 'safetyStock' },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>经营看板</Title>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="今日订单" value={data?.todayOrders ?? 0} color="#1890ff" />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="今日营收" value={data ? <PriceText value={data.todayRevenue} /> : '-'} color="#52c41a" />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="毛利" value={data ? <PriceText value={data.grossProfit} /> : '-'} color="#fa8c16" />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="待处理工单" value={data?.pendingWorkOrders ?? 0} color="#ff4d4f" />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col xs={24} lg={12}>
          <div style={{ background: '#fafafa', padding: 16, borderRadius: 8 }}>
            <Title level={5}>工单状态分布</Title>
            {data?.statusDistribution.map((item) => (
              <div key={item.status} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>{statusLabels[item.status] || item.status}</span>
                  <span>{item.count}</span>
                </div>
                <Progress
                  percent={Math.round((item.count / totalStatus) * 100)}
                  showInfo={false}
                  strokeColor={
                    item.status === 'pending' ? '#1890ff' :
                    item.status === 'accepted' ? '#13c2c2' :
                    item.status === 'preparing' ? '#fa8c16' :
                    item.status === 'completed' ? '#52c41a' : '#ff4d4f'
                  }
                />
              </div>
            ))}
          </div>
        </Col>
        <Col xs={24} lg={12}>
          <div style={{ background: '#fafafa', padding: 16, borderRadius: 8 }}>
            <Title level={5}>库存预警</Title>
            {data?.lowStock && data.lowStock.length > 0 ? (
              <Table
                columns={lowStockColumns}
                dataSource={data.lowStock}
                rowKey="id"
                size="small"
                pagination={false}
                loading={loading}
              />
            ) : (
              <Alert message="暂无库存预警" type="success" showIcon />
            )}
          </div>
        </Col>
      </Row>
    </div>
  );
};

export default EuDashboard;
