import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Table, Tag, Statistic, Row, Col, Progress, Empty, Spin } from 'antd';
import {
  ClockCircleOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { api } from '../../api';

const STAGE_CONFIG: Record<string, { label: string; color: string; description: string }> = {
  preprocessing: { label: '前置工序', color: '#1890ff', description: '原料预处理、半成品准备' },
  production: { label: '制作', color: '#722ed1', description: '核心生产加工环节' },
  packaging: { label: '包装', color: '#fa8c16', description: '产品包装、贴标' },
  sorting: { label: '分拣', color: '#52c41a', description: '成品分拣、出库准备' },
};

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: '待接单', color: 'default' },
  accepted: { label: '已接单', color: 'processing' },
  preparing: { label: '生产中', color: 'warning' },
  in_progress: { label: '生产中', color: 'warning' },
  completed: { label: '已完成', color: 'success' },
  cancelled: { label: '已取消', color: 'error' },
  Pending: { label: '待处理', color: 'default' },
  Dispatched: { label: '已派单', color: 'cyan' },
  Accepted: { label: '已接单', color: 'processing' },
  Running: { label: '生产中', color: 'warning' },
  Completed: { label: '已完成', color: 'success' },
  Failed: { label: '失败', color: 'error' },
  Cancelled: { label: '已取消', color: 'error' },
};

interface WorkOrder {
  id: number;
  job_id?: string;
  product_name: string;
  qty: number;
  qty_completed?: number;
  status: string;
  production_stage: string;
  priority?: string | number;
  sla_minutes?: number;
  dispatched_at?: string;
  started_at?: string | null;
  created_at: string;
  station_name?: string;
  operator_name?: string;
}

export default function FabZoneView() {
  const { stage } = useParams<{ stage: string }>();
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<WorkOrder[]>([]);

  const stageInfo = STAGE_CONFIG[stage || 'preprocessing'] || STAGE_CONFIG.preprocessing;

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await api.get<any>('/dexx/fab/dashboard');
      if (res) { // api.ts 解包后 res 即业务数据
        const allOrders: WorkOrder[] = res.orders || [];
        // Filter by production_stage
        const filtered = allOrders.filter((o) => o.production_stage === stage);
        setOrders(filtered);
      }
    } catch {
      // ignore
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchOrders();
    const timer = setInterval(fetchOrders, 30000);
    return () => clearInterval(timer);
  }, [stage]);

  const getProgress = (wo: WorkOrder) => {
    if (!wo.qty || wo.qty === 0) return 0;
    return Math.round(((wo.qty_completed || 0) / wo.qty) * 100);
  };

  const getPriorityTag = (priority: string | number | undefined) => {
    if (!priority) return null;
    const p = typeof priority === 'number' ? priority : parseInt(priority as string) || 5;
    let color = 'default';
    if (p >= 8) color = 'red';
    else if (p >= 5) color = 'orange';
    else if (p >= 3) color = 'gold';
    return <Tag color={color}>P{p}</Tag>;
  };

  const columns = [
    {
      title: '工单号',
      dataIndex: 'job_id',
      key: 'job_id',
      render: (v: string, r: WorkOrder) => (
        <span style={{ fontFamily: 'monospace', color: '#1890ff' }}>{v || `WO-${r.id}`}</span>
      ),
    },
    { title: '商品', dataIndex: 'product_name', key: 'product_name' },
    {
      title: '数量',
      key: 'qty',
      render: (_: unknown, r: WorkOrder) => `${r.qty_completed || 0} / ${r.qty}`,
    },
    {
      title: '进度',
      key: 'progress',
      render: (_: unknown, r: WorkOrder) => (
        <Progress percent={getProgress(r)} size="small" status={getProgress(r) === 100 ? 'success' : 'active'} />
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      render: (p: string | number) => getPriorityTag(p),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => {
        const cfg = STATUS_MAP[s] || { label: s, color: 'default' };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: '工位',
      dataIndex: 'station_name',
      key: 'station_name',
      render: (s: string) => s || '-',
    },
    {
      title: '操作员',
      dataIndex: 'operator_name',
      key: 'operator_name',
      render: (s: string) => s || '-',
    },
  ];

  const inProgressCount = orders.filter((o) => ['preparing', 'in_progress', 'Running'].includes(o.status)).length;
  const completedCount = orders.filter((o) => ['completed', 'Completed'].includes(o.status)).length;

  return (
    <div style={{ padding: 24 }}>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{ width: 16, height: 16, borderRadius: '50%', background: stageInfo.color }} />
          <h2 style={{ margin: 0 }}>{stageInfo.label}产线</h2>
          <Tag color={stageInfo.color}>{stage}</Tag>
        </div>
        <p style={{ color: '#666', margin: 0 }}>{stageInfo.description}</p>
      </Card>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="工单总数" value={orders.length} prefix={<ThunderboltOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="进行中" value={inProgressCount} valueStyle={{ color: '#1890ff' }} prefix={<ClockCircleOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="已完成" value={completedCount} valueStyle={{ color: '#52c41a' }} prefix={<CheckCircleOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="待处理"
              value={orders.length - inProgressCount - completedCount}
              valueStyle={{ color: '#faad14' }}
              prefix={<WarningOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Card title="产线工单队列">
        <Spin spinning={loading}>
          {orders.length === 0 && !loading ? (
            <Empty description="暂无工单" />
          ) : (
            <Table
              dataSource={orders}
              columns={columns}
              rowKey="id"
              pagination={{ pageSize: 10 }}
              scroll={{ x: 900 }}
            />
          )}
        </Spin>
      </Card>
    </div>
  );
}
