import { useEffect, useState } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, InputNumber, Select, message, Descriptions, Tooltip, Row, Col, Statistic } from 'antd';
import { PlusOutlined, EditOutlined, ShopOutlined, DatabaseOutlined, CheckCircleOutlined, PauseCircleOutlined, FileTextOutlined } from '@ant-design/icons';
import { api } from '../../api';

interface Sku { id: number; sku_code: string; name: string; unit: string; }
interface SguCatalog {
  id: number; sgu_no: string; sku_id: number; booth_type: string; status: string;
  traffic_cap: number; lead_time_hours: number; unit_price: number; description: string | null;
  capacity_resource_id: number | null; sku_code: string; sku_name: string; unit: string;
  created_at: string; updated_at: string;
}

const boothTypeOptions = [
  { label: '杂货铺 Sundry', value: 'sundry' },
  { label: '原料铺 Material', value: 'material' },
  { label: '设备铺 Device', value: 'device' },
  { label: '场地铺 Plaza', value: 'plaza' },
];

const boothTypeMap: Record<string, { label: string; color: string }> = {
  sundry: { label: '杂货', color: '#8c8c8c' },
  material: { label: '原料', color: '#16a37b' },
  device: { label: '设备', color: '#2f6bff' },
  plaza: { label: '场地', color: '#c9a227' },
};

const statusMap: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
  draft: { color: 'default', label: '草稿', icon: <FileTextOutlined /> },
  active: { color: 'success', label: '生效', icon: <CheckCircleOutlined /> },
  suspended: { color: 'warning', label: '停用', icon: <PauseCircleOutlined /> },
  delisted: { color: 'error', label: '已下架', icon: <FileTextOutlined /> },
};

// Monospace font style for numbers
const monoStyle: React.CSSProperties = {
  fontFamily: "'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace",
  fontVariantNumeric: 'tabular-nums',
};

export default function EmSguCatalog() {
  const [data, setData] = useState<SguCatalog[]>([]);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SguCatalog | null>(null);
  const [form] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [sguRes, skuRes] = await Promise.all([
        api.get('/em/sgu/catalog'),
        api.get('/em/sku'),
      ]);
      setData(sguRes.data?.data || []);
      setSkus(skuRes.data?.data || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    const values = await form.validateFields();
    if (editing) {
      await api.put(`/em/sgu/catalog/${editing.id}`, values);
      message.success('更新成功');
    } else {
      await api.post('/em/sgu/catalog', values);
      message.success('创建成功');
    }
    setModalOpen(false);
    form.resetFields();
    setEditing(null);
    fetchData();
  };

  // Statistics
  const totalSgu = data.length;
  const activeSgu = data.filter(d => d.status === 'active').length;
  const draftSgu = data.filter(d => d.status === 'draft').length;
  const suspendedSgu = data.filter(d => d.status === 'suspended').length;

  const columns = [
    {
      title: 'SGU编号',
      dataIndex: 'sgu_no',
      width: 130,
      render: (v: string) => <span style={{ ...monoStyle, fontWeight: 500, color: '#1f3a5f' }}>{v}</span>,
    },
    {
      title: 'SKU',
      dataIndex: 'sku_code',
      width: 100,
      render: (v: string) => <span style={monoStyle}>{v}</span>,
    },
    {
      title: '商品名称',
      dataIndex: 'sku_name',
      width: 140,
      ellipsis: true,
    },
    {
      title: '铺类型',
      dataIndex: 'booth_type',
      width: 90,
      render: (v: string) => {
        const info = boothTypeMap[v] || { label: v, color: '#8c8c8c' };
        return <Tag color={info.color} style={{ minWidth: 48, textAlign: 'center' }}>{info.label}</Tag>;
      },
    },
    {
      title: '产能上限/日',
      dataIndex: 'traffic_cap',
      width: 110,
      align: 'right' as const,
      render: (v: number) => (
        <span style={monoStyle}>
          {v.toLocaleString()} <span style={{ fontSize: 11, color: '#8c8c8c' }}>件/日</span>
        </span>
      ),
    },
    {
      title: '交期',
      dataIndex: 'lead_time_hours',
      width: 90,
      align: 'right' as const,
      render: (v: number) => (
        <span style={monoStyle}>
          {v} <span style={{ fontSize: 11, color: '#8c8c8c' }}>h</span>
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => {
        const s = statusMap[v] || { color: 'default', label: v, icon: null };
        return (
          <Tag color={s.color} icon={s.icon} style={{ minWidth: 60, textAlign: 'center' }}>
            {s.label}
          </Tag>
        );
      },
    },
    {
      title: '操作',
      width: 140,
      fixed: 'right' as const,
      render: (_: unknown, record: SguCatalog) => (
        <Space size="small">
          <Tooltip title="编辑 SGU">
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => { setEditing(record); form.setFieldsValue(record); setModalOpen(true); }}
            />
          </Tooltip>
          <Tooltip title="创建挂牌 → Market">
            <Button
              type="link"
              size="small"
              icon={<ShopOutlined />}
              disabled={record.status !== 'active'}
              onClick={async () => {
                await api.post('/em/sgu/listings', { sguId: record.id });
                message.success('挂牌创建成功，Market 可检索');
                fetchData();
              }}
            >
              挂牌
            </Button>
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* Statistics Cards */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small" style={{ borderLeft: '3px solid #1f3a5f' }}>
            <Statistic
              title={<span style={{ fontSize: 12, color: '#666' }}>SGU 总数</span>}
              value={totalSgu}
              prefix={<DatabaseOutlined style={{ color: '#1f3a5f' }} />}
              valueStyle={{ ...monoStyle, color: '#1f3a5f', fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ borderLeft: '3px solid #16a37b' }}>
            <Statistic
              title={<span style={{ fontSize: 12, color: '#666' }}>生效中</span>}
              value={activeSgu}
              prefix={<CheckCircleOutlined style={{ color: '#16a37b' }} />}
              valueStyle={{ ...monoStyle, color: '#16a37b', fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ borderLeft: '3px solid #8c8c8c' }}>
            <Statistic
              title={<span style={{ fontSize: 12, color: '#666' }}>草稿</span>}
              value={draftSgu}
              prefix={<FileTextOutlined style={{ color: '#8c8c8c' }} />}
              valueStyle={{ ...monoStyle, color: '#666', fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ borderLeft: '3px solid #d97b1f' }}>
            <Statistic
              title={<span style={{ fontSize: 12, color: '#666' }}>已停用</span>}
              value={suspendedSgu}
              prefix={<PauseCircleOutlined style={{ color: '#d97b1f' }} />}
              valueStyle={{ ...monoStyle, color: '#d97b1f', fontWeight: 600 }}
            />
          </Card>
        </Col>
      </Row>

      <Card
        title={<span style={{ fontWeight: 600, color: '#1f3a5f' }}>SGU 供给目录</span>}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); form.resetFields(); setModalOpen(true); }}>
            新建 SGU
          </Button>
        }
      >
        <Table
          dataSource={data}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
          size="small"
          scroll={{ x: 1000 }}
        />
      </Card>

      <Modal
        title={editing ? '编辑 SGU' : '新建 SGU (CreateSGU)'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}
        width={520}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="skuId" label="关联 SKU" rules={[{ required: true, message: '请选择 SKU' }]}>
            <Select placeholder="选择 SKU" disabled={!!editing}
              options={skus.map(s => ({ label: `${s.sku_code} - ${s.name}`, value: s.id }))}
              showSearch optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item name="boothType" label="铺类型" rules={[{ required: true, message: '请选择铺类型' }]}>
            <Select placeholder="选择铺类型" options={boothTypeOptions} />
          </Form.Item>
          <Form.Item name="trafficCap" label="产能上限/日" rules={[{ required: true }]} extra="每日可供给的最大数量">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="如: 100" addonAfter="件/日" />
          </Form.Item>
          <Form.Item name="leadTimeHours" label="标准交期" initialValue={24} extra="从接单到交付的标准时间">
            <InputNumber min={1} max={720} style={{ width: '100%' }} addonAfter="小时" />
          </Form.Item>
          <Form.Item name="unitPrice" label="参考单价" extra="内部参考价格，不对执行层展示">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="内部参考" addonAfter="分" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={3} placeholder="供给能力说明，如产能特点、适用场景等" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
