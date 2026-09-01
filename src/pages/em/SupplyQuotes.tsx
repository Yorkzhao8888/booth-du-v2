import { useEffect, useState } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, InputNumber, Select, DatePicker, message, Drawer, Descriptions, Timeline, Tabs, Tooltip, Badge } from 'antd';
import { PlusOutlined, EyeOutlined, EditOutlined, CheckOutlined, CloseOutlined, HistoryOutlined, SwapOutlined, DollarOutlined } from '@ant-design/icons';
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
  bom_material_cost: number;
  labor_cost: number;
  manufacturing_fee: number;
  supply_price: number;
  margin_rate: number;
  gross_profit: number;
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

// Monospace font style for numbers
const monoStyle: React.CSSProperties = {
  fontFamily: "'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace",
  fontVariantNumeric: 'tabular-nums',
};

// Format currency with monospace
const formatCurrency = (v: number | null | undefined): React.ReactNode => {
  if (v === null || v === undefined) return '-';
  return <span style={monoStyle}>¥{v.toFixed(2)}</span>;
};

// Format percentage with monospace
const formatPercent = (v: number | null | undefined): React.ReactNode => {
  if (v === null || v === undefined) return '-';
  return <span style={monoStyle}>{v.toFixed(1)}%</span>;
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
  const [compareOpen, setCompareOpen] = useState(false);
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

  const showCompare = async (quote: SupplyQuote) => {
    setSelectedQuote(quote);
    try {
      const vRes = await api(`/em/supply-quotes/${quote.id}/versions`);
      setVersions(vRes.data || []);
      setCompareOpen(true);
    } catch { message.error('获取版本历史失败'); }
  };

  // Price composition columns with full detail
  const columns = [
    {
      title: '报价单号',
      dataIndex: 'quote_no',
      key: 'quote_no',
      width: 140,
      fixed: 'left' as const,
      render: (v: string) => <span style={{ ...monoStyle, color: '#1F3A5F', fontWeight: 600 }}>{v}</span>,
    },
    {
      title: 'SKU',
      dataIndex: 'sku_name',
      key: 'sku_name',
      width: 100,
      render: (v: string) => v || '-',
    },
    {
      title: '铺类型',
      dataIndex: 'sgu_booth_type',
      key: 'sgu_booth_type',
      width: 70,
      render: (v: string) => {
        const colors: Record<string, string> = { sundry: '#8c8c8c', material: '#16a37b', device: '#2f6bff', plaza: '#c9a227' };
        const labels: Record<string, string> = { sundry: '杂货', material: '原料', device: '设备', plaza: '场地' };
        return v ? <Tag color={colors[v] || '#8c8c8c'}>{labels[v] || v}</Tag> : '-';
      },
    },
    {
      title: <Tooltip title="BOM材料成本"><DollarOutlined style={{ color: '#16a37b' }} /> BOM</Tooltip>,
      dataIndex: 'bom_material_cost',
      key: 'bom_material_cost',
      width: 90,
      align: 'right' as const,
      render: formatCurrency,
    },
    {
      title: <Tooltip title="人工费"><DollarOutlined style={{ color: '#2f6bff' }} /> 人工</Tooltip>,
      dataIndex: 'labor_cost',
      key: 'labor_cost',
      width: 80,
      align: 'right' as const,
      render: formatCurrency,
    },
    {
      title: <Tooltip title="制造/服务费"><DollarOutlined style={{ color: '#c9a227' }} /> 制费</Tooltip>,
      dataIndex: 'manufacturing_fee',
      key: 'manufacturing_fee',
      width: 80,
      align: 'right' as const,
      render: formatCurrency,
    },
    {
      title: <Tooltip title="供给价 = BOM + 人工 + 制费"><strong style={{ color: '#1F3A5F' }}>供给价</strong></Tooltip>,
      dataIndex: 'supply_price',
      key: 'supply_price',
      width: 100,
      align: 'right' as const,
      render: (v: number) => <span style={{ ...monoStyle, color: '#1F3A5F', fontWeight: 600 }}>¥{v?.toFixed(2)}</span>,
    },
    {
      title: <Tooltip title="毛利率"><strong style={{ color: '#c9a227' }}>毛利率</strong></Tooltip>,
      dataIndex: 'margin_rate',
      key: 'margin_rate',
      width: 70,
      align: 'right' as const,
      render: formatPercent,
    },
    {
      title: <Tooltip title="毛利额"><strong style={{ color: '#16a37b' }}>毛利</strong></Tooltip>,
      dataIndex: 'gross_profit',
      key: 'gross_profit',
      width: 80,
      align: 'right' as const,
      render: formatCurrency,
    },
    {
      title: <Tooltip title="总价 = 供给价 × (1 + 毛利率)"><strong style={{ color: '#16a37b' }}>总价</strong></Tooltip>,
      dataIndex: 'total_price',
      key: 'total_price',
      width: 100,
      align: 'right' as const,
      render: (v: number) => <span style={{ ...monoStyle, color: '#16a37b', fontWeight: 600 }}>¥{v?.toFixed(2)}</span>,
    },
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 70,
      align: 'center' as const,
      render: (v: number) => (
        <Badge
          count={`v${v}`}
          style={{
            backgroundColor: v > 1 ? '#c9a227' : '#8c8c8c',
            fontFamily: monoStyle.fontFamily,
            fontWeight: 600,
          }}
        />
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (s: string) => <Tag color={statusColors[s]}>{statusLabels[s]}</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      fixed: 'right' as const,
      render: (_: any, r: SupplyQuote) => (
        <Space size="small">
          <Tooltip title="查看详情+版本历史">
            <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => showDetail(r)}>详情</Button>
          </Tooltip>
          {r.version > 1 && (
            <Tooltip title="版本对比">
              <Button type="link" size="small" icon={<SwapOutlined />} onClick={() => showCompare(r)}>对比</Button>
            </Tooltip>
          )}
          {r.status === 'draft' && (
            <>
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => showEdit(r)}>编辑</Button>
              <Button type="link" size="small" icon={<CheckOutlined />} onClick={() => handleApprove(r.id)}>批准</Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  // Version comparison columns
  const versionColumns = [
    { title: '版本', dataIndex: 'version', key: 'version', width: 60, render: (v: number) => <Badge count={`v${v}`} style={{ backgroundColor: '#1F3A5F' }} /> },
    { title: 'BOM材料', dataIndex: 'bom_material_cost', key: 'bom_material_cost', width: 90, align: 'right' as const, render: formatCurrency },
    { title: '人工费', dataIndex: 'labor_cost', key: 'labor_cost', width: 80, align: 'right' as const, render: formatCurrency },
    { title: '制费', dataIndex: 'manufacturing_fee', key: 'manufacturing_fee', width: 80, align: 'right' as const, render: formatCurrency },
    { title: '供给价', dataIndex: 'supply_price', key: 'supply_price', width: 90, align: 'right' as const, render: (v: number) => <span style={{ ...monoStyle, fontWeight: 600 }}>¥{v?.toFixed(2)}</span> },
    { title: '毛利率', dataIndex: 'margin_rate', key: 'margin_rate', width: 70, align: 'right' as const, render: formatPercent },
    { title: '总价', dataIndex: 'total_price', key: 'total_price', width: 90, align: 'right' as const, render: (v: number) => <span style={{ ...monoStyle, fontWeight: 600, color: '#16a37b' }}>¥{v?.toFixed(2)}</span> },
    { title: '状态', dataIndex: 'status', key: 'status', width: 70, render: (s: string) => <Tag color={statusColors[s]}>{statusLabels[s]}</Tag> },
    { title: '变更原因', dataIndex: 'change_reason', key: 'change_reason', width: 150, render: (v: string) => v || '-' },
    { title: '变更时间', dataIndex: 'created_at', key: 'created_at', width: 140, render: (v: string) => new Date(v).toLocaleString() },
  ];

  return (
    <div>
      <Card
        title={
          <Space>
            <DollarOutlined style={{ color: '#c9a227' }} />
            <span>供给报价单管理</span>
            <Tag color="default" style={{ fontSize: 11 }}>EM 策略层 · 完整价格可见</Tag>
          </Space>
        }
        extra={
          <Space>
            <Select
              style={{ width: 120 }}
              placeholder="状态筛选"
              allowClear
              onChange={(v) => { setStatusFilter(v || ''); setPage(1); }}
              options={[
                { value: 'draft', label: '草稿' },
                { value: 'pending', label: '待审批' },
                { value: 'approved', label: '已批准' },
                { value: 'rejected', label: '已拒绝' },
              ]}
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
          scroll={{ x: 1400 }}
          rowClassName={(_, i) => i % 2 === 1 ? 'booth-zebra' : ''}
        />
      </Card>

      {/* Create Modal */}
      <Modal
        title="新建供给报价单"
        open={createOpen}
        onCancel={() => { setCreateOpen(false); form.resetFields(); }}
        footer={null}
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="sguId" label="SGU ID" rules={[{ required: true, message: '请输入SGU ID' }]}>
            <InputNumber style={{ width: '100%' }} placeholder="关联的SGU ID" />
          </Form.Item>
          <Form.Item name="bomMaterialCost" label="BOM材料成本" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} prefix="¥" precision={2} min={0} />
          </Form.Item>
          <Form.Item name="laborCost" label="人工费" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} prefix="¥" precision={2} min={0} />
          </Form.Item>
          <Form.Item name="manufacturingFee" label="制造/服务费" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} prefix="¥" precision={2} min={0} />
          </Form.Item>
          <Form.Item name="marginRate" label="毛利率(%)" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} suffix="%" precision={1} min={0} max={100} />
          </Form.Item>
          <Form.Item name="effectiveFrom" label="生效日期">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="effectiveTo" label="失效日期">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block>创建报价单</Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        title={`编辑报价单 - ${selectedQuote?.quote_no || ''}`}
        open={editOpen}
        onCancel={() => { setEditOpen(false); editForm.resetFields(); }}
        footer={null}
        width={600}
      >
        <Form form={editForm} layout="vertical" onFinish={handleUpdate}>
          <Form.Item name="bomMaterialCost" label="BOM材料成本" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} prefix="¥" precision={2} min={0} />
          </Form.Item>
          <Form.Item name="laborCost" label="人工费" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} prefix="¥" precision={2} min={0} />
          </Form.Item>
          <Form.Item name="manufacturingFee" label="制造/服务费" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} prefix="¥" precision={2} min={0} />
          </Form.Item>
          <Form.Item name="marginRate" label="毛利率(%)" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} suffix="%" precision={1} min={0} max={100} />
          </Form.Item>
          <Form.Item name="changeReason" label="变更原因" rules={[{ required: true, message: '请输入变更原因' }]}>
            <Input.TextArea rows={3} placeholder="请说明变更原因（将记录到审计日志）" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block>提交变更</Button>
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
          <Tabs
            items={[
              {
                key: 'detail',
                label: '报价详情',
                children: (
                  <Descriptions column={2} bordered size="small">
                    <Descriptions.Item label="报价单号"><span style={monoStyle}>{selectedQuote.quote_no}</span></Descriptions.Item>
                    <Descriptions.Item label="状态"><Tag color={statusColors[selectedQuote.status]}>{statusLabels[selectedQuote.status]}</Tag></Descriptions.Item>
                    <Descriptions.Item label="SKU">{selectedQuote.sku_name || '-'}</Descriptions.Item>
                    <Descriptions.Item label="铺类型">{selectedQuote.sgu_booth_type || '-'}</Descriptions.Item>
                    <Descriptions.Item label="版本"><Badge count={`v${selectedQuote.version}`} style={{ backgroundColor: selectedQuote.version > 1 ? '#c9a227' : '#8c8c8c' }} /></Descriptions.Item>
                    <Descriptions.Item label="创建时间">{new Date(selectedQuote.created_at).toLocaleString()}</Descriptions.Item>
                    <Descriptions.Item label="BOM材料成本">{formatCurrency(selectedQuote.bom_material_cost)}</Descriptions.Item>
                    <Descriptions.Item label="人工费">{formatCurrency(selectedQuote.labor_cost)}</Descriptions.Item>
                    <Descriptions.Item label="制造/服务费">{formatCurrency(selectedQuote.manufacturing_fee)}</Descriptions.Item>
                    <Descriptions.Item label="供给价"><span style={{ ...monoStyle, color: '#1F3A5F', fontWeight: 600, fontSize: 16 }}>¥{selectedQuote.supply_price?.toFixed(2)}</span></Descriptions.Item>
                    <Descriptions.Item label="毛利率">{formatPercent(selectedQuote.margin_rate)}</Descriptions.Item>
                    <Descriptions.Item label="毛利额">{formatCurrency(selectedQuote.gross_profit)}</Descriptions.Item>
                    <Descriptions.Item label="总价" span={2}><span style={{ ...monoStyle, color: '#16a37b', fontWeight: 600, fontSize: 18 }}>¥{selectedQuote.total_price?.toFixed(2)}</span></Descriptions.Item>
                    <Descriptions.Item label="生效日期">{selectedQuote.effective_from ? new Date(selectedQuote.effective_from).toLocaleDateString() : '-'}</Descriptions.Item>
                    <Descriptions.Item label="失效日期">{selectedQuote.effective_to ? new Date(selectedQuote.effective_to).toLocaleDateString() : '-'}</Descriptions.Item>
                  </Descriptions>
                ),
              },
              {
                key: 'versions',
                label: <span><HistoryOutlined /> 版本历史</span>,
                children: (
                  <Table
                    rowKey="id"
                    columns={versionColumns}
                    dataSource={versions}
                    pagination={false}
                    size="small"
                    scroll={{ x: 900 }}
                  />
                ),
              },
              {
                key: 'audit',
                label: <span><HistoryOutlined /> 审计日志</span>,
                children: (
                  <Timeline
                    items={auditLogs.map(log => ({
                      children: (
                        <div>
                          <div><strong>{log.action}</strong> by {log.actor_name || '系统'}</div>
                          {log.reason && <div style={{ color: '#666', fontSize: 12 }}>原因: {log.reason}</div>}
                          <div style={{ color: '#999', fontSize: 11 }}>{new Date(log.created_at).toLocaleString()}</div>
                        </div>
                      ),
                    }))}
                  />
                ),
              },
            ]}
          />
        )}
      </Drawer>

      {/* Version Compare Modal */}
      <Modal
        title={`版本对比 - ${selectedQuote?.quote_no || ''}`}
        open={compareOpen}
        onCancel={() => setCompareOpen(false)}
        footer={null}
        width={900}
      >
        <Table
          rowKey="id"
          columns={versionColumns}
          dataSource={versions}
          pagination={false}
          size="small"
          scroll={{ x: 900 }}
          rowClassName={(_, i) => i % 2 === 1 ? 'booth-zebra' : ''}
        />
      </Modal>
    </div>
  );
}
