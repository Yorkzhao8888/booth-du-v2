/**
 * [XFACTORY-P1] EDX 业务执行线 — 交付回执管理页
 * 组合 1: 完工 → 交付 DDU（回执生成即责任转移）
 * 组合 2: 完工 → 交付 XU（经 X-Market 渠道回执 → XU 收货确认闭环）
 * 回执字段: productionNo + 数量 + G-005 凭证号 + 交付时间 + 交付方(EDX) + 接收方(DDU/XU)
 */
import { useEffect, useState } from 'react';
import { Button, Card, message, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { apiGet, apiPost } from '../../api';

const { Title, Text } = Typography;

interface XfOrder {
  id: number;
  productionNo: string;
  shopOrderId: string;
  waveNo: string | null;
  source: string;
  orderFamily: string | null;
  status: string;
  totalQty: number | null;
  items: Array<{ name: string; qty: number }>;
  receipt: { receiptNo: string; receiverType: string; status: string } | null;
}

interface Receipt {
  id: number;
  receiptNo: string;
  productionNo: string;
  waveNo: string | null;
  source: string;
  qty: number | null;
  evidenceNos: number[];
  deliveredAt: string;
  deliveredBy: string;
  receiverType: string;
  status: string;
  confirmedAt: string | null;
}

const SRC_META: Record<string, { color: string; label: string }> = {
  SUPPLY: { color: 'purple', label: '组合1 · X-Supply' },
  MARKET: { color: 'geekblue', label: '组合2 · X-Market' },
};

export default function DeliveryReceipts() {
  const [orders, setOrders] = useState<XfOrder[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [o, r] = await Promise.all([
        apiGet<{ success: boolean; data: XfOrder[] }>('/edx/production-orders'),
        apiGet<{ success: boolean; data: Receipt[] }>('/edx/delivery-receipts'),
      ]);
      setOrders(o.data || []);
      setReceipts(r.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const issue = async (o: XfOrder) => {
    const receiverType = o.source === 'SUPPLY' ? 'DDU' : 'XU';
    setIssuing(o.id);
    try {
      await apiPost(`/edx/production-orders/${o.id}/delivery-receipt`, { receiverType });
      message.success(`交付回执已生成（责任转移至 ${receiverType}）`);
      await load();
    } catch (e) {
      message.error(`生成失败: ${(e as Error).message}`);
    } finally {
      setIssuing(null);
    }
  };

  const resend = async (r: Receipt) => {
    try {
      await apiPost(`/edx/delivery-receipts/${r.receiptNo}/resend`, {});
      message.success('回执已重新入队投递（F3 补偿）');
      await load();
    } catch (e) {
      message.error(`重发失败: ${(e as Error).message}`);
    }
  };

  const orderCols = [
    { title: '生产单号', dataIndex: 'productionNo', key: 'no' },
    { title: '来源', key: 'src', render: (_: unknown, r: XfOrder) => {
      const m = SRC_META[r.source] || { color: 'default', label: r.source };
      return <Tag color={m.color}>{m.label}</Tag>;
    } },
    { title: 'waveNo', dataIndex: 'waveNo', key: 'wave', render: (v: string | null) => v || '—' },
    { title: '数量', dataIndex: 'totalQty', key: 'qty' },
    { title: '状态', dataIndex: 'status', key: 'st', render: (v: string) => (
      <Tag color={v === 'completed' ? 'green' : v === 'in_progress' ? 'blue' : 'gold'}>{v}</Tag>
    ) },
    { title: '回执', key: 'rc', render: (_: unknown, r: XfOrder) => r.receipt ? (
      <span><Tag>{r.receipt.receiptNo}</Tag><Tag color={r.receipt.status === 'confirmed' ? 'green' : 'orange'}>{r.receipt.status}</Tag></span>
    ) : r.status === 'completed' ? <Tag color="warning">待交付</Tag> : <Text type="secondary">—</Text> },
    { title: '操作', key: 'act', render: (_: unknown, r: XfOrder) => r.status === 'completed' && !r.receipt ? (
      <Popconfirm
        title={`确认交付 ${r.source === 'SUPPLY' ? 'DDU' : 'XU'}？`}
        description="回执生成即责任转移至接收方"
        onConfirm={() => issue(r)}
      >
        <Button type="primary" size="small" loading={issuing === r.id}>生成交付回执</Button>
      </Popconfirm>
    ) : <Text type="secondary">—</Text> },
  ];

  const receiptCols = [
    { title: '回执号', dataIndex: 'receiptNo', key: 'no' },
    { title: '生产单号', dataIndex: 'productionNo', key: 'po' },
    { title: 'waveNo', dataIndex: 'waveNo', key: 'wave', render: (v: string | null) => v || '—' },
    { title: '来源', key: 'src', render: (_: unknown, r: Receipt) => (
      <Tag color={SRC_META[r.source]?.color || 'default'}>{r.source === 'SUPPLY' ? '组合1' : '组合2'}</Tag>
    ) },
    { title: '数量', dataIndex: 'qty', key: 'qty' },
    { title: 'G-005 凭证', key: 'ev', render: (_: unknown, r: Receipt) => (
      <span>{(r.evidenceNos || []).length > 0 ? `${r.evidenceNos.length} 张 (#${r.evidenceNos.join(', #')})` : '—'}</span>
    ) },
    { title: '交付方', dataIndex: 'deliveredBy', key: 'by', render: (v: string) => <Tag color="cyan">{v}</Tag> },
    { title: '接收方', dataIndex: 'receiverType', key: 'recv', render: (v: string) => <Tag color="geekblue">{v}</Tag> },
    { title: '状态', key: 'st', render: (_: unknown, r: Receipt) => (
      <Tag color={r.status === 'confirmed' ? 'green' : 'orange'}>
        {r.status === 'confirmed' ? '已收货确认' : '已交付 (责任已转移)'}
      </Tag>
    ) },
    { title: '操作', key: 'act', render: (_: unknown, r: Receipt) => r.status === 'delivered' ? (
      <Button size="small" onClick={() => resend(r)}>F3 重发</Button>
    ) : <Text type="secondary">闭环完成 {r.confirmedAt ? new Date(r.confirmedAt).toLocaleString() : ''}</Text> },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      <Card>
        <Title level={4} style={{ marginBottom: 8 }}>供给/市场生产单（交付视角）</Title>
        <Text type="secondary">组合 1 (source=SUPPLY) 交付 DDU · 组合 2 (source=MARKET) 经 X-Market 渠道交付 XU · 回执生成即责任转移</Text>
        <Table style={{ marginTop: 12 }} rowKey="id" size="small" columns={orderCols} dataSource={orders} loading={loading} pagination={{ pageSize: 8 }} />
      </Card>
      <Card>
        <Title level={4} style={{ marginBottom: 8 }}>交付回执台账</Title>
        <Table rowKey="id" size="small" columns={receiptCols} dataSource={receipts} loading={loading} pagination={{ pageSize: 8 }} />
      </Card>
    </Space>
  );
}
