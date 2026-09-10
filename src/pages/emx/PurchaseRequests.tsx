/**
 * [XFACTORY-P1] EMX 运营线 — X-Supply 采购请求桩接页
 * 组合 1: 供应商(*U) → X-Supply → EDU → EMX 采购（一键确认下单桩） → 生产单(source=SUPPLY, Order-T)
 * 边界: 仅登记/可见/可确认, 不做撮合/合同/结算 (P2)
 */
import { useEffect, useState } from 'react';
import { Button, Card, Drawer, message, Space, Table, Tag, Typography } from 'antd';
import { apiGet, apiPost } from '../../api';

const { Title, Text } = Typography;

interface PurchaseItem {
  id: number;
  supplyPurchaseNo: string;
  waveNo: string;
  items: Array<{ name: string; qty: number }>;
  status: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  productionOrderId: number | null;
  productionNo: string | null;
  productionStatus: string | null;
}

const STATUS_META: Record<string, { color: string; label: string }> = {
  registered: { color: 'gold', label: '待确认' },
  confirmed: { color: 'green', label: '已确认下单' },
};

export default function PurchaseRequests() {
  const [rows, setRows] = useState<PurchaseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [detail, setDetail] = useState<PurchaseItem | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await apiGet<{ success: boolean; data: PurchaseItem[] }>('/emx/purchase-requests');
      setRows(r.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const confirmOrder = async (row: PurchaseItem) => {
    setConfirming(row.id);
    try {
      await apiPost(`/emx/purchase-requests/${row.id}/confirm`, {});
      message.success(`已确认下单: ${row.supplyPurchaseNo} → 生产单已生成并拆单`);
      await load();
    } catch (e) {
      message.error(`确认失败: ${(e as Error).message}`);
    } finally {
      setConfirming(null);
    }
  };

  const columns = [
    { title: '采购单号', dataIndex: 'supplyPurchaseNo', key: 'no', render: (v: string, r: PurchaseItem) => (
      <a onClick={() => setDetail(r)}>{v}</a>
    ) },
    { title: 'waveNo', dataIndex: 'waveNo', key: 'wave' },
    { title: '品项', key: 'items', render: (_: unknown, r: PurchaseItem) => (
      <span>{(r.items || []).map((it) => `${it.name}×${it.qty}`).join('、')}</span>
    ) },
    { title: '状态', key: 'status', render: (_: unknown, r: PurchaseItem) => {
      const m = STATUS_META[r.status] || { color: 'default', label: r.status };
      return <Tag color={m.color}>{m.label}</Tag>;
    } },
    { title: '生产单', key: 'po', render: (_: unknown, r: PurchaseItem) => r.productionNo ? (
      <Tag color="blue">{r.productionNo}{r.productionStatus === 'completed' ? ' · 已完工' : ''}</Tag>
    ) : <Text type="secondary">—</Text> },
    { title: '确认人', dataIndex: 'confirmedBy', key: 'by', render: (v: string | null) => v || '—' },
    { title: '操作', key: 'act', render: (_: unknown, r: PurchaseItem) => r.status === 'registered' ? (
      <Button type="primary" size="small" loading={confirming === r.id} onClick={() => confirmOrder(r)}>
        一键下单
      </Button>
    ) : <Text type="secondary">已下单</Text> },
  ];

  return (
    <Card>
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <Title level={4} style={{ marginBottom: 0 }}>X-Supply 采购请求（桩接）</Title>
        <Text type="secondary">组合 1 供给主线 · EMX 确认即建生产单并四铺拆单 · waveNo/采购单号全链透传 · 不做撮合/合同/结算</Text>
        <Table rowKey="id" columns={columns} dataSource={rows} loading={loading} pagination={{ pageSize: 10 }} />
      </Space>
      <Drawer
        title={detail ? `采购单 ${detail.supplyPurchaseNo}` : ''}
        open={!!detail}
        onClose={() => setDetail(null)}
        width={420}
      >
        {detail && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <div><Text type="secondary">waveNo：</Text><Text copyable>{detail.waveNo}</Text></div>
            <div><Text type="secondary">来源：</Text><Tag color="purple">X-Supply (SUPPLY)</Tag></div>
            <div><Text type="secondary">品项明细：</Text>
              {(detail.items || []).map((it, i) => (
                <div key={i} style={{ paddingLeft: 8 }}>{it.name} × {it.qty}</div>
              ))}
            </div>
            <div><Text type="secondary">状态：</Text><Tag>{detail.status}</Tag></div>
            {detail.productionNo && (
              <div><Text type="secondary">生产单：</Text><Tag color="blue">{detail.productionNo}</Tag>
                <Tag>{detail.productionStatus}</Tag></div>
            )}
          </Space>
        )}
      </Drawer>
    </Card>
  );
}
