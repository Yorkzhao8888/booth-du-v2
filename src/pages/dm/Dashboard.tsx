import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Typography, Spin, Alert, Tabs, Table } from 'antd';
import { ShoppingCartOutlined, InboxOutlined, RiseOutlined, CarOutlined, ToolOutlined, DollarOutlined, ExperimentOutlined, HomeOutlined } from '@ant-design/icons';
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
  pendingWorkOrders: number;
  inventoryCount: number;
}

interface WarehouseStats {
  warehouseType: string;
  skuCount: number;
  totalQty: number;
}

interface TrendItem {
  date: string;
  orderCount: number;
  revenue: number;
}

const DmDashboard: React.FC = () => {
  const [stats, setStats] = useState<DmStats | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseStats[]>([]);
  const [trend, setTrend] = useState<TrendItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        // Fetch from multiple endpoints to aggregate
        const [ordersRes, inventoryRes, dlRes, svcRes, dashboardRes] = await Promise.all([
          api.get<{ items: unknown[]; total: number }>('/du/orders?pageSize=1'),
          api.get<{ items: unknown[]; lowStockCount: number; total: number }>('/du/inventory'),
          api.get<{ items: unknown[]; total: number }>('/du/dl/tasks?status=pending,assigned,accepted'),
          api.get<{ items: unknown[]; total: number }>('/du/svc/tasks?status=pending,assigned,accepted'),
          api.get<{ todayOrders: number; todayRevenue: number; todayGrossProfit: number; grossMargin: number; pendingWorkOrders: number; trend: TrendItem[] }>('/du/dashboard'),
        ]);

        // Fetch profit data
        const profitRes = await api.get<{ totalRevenue: number; totalCost: number; grossProfit: number; margin: number }>('/du/profit');

        setStats({
          totalOrders: ordersRes.total || dashboardRes.todayOrders || 0,
          totalRevenue: profitRes.totalRevenue || dashboardRes.todayRevenue || 0,
          totalCost: profitRes.totalCost || 0,
          grossProfit: profitRes.grossProfit || dashboardRes.todayGrossProfit || 0,
          margin: profitRes.margin || dashboardRes.grossMargin || 0,
          lowStockCount: inventoryRes.lowStockCount || 0,
          pendingDeliveries: dlRes.total || 0,
          pendingServices: svcRes.total || 0,
          pendingWorkOrders: dashboardRes.pendingWorkOrders || 0,
          inventoryCount: inventoryRes.total || 0,
        });

        setTrend(dashboardRes.trend || []);

        // Fetch warehouse stats
        const warehouseTypes = ['material', 'device', 'sundry', 'plaza'];
        const warehouseStats: WarehouseStats[] = [];
        for (const type of warehouseTypes) {
          const res = await api.get<{ items: unknown[]; total: number }>(`/du/inventory?warehouse_type=${type}&pageSize=1`);
          warehouseStats.push({
            warehouseType: type,
            skuCount: res.total || 0,
            totalQty: 0, // Would need aggregation
          });
        }
        setWarehouses(warehouseStats);
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

  const warehouseLabels: Record<string, string> = {
    material: '物料仓',
    device: '设备仓',
    sundry: '杂货仓',
    plaza: '场地仓',
  };

  const warehouseColumns = [
    { title: '仓库', dataIndex: 'warehouseType', key: 'warehouseType', render: (t: string) => warehouseLabels[t] || t },
    { title: 'SKU 数', dataIndex: 'skuCount', key: 'skuCount', render: (v: number) => fmtNum(v) },
    { title: '库存总量', dataIndex: 'totalQty', key: 'totalQty', render: (v: number) => fmtNum(v) },
  ];

  const tabItems = [
    {
      key: 'overview',
      label: '供给全景',
      children: (
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic title="MKT 订单量" value={stats?.totalOrders || 0} prefix={<ShoppingCartOutlined />} formatter={(v) => fmtNum(Number(v))} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic title="FAB 生产单量" value={stats?.pendingWorkOrders || 0} prefix={<ExperimentOutlined />} formatter={(v) => fmtNum(Number(v))} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic title="WH 库存量" value={stats?.inventoryCount || 0} prefix={<HomeOutlined />} formatter={(v) => fmtNum(Number(v))} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic title="DL 待配送" value={stats?.pendingDeliveries || 0} prefix={<CarOutlined />} formatter={(v) => fmtNum(Number(v))} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic title="SVC 待服务" value={stats?.pendingServices || 0} prefix={<ToolOutlined />} formatter={(v) => fmtNum(Number(v))} />
            </Card>
          </Col>
        </Row>
      ),
    },
    {
      key: 'warehouse',
      label: '四仓概览',
      children: (
        <Table 
          dataSource={warehouses} 
          columns={warehouseColumns} 
          rowKey="warehouseType"
          pagination={false}
        />
      ),
    },
    {
      key: 'finance',
      label: '经营指标',
      children: (
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic title="总营收" value={stats?.totalRevenue || 0} prefix={<DollarOutlined />} precision={2} formatter={(v) => fmtMoney(Number(v))} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic title="毛利" value={stats?.grossProfit || 0} prefix={<RiseOutlined />} precision={2} formatter={(v) => fmtMoney(Number(v))} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic title="毛利率" value={stats?.margin || 0} suffix="%" precision={1} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic title="库存预警" value={stats?.lowStockCount || 0} prefix={<InboxOutlined />} valueStyle={{ color: (stats?.lowStockCount || 0) > 0 ? '#cf1322' : undefined }} />
            </Card>
          </Col>
        </Row>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>DM 供给域运营看板</Title>
      <Alert
        message="只读模式"
        description="DM 运营为只读角色，可查看全域供给数据但无法修改业务单据。"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />
      
      <Card>
        <Tabs items={tabItems} defaultActiveKey="overview" />
      </Card>
    </div>
  );
};

export default DmDashboard;
