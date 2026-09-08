/**
 * [BOOTH-PRD-001] 生产单管理（契约地基骨架）
 * - 生产单 = Shop 订单 → 四铺拆单 → 工单执行 → 完成回传 的聚合载体 (BDD-19)
 * - 三级状态联动 + 超期自动异常 (G-007 / BDD-18)
 * - 事件接线: issued.v1 / packed.v1 触发点归 IMPL-001, 详情侧展示映射关系
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Descriptions, Drawer, Space, Table, Tag, Tooltip, message } from 'antd';
import { ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { apiGet, apiPost } from '../../api';

const PROD_STATUS_META: Record<string, { label: string; color: string }> = {
  pending_dispatch: { label: '待下发', color: 'default' },
  dispatched: { label: '已下发', color: 'processing' },
  in_progress: { label: '进行中', color: 'blue' },
  completed: { label: '已完成', color: 'success' },
  exception: { label: '异常', color: 'error' },
};

const TASK_TYPE_META: Record<string, string> = {
  manufacture: '制造铺',
  intelligent: '智造铺',
  service: '服务铺',
  goods: '商品铺',
};

const TASK_STATUS_META: Record<string, { label: string; color: string }> = {
  pending_split: { label: '待拆分', color: 'default' },
  in_progress: { label: '执行中', color: 'blue' },
  completed: { label: '已完成', color: 'success' },
  exception: { label: '异常', color: 'error' },
};

function fmtTime(v: string | null): string {
  if (!v) return '-';
  return new Date(v).toLocaleString('zh-CN', { hour12: false });
}

interface ProductionOrderRow {
  id: number;
  production_no: string;
  shop_order_id: string;
  dx_case_no: string | null;
  wave_no: string | null;
  order_no: string | null;
  status: string;
  exception_reason: string | null;
  expected_delivery_at: string | null;
  plaz_point: string | null;
  task_count: number;
  task_done: number;
  task_exception: number;
  overdue: boolean;
  created_at: string;
}

interface TaskRow {
  id: number;
  task_type: string;
  status: string;
  exception_reason: string | null;
  work_order_id: number | null;
  work_order_no: string | null;
  work_order_status: string | null;
  expected_delivery_at: string | null;
}

interface DetailResp {
  productionOrder: ProductionOrderRow & { items: unknown };
  tasks: TaskRow[];
}

export default function ProductionOrders() {
  const [rows, setRows] = useState<ProductionOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<DetailResp | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
      const data = await apiGet<ProductionOrderRow[]>(`/production-orders${qs}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (id: number) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const data = await apiGet<DetailResp>(`/production-orders/${id}`);
      setDetail(data);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '详情加载失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const runEvaluate = async () => {
    try {
      const r = await apiPost<{ ordersMarked: number; tasksMarked: number; ordersRefreshed: number }>('/production-orders/evaluate', {});
      message.success(`超期判定完成: 标记生产单异常 ${r.ordersMarked} 个 / 任务异常 ${r.tasksMarked} 个, 聚合刷新 ${r.ordersRefreshed} 单`);
      load();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '判定失败');
    }
  };

  const columns = [
    {
      title: '生产单号',
      dataIndex: 'production_no',
      width: 170,
      render: (v: string, r: ProductionOrderRow) => (
        <a onClick={() => openDetail(r.id)}>{v}</a>
      ),
    },
    { title: 'Shop 订单号', dataIndex: 'shop_order_id', width: 170 },
    { title: '波次', dataIndex: 'wave_no', width: 130, render: (v: string | null) => v || '-' },
    { title: '点位', dataIndex: 'plaz_point', width: 110, render: (v: string | null) => v || '-' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => {
        const meta = PROD_STATUS_META[v] || { label: v, color: 'default' };
        return <Badge status={meta.color as 'success' | 'error' | 'processing' | 'default'} text={meta.label} />;
      },
    },
    {
      title: '任务进度',
      key: 'task_progress',
      width: 110,
      render: (_: unknown, r: ProductionOrderRow) => `${r.task_done}/${r.task_count}${r.task_exception > 0 ? ` (异常${r.task_exception})` : ''}`,
    },
    {
      title: '约定交付',
      dataIndex: 'expected_delivery_at',
      width: 160,
      render: (v: string | null, r: ProductionOrderRow) =>
        r.overdue ? (
          <Tooltip title="已超约定交付日期且未全部办结">
            <Tag color="error">{fmtTime(v)}</Tag>
          </Tooltip>
        ) : (
          fmtTime(v)
        ),
    },
    {
      title: '异常原因',
      dataIndex: 'exception_reason',
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
  ];

  const taskColumns = [
    {
      title: '铺型',
      dataIndex: 'task_type',
      width: 90,
      render: (v: string) => TASK_TYPE_META[v] || v,
    },
    {
      title: '任务状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => {
        const meta = TASK_STATUS_META[v] || { label: v, color: 'default' };
        return <Badge status={meta.color as 'success' | 'error' | 'processing' | 'default'} text={meta.label} />;
      },
    },
    {
      title: '挂接工单',
      key: 'work_order',
      render: (_: unknown, r: TaskRow) =>
        r.work_order_id ? (
          <span>
            {r.work_order_no || `#${r.work_order_id}`}
            {r.work_order_status ? (
              <Tag style={{ marginLeft: 6 }} color={r.work_order_status === 'completed' ? 'success' : 'processing'}>
                {r.work_order_status}
              </Tag>
            ) : null}
          </span>
        ) : (
          <Tag>待挂接（四铺拆单点）</Tag>
        ),
    },
    {
      title: '约定交付',
      dataIndex: 'expected_delivery_at',
      width: 160,
      render: (v: string | null) => fmtTime(v),
    },
    {
      title: '异常原因',
      dataIndex: 'exception_reason',
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
  ];

  const po = detail?.productionOrder;

  return (
    <div>
      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        showIcon
        message="生产单全链路：Shop 订单 → 四铺拆单 → 工单执行 → 完成回传"
        description="三级状态自动联动（生产单→任务→工单）；超约定交付日期且未全部办结自动判定异常。事件回执 issued.v1 / packed.v1 由拆单与打包节点触发（IMPL-001 口径）。"
      />
      <Space style={{ marginBottom: 12 }} wrap>
        <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
        <Button icon={<ThunderboltOutlined />} onClick={runEvaluate}>超期自动判定</Button>
        {['', 'pending_dispatch', 'dispatched', 'in_progress', 'completed', 'exception'].map((s) => (
          <Tag.CheckableTag key={s || 'all'} checked={statusFilter === s} onChange={() => setStatusFilter(s)}>
            {s === '' ? '全部' : PROD_STATUS_META[s]?.label || s}
          </Tag.CheckableTag>
        ))}
      </Space>
      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns as never[]}
        dataSource={rows}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 单` }}
      />
      <Drawer
        title={po ? `生产单 ${po.production_no}` : '生产单详情'}
        width={720}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        loading={detailLoading}
      >
        {po && (
          <>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="生产单号">{po.production_no}</Descriptions.Item>
              <Descriptions.Item label="状态">
                {PROD_STATUS_META[po.status]?.label || po.status}
              </Descriptions.Item>
              <Descriptions.Item label="Shop 订单号">{po.shop_order_id}</Descriptions.Item>
              <Descriptions.Item label="dxCaseNo">{po.dx_case_no || po.shop_order_id}</Descriptions.Item>
              <Descriptions.Item label="波次">{po.wave_no || '-'}</Descriptions.Item>
              <Descriptions.Item label="点位">{po.plaz_point || '-'}</Descriptions.Item>
              <Descriptions.Item label="约定交付" span={2}>
                {fmtTime(po.expected_delivery_at)}
                {po.overdue || po.status === 'exception' ? (
                  <Tag style={{ marginLeft: 8 }} color="error">{po.exception_reason || '超期'}</Tag>
                ) : null}
              </Descriptions.Item>
            </Descriptions>
            <div style={{ margin: '16px 0 8px', fontWeight: 600 }}>四铺任务（三级状态联动）</div>
            <Table
              rowKey="id"
              size="small"
              columns={taskColumns as never[]}
              dataSource={detail?.tasks || []}
              pagination={false}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}
