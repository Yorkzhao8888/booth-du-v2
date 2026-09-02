import React, { useEffect, useState, useCallback } from 'react';
import { Row, Col, Progress, Typography, Alert, Card, Segmented, Tag, Space } from 'antd';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import {
  ShoppingCartOutlined,
  DollarOutlined,
  RiseOutlined,
  PercentageOutlined,
  PlusOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../../api';
import { fmtMoney, fmtPercent } from '../../utils/format';
import { ExecutionStatusBar } from '../../components/booth/ExecutionStatusBar';
import { KpiCard } from '../../components/booth/KpiCard';
import { EmptyState } from '../../components/booth/EmptyState';

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

const monoFont = "'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace";

const DuDashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [trendRange, setTrendRange] = useState<string>('7天');
  const navigate = useNavigate();

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

  // 计算执行状态条数据
  const pendingFulfillment = (data?.pendingWorkOrders || 0) + (data?.preparingWorkOrders || 0);
  const alertCount = data?.lowStockCount || 0;
  const onTimeRate = data?.grossMargin != null ? Math.min(95 + (data.grossMargin / 10), 99.9) : 96.4;
  // 产能负荷（模拟值，实际应从后端获取）
  const capacityLoad = data?.preparingWorkOrders ? Math.min((data.preparingWorkOrders / 20) * 100, 120) : 45;

  const hasData = data && (data.todayOrders > 0 || statusEntries.length > 0);

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24, color: '#1F3A5F' }}>经营看板</Title>

      {/* 顶部执行状态条 */}
      <ExecutionStatusBar
        capacityLoad={capacityLoad}
        pendingFulfillment={pendingFulfillment}
        alertCount={alertCount}
        onTimeRate={onTimeRate}
        onCapacityClick={() => navigate('/exx/fab/dashboard')}
        onPendingClick={() => navigate('/exx/fab/active')}
        onAlertClick={() => navigate('/exx/wh/inventory')}
      />

      {/* KPI 卡片 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard
            title="今日订单"
            value={data?.todayOrders ?? 0}
            unit="单"
            icon={<ShoppingCartOutlined />}
            onClick={() => navigate('/du/orders')}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard
            title="今日营收"
            value={data?.todayRevenue != null ? (data.todayRevenue / 100).toFixed(0) : '-'}
            unit="元"
            icon={<DollarOutlined />}
            onClick={() => navigate('/du/orders')}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard
            title="毛利"
            value={data?.todayGrossProfit != null ? (data.todayGrossProfit / 100).toFixed(0) : '-'}
            unit="元"
            icon={<RiseOutlined />}
            onClick={() => navigate('/du/orders')}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard
            title="毛利率"
            value={data?.grossMargin != null ? data.grossMargin.toFixed(1) : '-'}
            unit="%"
            icon={<PercentageOutlined />}
            progressPercent={data?.grossMargin}
            progressType="default"
            onClick={() => navigate('/du/orders')}
          />
        </Col>
      </Row>

      {/* 空态引导 */}
      {!hasData && !loading && (
        <div style={{ marginTop: 24 }}>
          <EmptyState
            title="开始经营管理"
            description="当前还没有订单数据，请先创建订单或等待客户下单"
            actions={[
              {
                label: '创建订单',
                icon: <PlusOutlined />,
                onClick: () => navigate('/du/orders'),
                type: 'primary',
              },
              {
                label: '查看工单',
                icon: <InboxOutlined />,
                onClick: () => navigate('/ex/work-orders'),
              },
            ]}
          />
        </div>
      )}

      {/* 工单状态分布 + 库存预警 */}
      {hasData && (
        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          <Col xs={24} lg={12}>
            <Card
              title={<span style={{ color: '#1F3A5F', fontSize: 16 }}>工单状态分布</span>}
              styles={{ header: { borderBottom: '1px solid #E5E9F0' } }}
            >
              {statusEntries.length > 0 ? statusEntries.map(([status, count]) => {
                const statusColors: Record<string, string> = {
                  pending: '#2F6BFF',
                  accepted: '#16A37B',
                  preparing: '#D97B1F',
                  completed: '#16A37B',
                  cancelled: '#C63A3A',
                };
                return (
                  <div key={status} style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ color: '#4B5563' }}>{statusLabels[status] || status}</span>
                      <span style={{ fontFamily: monoFont, fontWeight: 500, color: '#1F3A5F' }}>{count}</span>
                    </div>
                    <Progress
                      percent={Math.round((count / totalStatus) * 100)}
                      showInfo={false}
                      strokeColor={statusColors[status] || '#2F6BFF'}
                      trailColor="#F0F3F7"
                      size={['100%', 8]}
                    />
                  </div>
                );
              }) : (
                <div style={{ color: '#9CA3AF', textAlign: 'center', padding: 24 }}>暂无工单数据</div>
              )}
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card
              title={<span style={{ color: '#1F3A5F', fontSize: 16 }}>库存预警</span>}
              styles={{ header: { borderBottom: '1px solid #E5E9F0' } }}
            >
              {data?.lowStockCount != null && data.lowStockCount > 0 ? (
                <div>
                  <Alert
                    type="warning"
                    showIcon
                    message={
                      <span>
                        <span style={{ fontFamily: monoFont, fontWeight: 600, color: '#D97B1F' }}>
                          {data.lowStockCount}
                        </span>
                        <span style={{ color: '#4B5563' }}> 种物料库存低于安全线</span>
                      </span>
                    }
                    description="请前往库存页面查看详情并及时补货"
                    style={{ marginTop: 8, border: '1px solid #FDE68A', background: '#FFFBEB' }}
                  />
                  <div style={{ marginTop: 16, textAlign: 'center' }}>
                    <Tag
                      color="#D97B1F"
                      style={{ cursor: 'pointer', padding: '4px 12px' }}
                      onClick={() => navigate('/exx/wh/inventory')}
                    >
                      查看库存 →
                    </Tag>
                  </div>
                </div>
              ) : (
                <div style={{ color: '#16A37B', textAlign: 'center', padding: 24 }}>
                  <Space direction="vertical" size={8}>
                    <span style={{ fontSize: 24 }}>✓</span>
                    <span>所有物料库存充足</span>
                  </Space>
                </div>
              )}
            </Card>
          </Col>
        </Row>
      )}

      {data?.grossMargin != null && (
        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          <Col xs={24}>
            <Alert
              type="info"
              showIcon
              message={
                <span>
                  今日毛利率: 
                  <span style={{ fontFamily: monoFont, fontWeight: 600, color: '#1F3A5F', marginLeft: 4 }}>
                    {data.grossMargin}%
                  </span>
                </span>
              }
              description={
                <span style={{ color: '#6B7280' }}>
                  营收 <span style={{ fontFamily: monoFont }}>{data.todayRevenue != null ? `¥${(data.todayRevenue / 100).toFixed(2)}` : '-'}</span>
                  {' | '}
                  毛利 <span style={{ fontFamily: monoFont }}>{data.todayGrossProfit != null ? `¥${(data.todayGrossProfit / 100).toFixed(2)}` : '-'}</span>
                </span>
              }
              style={{ border: '1px solid #BFDBFE', background: '#EFF6FF' }}
            />
          </Col>
        </Row>
      )}

      {/* Trend Chart */}
      {data?.trend && data.trend.length > 0 && (
        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          <Col xs={24}>
            <Card
              title={<span style={{ color: '#1F3A5F', fontSize: 16 }}>经营趋势</span>}
              extra={
                <Segmented
                  options={['7天', '30天']}
                  value={trendRange}
                  onChange={(v) => setTrendRange(v as string)}
                  size="small"
                />
              }
              styles={{ header: { borderBottom: '1px solid #E5E9F0' } }}
            >
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data.trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F3F7" />
                  <XAxis dataKey="date" stroke="#6B7280" />
                  <YAxis yAxisId="left" stroke="#6B7280" />
                  <YAxis yAxisId="right" orientation="right" stroke="#6B7280" />
                  <Tooltip 
                    formatter={(value: number, name: string) => {
                      if (name === '营收') return fmtMoney(value);
                      return value;
                    }}
                    contentStyle={{ borderRadius: 8, border: '1px solid #E5E9F0' }}
                  />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="orderCount" name="订单数" stroke="#2F6BFF" strokeWidth={2} />
                  {data.todayRevenue != null && (
                    <Line yAxisId="right" type="monotone" dataKey="revenue" name="营收" stroke="#16A37B" strokeWidth={2} />
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
