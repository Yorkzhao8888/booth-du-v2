import { useEffect, useState } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, InputNumber, Select, DatePicker, message, Drawer, Descriptions, Timeline, Tabs } from 'antd';
import { PlusOutlined, EyeOutlined, EditOutlined, CheckOutlined, CloseOutlined, HistoryOutlined } from '@ant-design/icons';
import { api } from '../../api';

interface SupplyQuote {
  id: number;
  quote_no: string;
  sgu_id: number | null;
  sku_id: number | null;
  sku_name: string | null;
  sgu_booth_type: string | null;
  bom_material_cost: number;
  labor_cost: number;
  manufacturing_fee: number;
  supply_price: number;
  margin_rate: number;
  gross_profit: number;
  total_price: number;
  version: number;
  status: string;
  effective_from: string | null;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

interface QuoteVersion {
  id: number;
  version: number;
  supply_price: number;
  total_price: number;
  status: string;
  change_reason: string | null;
  created_at: string;
  changed_by_name: string | null;
}

interface AuditLog {
  id: number;
  action: string;
  actor_name: string | null;
  reason: string | null;
  created_at: string;
}

const statusColors: Record<string, string> = {
  draft: 'default',
  pending: 'processing',
  approved: 'success',
  rejected: 'error',
  expired: 'warning',
};

const statusLabels: Record<string, string> = {
  draft: '草稿',
  pending: '待审批',
  approved: '已批准',
  rejected: '已拒绝',
  expired: '已过期',
};

export default function EmSupplyQuotes() {
  const [quotes, setQuotes] = useState<SupplyQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<SupplyQuote | null>(null);
  const [versions, setVersions] = useState<QuoteVersion[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  const fetchQuotes = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (statusFilter) params.append('status', statusFilter);
      const res = await api(`/em/supply-quotes?${params}`);
      setQuotes(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch { message.error('获取报价单失败'); }
    setLoading(false);
  };

  useEffect(() => { fetchQuotes(); }, [page, statusFilter]);

  const handleCreate = async (values: any) => {
    try {
      await api('/em/supply-quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      message.success('报价单创建成功');
      setCreateOpen(false);
      form.resetFields();
      fetchQuotes();
    } catch { message.error('创建失败'); }
  };

  const handleUpdate = async (values: any) => {
    if (!selectedQuote) return;
    try {
      await api(`/em/supply-quotes/${selectedQuote.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      message.success('报价单更新成功');
      setEditOpen(false);
      editForm.resetFields();
      fetchQuotes();
    } catch { message.error('更新失败'); }
  };

  const handleApprove = async (id: number) => {
    try {
      await api(`/em/supply-quotes/${id}/approve`, { method: 'POST' });
      message.success('报价单已批准');
      fetchQuotes();
    } catch { message.error('批准失败'); }
  };

  const handleReject = async (id: number) => {
    const reason = prompt('请输入拒绝原因:');
    if (reason === null) return;
    try {
      await api(`/em/supply-quotes/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      message.success('报价单已拒绝');
      fetchQuotes();
    } catch { message.error('拒绝失败'); }
  };

  const showDetail = async (quote: SupplyQuote) => {
    setSelectedQuote(quote);
    setDetailOpen(true);
    try {
      const [vRes, aRes] = await Promise.all([
        api(`/em/supply-quotes/${quote.id}/versions`),
        api(`/em/supply-quotes/${quote.id}/audit`),
      ]);
      setVersions(vRes.data || []);
      setAuditLogs(aRes.data || []);
    } catch { /* ignore */ }
  };

  const showEdit = (quote: SupplyQuote) => {
    setSelectedQuote(quote);
    editForm.setFieldsValue({
      bomMaterialCost: quote.bom_material_cost,
      laborCost: quote.labor_cost,
      manufacturingFee: quote.manufacturing_fee,
      marginRate: quote.margin_rate,
      changeReason: '',
    });
    setEditOpen(true);
  };

  const columns = [
    { title: '报价单号', dataIndex: 'quote_no', key: 'quote_no', width: 150 },
    { title: 'SKU', dataIndex: 'sku_name', key: 'sku_name', width: 120, render: (v: string) => v || '-' },
    { title: '铺类型', dataIndex: 'sgu_booth_type', key: 'sgu_booth_type', width: 80, render: (v: string) => v || '-' },
    { title: '供给价', dataIndex: 'supply_price', key: 'supply_price', width: 100, render: (v: number) => `¥${v?.toFixed(2)}` },
    { title: '毛利率', dataIndex: 'margin_rate', key: 'margin_rate', width: 80, render: (v: number) => `${v}%` },
    { title: '总价', dataIndex: 'total_price', key: 'total_price', width: 100, render: (v: number) => `¥${v?.toFixed(2)}` },
    { title: '版本', dataIndex: 'version', key: 'version', width: 60 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (s: string) => <Tag color={statusColors[s]}>{statusLabels[s]}</Tag> },
    {
      title: '操作', key: 'actions', width: 200,
      render: (_: any, r: SupplyQuote) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => showDetail(r)}>详情</Button>
          {r.status === 'draft' && <Button type="link" size="small" icon={<EditOutlined />} onClick={() => showEdit(r)}>编辑</Button>}
          {r.status === 'draft' && <Button type="link" size="small" icon={<CheckOutlined />} onClick={() => handleApprove(r.id)}>批准</Button>}
          {r.status === 'draft' && <Button type="link" size="small" danger icon={<CloseOutlined />} onClick={() => handleReject(r.id)}>拒绝</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title="供给报价单管理"
        extra={
          <Space>
            <Select
              style={{ width: 120 }}
              placeholder="状态筛选"
              allowClear
              onChange={(v) => { setStatusFilter(v || ''); setPage(1); }}
              options={Object.entries(statusLabels).map(([k, v]) => ({ value: k, label: v }))}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建报价单</Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={quotes}
          loading={loading}
          pagination={{ current: page, total, pageSize: 20, onChange: setPage }}
          size="small"
          scroll={{ x: 1000 }}
        />
      </Card>

      {/* Create Modal */}
      <Modal title="新建供给报价单" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => form.submit()} width={600}>
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="bomMaterialCost" label="BOM材料成本" rules={[{ required: true }]}>
            <InputNumber prefix="¥" style={{ width: '100%' }} min={0} precision={2} />
          </Form.Item>
          <Form.Item name="laborCost" label="人工费" rules={[{ required: true }]}>
            <InputNumber prefix="¥" style={{ width: '100%' }} min={0} precision={2} />
          </Form.Item>
          <Form.Item name="manufacturingFee" label="制造/服务费" rules={[{ required: true }]}>
            <InputNumber prefix="¥" style={{ width: '100%' }} min={0} precision={2} />
          </Form.Item>
          <Form.Item name="marginRate" label="毛利率 (%)" rules={[{ required: true }]}>
            <InputNumber suffix="%" style={{ width: '100%' }} min={0} max={100} precision={2} />
          </Form.Item>
          <Form.Item name="skuId" label="关联SKU ID">
            <InputNumber style={{ width: '100%' }} min={1} />
          </Form.Item>
          <Form.Item name="effectiveFrom" label="生效日期">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="effectiveTo" label="失效日期">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit Modal */}
      <Modal title="编辑报价单" open={editOpen} onCancel={() => setEditOpen(false)} onOk={() => editForm.submit()} width={500}>
        <Form form={editForm} layout="vertical" onFinish={handleUpdate}>
          <Form.Item name="bomMaterialCost" label="BOM材料成本" rules={[{ required: true }]}>
            <InputNumber prefix="¥" style={{ width: '100%' }} min={0} precision={2} />
          </Form.Item>
          <Form.Item name="laborCost" label="人工费" rules={[{ required: true }]}>
            <InputNumber prefix="¥" style={{ width: '100%' }} min={0} precision={2} />
          </Form.Item>
          <Form.Item name="manufacturingFee" label="制造/服务费" rules={[{ required: true }]}>
            <InputNumber prefix="¥" style={{ width: '100%' }} min={0} precision={2} />
          </Form.Item>
          <Form.Item name="marginRate" label="毛利率 (%)" rules={[{ required: true }]}>
            <InputNumber suffix="%" style={{ width: '100%' }} min={0} max={100} precision={2} />
          </Form.Item>
          <Form.Item name="changeReason" label="变更原因" rules={[{ required: true }]}>
            <Input.TextArea rows={2} placeholder="请输入变更原因" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Detail Drawer */}
      <Drawer
        title={`报价单详情 - ${selectedQuote?.quote_no || ''}`}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={600}
      >
        {selectedQuote && (
          <Tabs items={[
            {
              key: 'detail',
              label: '基本信息',
              children: (
                <Descriptions column={2} bordered size="small">
                  <Descriptions.Item label="报价单号">{selectedQuote.quote_no}</Descriptions.Item>
                  <Descriptions.Item label="状态"><Tag color={statusColors[selectedQuote.status]}>{statusLabels[selectedQuote.status]}</Tag></Descriptions.Item>
                  <Descriptions.Item label="SKU">{selectedQuote.sku_name || '-'}</Descriptions.Item>
                  <Descriptions.Item label="铺类型">{selectedQuote.sgu_booth_type || '-'}</Descriptions.Item>
                  <Descriptions.Item label="版本">v{selectedQuote.version}</Descriptions.Item>
                  <Descriptions.Item label="创建时间">{new Date(selectedQuote.created_at).toLocaleString()}</Descriptions.Item>
                  <Descriptions.Item label="BOM材料成本" span={2}>¥{selectedQuote.bom_material_cost?.toFixed(2)}</Descriptions.Item>
                  <Descriptions.Item label="人工费" span={2}>¥{selectedQuote.labor_cost?.toFixed(2)}</Descriptions.Item>
                  <Descriptions.Item label="制造/服务费" span={2}>¥{selectedQuote.manufacturing_fee?.toFixed(2)}</Descriptions.Item>
                  <Descriptions.Item label="供给价" span={2}><strong>¥{selectedQuote.supply_price?.toFixed(2)}</strong></Descriptions.Item>
                  <Descriptions.Item label="毛利率">{selectedQuote.margin_rate}%</Descriptions.Item>
                  <Descriptions.Item label="毛利额">¥{selectedQuote.gross_profit?.toFixed(2)}</Descriptions.Item>
                  <Descriptions.Item label="总价" span={2}><strong style={{ fontSize: 16 }}>¥{selectedQuote.total_price?.toFixed(2)}</strong></Descriptions.Item>
                  <Descriptions.Item label="生效日期">{selectedQuote.effective_from ? new Date(selectedQuote.effective_from).toLocaleDateString() : '-'}</Descriptions.Item>
                  <Descriptions.Item label="失效日期">{selectedQuote.effective_to ? new Date(selectedQuote.effective_to).toLocaleDateString() : '-'}</Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              key: 'versions',
              label: <span><HistoryOutlined /> 版本历史</span>,
              children: (
                <Timeline
                  items={versions.map(v => ({
                    children: (
                      <div>
                        <div><strong>v{v.version}</strong> - {v.changed_by_name || '系统'}</div>
                        <div>供给价: ¥{v.supply_price?.toFixed(2)} | 总价: ¥{v.total_price?.toFixed(2)}</div>
                        {v.change_reason && <div style={{ color: '#666' }}>{v.change_reason}</div>}
                        <div style={{ color: '#999', fontSize: 12 }}>{new Date(v.created_at).toLocaleString()}</div>
                      </div>
                    ),
                  }))}
                />
              ),
            },
            {
              key: 'audit',
              label: '审计日志',
              children: (
                <Timeline
                  items={auditLogs.map(a => ({
                    children: (
                      <div>
                        <div><Tag>{a.action}</Tag> {a.actor_name || '系统'}</div>
                        {a.reason && <div style={{ color: '#666' }}>{a.reason}</div>}
                        <div style={{ color: '#999', fontSize: 12 }}>{new Date(a.created_at).toLocaleString()}</div>
                      </div>
                    ),
                  }))}
                />
              ),
            },
          ]} />
        )}
      </Drawer>
    </div>
  );
}
