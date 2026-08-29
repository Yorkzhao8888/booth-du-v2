import React, { useEffect, useState, useCallback } from 'react';
import { Row, Col, Table, Progress, Typography, Alert, Statistic, Card, Segmented } from 'antd';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { apiGet } from '../../api';
import { fmtMoney, fmtPercent } from '../../utils/format';
import type { ColumnsType } from 'antd/es/table';

const { Title } = Typography;

interface TrendItem {
  date: string;
  orderCount: number;
  revenue: number;
}

interface DashboardData {
  todayOrders: number;
  todayRevenue?: number;
  todayGrossProfit?: number;
  grossMargin?: number;
  pendingWorkOrders: number;
  preparingWorkOrders: number;
  lowStockCount: number;
  workOrderStats: Record<string, number>;
  trend: TrendItem[];
}

const statusLabels: Record<string, string> = {
  pending: '待接单',
  accepted: '已接单',
  preparing: '制作中',
  completed: '已完成',
  cancelled: '已取消',
};

const DuDashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [trendRange, setTrendRange] = useState<string>('7天');

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

  // Convert workOrderStats object to array for rendering
  const statusEntries = data?.workOrderStats
    ? Object.entries(data.workOrderStats).filter(([, count]) => count > 0)
    : [];
  const totalStatus = statusEntries.reduce((s, [, count]) => s + count, 0) || 1;

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>经营看板</Title>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card variant="borderless" style={{ background: '#1890ff08' }}>
            <Statistic title="今日订单" value={data?.todayOrders ?? 0} valueStyle={{ color: '#1890ff', fontSize: 28, fontWeight: 600 }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card variant="borderless" style={{ background: '#52c41a08' }}>
            <Statistic
              title="今日营收"
              value={data?.todayRevenue != null ? fmtMoney(data.todayRevenue) : '-'}
              valueStyle={{ color: '#52c41a', fontSize: 28, fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card variant="borderless" style={{ background: '#fa8c1608' }}>
            <Statistic
              title="毛利"
              value={data?.todayGrossProfit != null ? fmtMoney(data.todayGrossProfit) : '-'}
              valueStyle={{ color: '#fa8c16', fontSize: 28, fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card variant="borderless" style={{ background: '#ff4d4f08' }}>
            <Statistic
              title="毛利率"
              value={data?.grossMargin != null ? fmtPercent(data.grossMargin) : '-'}
              valueStyle={{ color: '#ff4d4f', fontSize: 28, fontWeight: 600 }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col xs={24} lg={12}>
          <div style={{ background: '#fafafa', padding: 16, borderRadius: 8 }}>
            <Title level={5}>工单状态分布</Title>
            {statusEntries.length > 0 ? statusEntries.map(([status, count]) => (
              <div key={status} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>{statusLabels[status] || status}</span>
                  <span>{count}</span>
                </div>
                <Progress
                  percent={Math.round((count / totalStatus) * 100)}
                  showInfo={false}
                  strokeColor={
                    status === 'pending' ? '#1890ff' :
                    status === 'accepted' ? '#13c2c2' :
                    status === 'preparing' ? '#fa8c16' :
                    status === 'completed' ? '#52c41a' : '#ff4d4f'
                  }
                />
              </div>
            )) : (
              <div style={{ color: '#999', textAlign: 'center', padding: 24 }}>暂无工单数据</div>
            )}
          </div>
        </Col>
        <Col xs={24} lg={12}>
          <div style={{ background: '#fafafa', padding: 16, borderRadius: 8 }}>
            <Title level={5}>库存预警</Title>
            {data?.lowStockCount != null && data.lowStockCount > 0 ? (
              <Alert
                type="warning"
                showIcon
                message={`${data.lowStockCount} 种物料库存低于安全线`}
                description="请前往库存页面查看详情并及时补货"
                style={{ marginTop: 8 }}
              />
            ) : (
              <div style={{ color: '#999', textAlign: 'center', padding: 24 }}>
                所有物料库存充足
              </div>
            )}
          </div>
        </Col>
      </Row>

      {data?.grossMargin != null && (
        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          <Col xs={24}>
            <Alert
              type="info"
              showIcon
              message={`今日毛利率: ${data.grossMargin}%`}
              description={`营收 ${data.todayRevenue != null ? `¥${(data.todayRevenue / 100).toFixed(2)}` : '-'} | 毛利 ${data.todayGrossProfit != null ? `¥${(data.todayGrossProfit / 100).toFixed(2)}` : '-'}`}
            />
          </Col>
        </Row>
      )}

      {/* Trend Chart */}
      {data?.trend && data.trend.length > 0 && (
        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          <Col xs={24}>
            <Card title="经营趋势" extra={
              <Segmented
                options={['7天', '30天']}
                value={trendRange}
                onChange={(v) => setTrendRange(v as string)}
                size="small"
              />
            }>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data.trend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip 
                    formatter={(value: number, name: string) => {
                      if (name === '营收') return fmtMoney(value);
                      return value;
                    }}
                  />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="orderCount" name="订单数" stroke="#1890ff" />
                  {data.todayRevenue != null && (
                    <Line yAxisId="right" type="monotone" dataKey="revenue" name="营收" stroke="#52c41a" />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
};

export default DuDashboard;
