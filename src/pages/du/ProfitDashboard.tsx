import React, { useEffect, useState } from 'react';
import { Card, Table, Statistic, Row, Col, Tag, DatePicker, Space } from 'antd';
import { DollarOutlined, RiseOutlined } from '@ant-design/icons';
import { api } from '../../api';

const { RangePicker } = DatePicker;

interface ProfitSnapshot {
  id: number;
  fulfillment_id: number;
  work_order_id: number;
  revenue: number;
  material_cost: number;
  gross_profit: number;
  margin: number;
  cost_detail: any[];
  created_at: string;
}

const ProfitDashboard: React.FC = () => {
  const [snapshots, setSnapshots] = useState<ProfitSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<[any, any] | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (dateRange) { params.from = dateRange[0].toISOString(); params.to = dateRange[1].toISOString(); }
      const res = await api.get('/du/profit', params);
      setSnapshots(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [dateRange]);

  const totalRevenue = snapshots.reduce((s, p) => s + (p.revenue || 0), 0);
  const totalCost = snapshots.reduce((s, p) => s + (p.material_cost || 0), 0);
  const totalProfit = snapshots.reduce((s, p) => s + (p.gross_profit || 0), 0);
  const avgMargin = snapshots.length > 0 ? snapshots.reduce((s, p) => s + (p.margin || 0), 0) / snapshots.length : 0;

  const columns = [
    { title: '履约单ID', dataIndex: 'fulfillment_id', key: 'fulfillment_id', width: 100 },
    { title: '工单ID', dataIndex: 'work_order_id', key: 'work_order_id', width: 100 },
    { title: '营收', dataIndex: 'revenue', key: 'revenue', width: 120, render: (v: number) => `¥${(v || 0).toFixed(2)}` },
    { title: '物料成本', dataIndex: 'material_cost', key: 'material_cost', width: 120, render: (v: number) => `¥${(v || 0).toFixed(2)}` },
    { title: '毛利', dataIndex: 'gross_profit', key: 'gross_profit', width: 120,
      render: (v: number) => <span style={{ color: v >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>¥{(v || 0).toFixed(2)}</span> },
    { title: '毛利率', dataIndex: 'margin', key: 'margin', width: 100,
      render: (v: number) => <Tag color={v >= 30 ? 'success' : v >= 10 ? 'warning' : 'error'}>{(v || 0).toFixed(1)}%</Tag> },
    { title: '时间', dataIndex: 'created_at', key: 'created_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card><Statistic title="总营收" value={totalRevenue} precision={2} prefix={<DollarOutlined />} suffix="¥" /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="总物料成本" value={totalCost} precision={2} prefix="¥" /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="总毛利" value={totalProfit} precision={2} prefix={<RiseOutlined />} suffix="¥" valueStyle={{ color: totalProfit >= 0 ? '#3f8600' : '#cf1322' }} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="平均毛利率" value={avgMargin} precision={1} suffix="%" /></Card>
        </Col>
      </Row>

      <Card title="利润快照" extra={<Space><RangePicker onChange={(dates) => setDateRange(dates as any)} /></Space>}>
        <Table dataSource={snapshots} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} scroll={{ x: 800 }} />
      </Card>
    </div>
  );
};

export default ProfitDashboard;
