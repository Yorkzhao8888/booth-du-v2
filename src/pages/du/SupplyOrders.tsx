import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Descriptions, Drawer, Form, Input, InputNumber, Modal,
  Select, Space, Steps, Table, Tag, Timeline, Typography, message,
} from 'antd';
import { FileDoneOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../../api';

// BOOTH-PK-02 SupplyOrder 显式契约状态机
const FLOW = ['Created', 'Quoted', 'Confirmed', 'Planning', 'Scheduling', 'Executing', 'Delivered', 'Settled'] as const;

const STATUS_COLOR: Record<string, string> = {
  Created: 'default', Quoted: 'gold', Confirmed: 'blue', Planning: 'cyan',
  Scheduling: 'geekblue', Executing: 'processing', Delivered: 'purple', Settled: 'green', Cancelled: 'red',
};

interface Milestones {
  quoted_at?: string; confirmed_at?: string; planned_at?: string; scheduled_at?: string;
  executing_at?: string; delivered_at?: string; settled_at?: string; cancelled_at?: string;
}

interface QuoteSnapshot {
  unit_price?: number; total_amount?: number; currency?: string;
  quote_valid_until?: string; quoted_by?: string;
}

interface ItemRow { productName?: string; name?: string; qty?: number; price?: number; skuId?: number }

interface ContractRow {
  id: number;
  shop_order_id: string;
  status: string;
  contract_status: string | null;
  items: ItemRow[];
  required_at: string | null;
  created_at: string;
  quote_snapshot: QuoteSnapshot | null;
  milestones: Milestones | null;
}

interface StatusDetail extends ContractRow {
  work_orders?: Array<{ id: number; status: string; product_name: string }>;
}

const fmtTime = (v?: string | null) => (v ? new Date(v).toLocaleString('zh-CN') : '-');

export default function SupplyOrders() {
  const [rows, setRows] = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string | undefined>();
  const [detail, setDetail] = useState<StatusDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteRow, setQuoteRow] = useState<ContractRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [quoteForm] = Form.useForm();
  const [createForm] = Form.useForm();

  const load = useCallback(async (status?: string) => {
    setLoading(true);
    try {
      const qs = status ? `?contract_status=${encodeURIComponent(status)}` : '';
      const res = await api.get(`/du/supply-orders${qs}`);
      setRows(res.data?.rows || []);
    } catch (e) {
      message.error('契约列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (row: ContractRow) => {
    setDetailOpen(true);
    try {
      const res = await api.get(`/du/supply-orders/${row.id}/status`);
      setDetail(res.data);
    } catch {
      setDetail({ ...row, work_orders: [] });
    }
  };

  const runAction = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      message.success(ok);
      await load(filter);
      return true;
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(msg || '操作失败');
      return false;
    }
  };

  const doQuote = async () => {
    const v = await quoteForm.validateFields();
    if (!quoteRow) return;
    const ok = await runAction(
      () => api.post(`/du/supply-orders/${quoteRow.id}:quote`, v),
      '已报价',
    );
    if (ok) { setQuoteOpen(false); quoteForm.resetFields(); }
  };

  const doConfirm = (row: ContractRow) =>
    runAction(() => api.post(`/du/supply-orders/${row.id}:confirm`), '已确认（SupplyOrder.Confirmed 已发布）');

  const doCancel = (row: ContractRow) =>
    runAction(() => api.post(`/du/supply-orders/${row.id}:cancel`), '已取消');

  const doSign = (row: ContractRow) =>
    runAction(() => api.post(`/du/deliveries/${row.id}:confirm`), '已签收（Delivered → Settled）');

  const doCreate = async () => {
    const v = await createForm.validateFields();
    const items = v.items.split('\n').filter(Boolean).map((line: string) => {
      const [productName, qty, price] = line.split(/[,，]/).map((s: string) => s.trim());
      return { productName, qty: Number(qty) || 1, price: Number(price) || 0 };
    });
    const ok = await runAction(
      () => api.post('/du/supply-orders', {
        shop_order_id: v.shop_order_id || undefined,
        items,
        required_at: v.required_at ? v.required_at.format('YYYY-MM-DD') : undefined,
      }),
      '契约已创建（Created）',
    );
    if (ok) { setCreateOpen(false); createForm.resetFields(); }
  };

  const columns = [
    { title: '外部单号', dataIndex: 'shop_order_id', key: 'shop_order_id', width: 160 },
    {
      title: '商品摘要', dataIndex: 'items', key: 'items',
      render: (items: ItemRow[]) =>
        (items || []).map(i => `${i.productName || i.name || 'SKU' }×${i.qty}`).join('、'),
    },
    { title: '交期', dataIndex: 'required_at', key: 'required_at', width: 110,
      render: (v: string) => (v ? v.slice(0, 10) : '-') },
    { title: '履约状态', dataIndex: 'status', key: 'status', width: 100 },
    { title: '契约状态', dataIndex: 'contract_status', key: 'contract_status', width: 110,
      render: (v: string) => <Tag color={STATUS_COLOR[v] || 'default'}>{v || 'Legacy'}</Tag> },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 160,
      render: (v: string) => fmtTime(v) },
    {
      title: '操作', key: 'action', width: 240,
      render: (_: unknown, row: ContractRow) => (
        <Space size="small" wrap>
          <Button size="small" onClick={() => openDetail(row)}>详情</Button>
          {row.contract_status === 'Created' && (
            <Button size="small" type="primary" onClick={() => { setQuoteRow(row); setQuoteOpen(true); }}>报价</Button>
          )}
          {row.contract_status === 'Quoted' && (
            <Button size="small" type="primary" onClick={() => doConfirm(row)}>确认</Button>
          )}
          {row.contract_status === 'Executing' && (
            <Button size="small" type="primary" ghost onClick={() => doSign(row)}>签收</Button>
          )}
          {['Created', 'Quoted'].includes(row.contract_status || '') && (
            <Button size="small" danger onClick={() => doCancel(row)}>取消</Button>
          )}
        </Space>
      ),
    },
  ];

  const currentStep = detail ? FLOW.indexOf((detail.contract_status || '') as typeof FLOW[number]) : -1;

  return (
    <Card
      title="供给订单（SupplyOrder 显式契约）"
      extra={
        <Space>
          <Select
            allowClear placeholder="契约状态" style={{ width: 140 }}
            options={[...FLOW, 'Cancelled'].map(s => ({ value: s, label: s }))}
            value={filter} onChange={(v) => { setFilter(v); load(v); }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => load(filter)}>刷新</Button>
          <Button type="primary" onClick={() => setCreateOpen(true)}>新建契约</Button>
        </Space>
      }
    >
      <Table
        rowKey="id" loading={loading} dataSource={rows} columns={columns as never}
        pagination={{ pageSize: 10, showTotal: t => `共 ${t} 单` }}
      />

      {/* 报价 Modal */}
      <Modal
        title={`报价 · ${quoteRow?.shop_order_id || ''}`} open={quoteOpen} onOk={doQuote}
        onCancel={() => setQuoteOpen(false)} destroyOnHidden
      >
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="报价写入 quote_snapshot 快照，执行层（dex/exx）不可见"
        />
        <Form form={quoteForm} layout="vertical" initialValues={{ currency: 'CNY', valid_days: 7 }}>
          <Form.Item name="unit_price" label="单价" rules={[{ required: true, message: '请输入单价' }]}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="total_amount" label="总价（留空按数量自动计算）">
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="currency" label="币种"><Input /></Form.Item>
          <Form.Item name="valid_days" label="报价有效期（天）">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 新建契约 Modal */}
      <Modal title="新建供给契约（shop 代录）" open={createOpen} onOk={doCreate} onCancel={() => setCreateOpen(false)} destroyOnHidden>
        <Form form={createForm} layout="vertical">
          <Form.Item name="shop_order_id" label="外部单号（留空自动生成）">
            <Input placeholder="SO-20260901-001" />
          </Form.Item>
          <Form.Item
            name="items" label="商品清单（每行：名称,数量,单价）"
            rules={[{ required: true, message: '请输入商品清单' }]}
          >
            <Input.TextArea rows={4} placeholder={'手作盲盒,3,45\n胸针套装,2,30'} />
          </Form.Item>
          <Form.Item name="required_at" label="交付截止日">
            <Input type="date" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 详情 Drawer */}
      <Drawer
        title={detail ? `契约 ${detail.shop_order_id}` : '契约详情'} width={640}
        open={detailOpen} onClose={() => setDetailOpen(false)}
      >
        {detail && (
          <>
            <Steps
              size="small" style={{ marginBottom: 20 }}
              current={currentStep}
              status={detail.contract_status === 'Cancelled' ? 'error' : 'process'}
              items={FLOW.map(s => ({ title: s }))}
            />
            {detail.contract_status === 'Cancelled' && (
              <Alert type="error" message="该契约已取消（确认前可取消）" style={{ marginBottom: 16 }} />
            )}
            <Typography.Title level={5}>里程碑</Typography.Title>
            <Timeline
              items={[
                { children: `创建：${fmtTime(detail.created_at)}` },
                { children: `报价：${fmtTime(detail.milestones?.quoted_at)}` },
                { children: `确认：${fmtTime(detail.milestones?.confirmed_at)}` },
                { children: `排产：${fmtTime(detail.milestones?.planned_at)}` },
                { children: `排程：${fmtTime(detail.milestones?.scheduled_at)}` },
                { children: `执行：${fmtTime(detail.milestones?.executing_at)}` },
                { children: `交付：${fmtTime(detail.milestones?.delivered_at)}` },
                { children: `结算：${fmtTime(detail.milestones?.settled_at)}` },
              ]}
            />
            <Typography.Title level={5}>
              <FileDoneOutlined /> 报价快照
            </Typography.Title>
            {detail.quote_snapshot ? (
              <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
                <Descriptions.Item label="单价">{detail.quote_snapshot.unit_price ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="总价">{detail.quote_snapshot.total_amount ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="币种">{detail.quote_snapshot.currency ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="有效期至">{fmtTime(detail.quote_snapshot.quote_valid_until)}</Descriptions.Item>
                <Descriptions.Item label="报价人" span={2}>{detail.quote_snapshot.quoted_by ?? '-'}</Descriptions.Item>
              </Descriptions>
            ) : (
              <Alert type="warning" message="未报价（Created 阶段无快照）" style={{ marginBottom: 16 }} />
            )}
            <Typography.Title level={5}>商品清单</Typography.Title>
            <Descriptions size="small" bordered column={1} style={{ marginBottom: 16 }}>
              {(detail.items || []).map((it, idx) => (
                <Descriptions.Item key={idx} label={it.productName || it.name || `SKU${it.skuId ?? ''}`}>
                  数量 {it.qty} · 单价 {it.price ?? '-'}
                </Descriptions.Item>
              ))}
            </Descriptions>
            {(detail.work_orders && detail.work_orders.length > 0) && (
              <>
                <Typography.Title level={5}>关联工单</Typography.Title>
                {detail.work_orders.map(w => (
                  <Tag key={w.id} color="blue">WO#{w.id} · {w.product_name} · {w.status}</Tag>
                ))}
              </>
            )}
          </>
        )}
      </Drawer>
    </Card>
  );
}
