import { useEffect, useState } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, InputNumber, Select, message, Descriptions, Tooltip } from 'antd';
import { PlusOutlined, EditOutlined, ShopOutlined } from '@ant-design/icons';
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

const statusMap: Record<string, { color: string; label: string }> = {
  draft: { color: 'default', label: '草稿' },
  active: { color: 'green', label: '生效' },
  suspended: { color: 'orange', label: '停用' },
  delisted: { color: 'red', label: '已下架' },
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

  const columns = [
    { title: 'SGU编号', dataIndex: 'sgu_no', width: 120 },
    { title: 'SKU', dataIndex: 'sku_code', width: 100 },
    { title: '商品名称', dataIndex: 'sku_name', width: 140 },
    {
      title: '铺类型', dataIndex: 'booth_type', width: 100,
      render: (v: string) => {
        const map: Record<string, string> = { sundry: '杂货', material: '原料', device: '设备', plaza: '场地' };
        return <Tag>{map[v] || v}</Tag>;
      },
    },
    { title: '产能上限/日', dataIndex: 'traffic_cap', width: 100, align: 'right' as const },
    { title: '交期(h)', dataIndex: 'lead_time_hours', width: 80, align: 'right' as const },
    {
      title: '状态', dataIndex: 'status', width: 80,
      render: (v: string) => {
        const s = statusMap[v] || { color: 'default', label: v };
        return <Tag color={s.color}>{s.label}</Tag>;
      },
    },
    {
      title: '操作', width: 150,
      render: (_: unknown, record: SguCatalog) => (
        <Space size="small">
          <Tooltip title="编辑"><Button type="link" size="small" icon={<EditOutlined />} onClick={() => { setEditing(record); form.setFieldsValue(record); setModalOpen(true); }} /></Tooltip>
          <Tooltip title="创建挂牌"><Button type="link" size="small" icon={<ShopOutlined />} onClick={async () => { await api.post('/em/sgu/listings', { sguId: record.id }); message.success('挂牌创建成功'); fetchData(); }} /></Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <Card
        title={<span style={{ fontWeight: 600 }}>SGU 供给目录</span>}
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); form.resetFields(); setModalOpen(true); }}>新建 SGU</Button>}
      >
        <Table dataSource={data} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} size="small" scroll={{ x: 900 }} />
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
          <Form.Item name="trafficCap" label="产能上限/日" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} placeholder="每日可供给数量" />
          </Form.Item>
          <Form.Item name="leadTimeHours" label="标准交期(小时)" initialValue={24}>
            <InputNumber min={1} max={720} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="unitPrice" label="单价(分)">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="内部参考价" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={3} placeholder="供给能力说明" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
