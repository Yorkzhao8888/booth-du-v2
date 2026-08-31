import { useEffect, useState } from 'react';
import { Card, Table, Button, Tag, Space, message, Modal, Form, Input, InputNumber, Select } from 'antd';
import { CheckOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { api } from '../../api';

interface SguPending {
  id: number; sku_id: number; source: string; status: string;
  suggested_booth_type: string; sku_code: string; sku_name: string; unit: string;
  created_at: string;
}

interface Sku { id: number; sku_code: string; name: string; unit: string; }

const boothTypeOptions = [
  { label: '杂货铺 Sundry', value: 'sundry' },
  { label: '原料铺 Material', value: 'material' },
  { label: '设备铺 Device', value: 'device' },
  { label: '场地铺 Plaza', value: 'plaza' },
];

export default function EmSguPending() {
  const [data, setData] = useState<SguPending[]>([]);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [triggerModalOpen, setTriggerModalOpen] = useState(false);
  const [selectedPending, setSelectedPending] = useState<SguPending | null>(null);
  const [createForm] = Form.useForm();
  const [triggerForm] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [pendingRes, skuRes] = await Promise.all([
        api.get('/em/sgu/pending'),
        api.get('/em/sku'),
      ]);
      setData(pendingRes.data?.data || []);
      setSkus(skuRes.data?.data || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreateFromPending = async () => {
    if (!selectedPending) return;
    const values = await createForm.validateFields();
    await api.post(`/em/sgu/pending/${selectedPending.id}/create`, values);
    message.success('SGU 创建成功');
    setCreateModalOpen(false);
    createForm.resetFields();
    setSelectedPending(null);
    fetchData();
  };

  const handleIgnore = async (id: number) => {
    await api.post(`/em/sgu/pending/${id}/ignore`);
    message.success('已忽略');
    fetchData();
  };

  const handleTriggerSkuCreated = async () => {
    const values = await triggerForm.validateFields();
    await api.post('/em/sgu/trigger-sku-created', values);
    message.success('SKU-Created 事件已触发，待办已创建');
    setTriggerModalOpen(false);
    triggerForm.resetFields();
    fetchData();
  };

  const columns = [
    { title: 'SKU', dataIndex: 'sku_code', width: 100 },
    { title: '商品名称', dataIndex: 'sku_name', width: 140 },
    {
      title: '来源', dataIndex: 'source', width: 120,
      render: (v: string) => <Tag color="blue">{v === 'sku-created' ? 'SKU-Created' : v}</Tag>,
    },
    {
      title: '建议铺类型', dataIndex: 'suggested_booth_type', width: 100,
      render: (v: string) => {
        const map: Record<string, string> = { sundry: '杂货', material: '原料', device: '设备', plaza: '场地' };
        return <Tag>{map[v] || v}</Tag>;
      },
    },
    {
      title: '创建时间', dataIndex: 'created_at', width: 160,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作', width: 200,
      render: (_: unknown, record: SguPending) => (
        <Space size="small">
          <Button type="primary" size="small" icon={<CheckOutlined />} onClick={() => {
            setSelectedPending(record);
            createForm.setFieldsValue({ boothType: record.suggested_booth_type });
            setCreateModalOpen(true);
          }}>创建 SGU</Button>
          <Button size="small" danger icon={<CloseOutlined />} onClick={() => handleIgnore(record.id)}>忽略</Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <Card
        title={<span style={{ fontWeight: 600 }}>SGU 待办 (SKU-Created 触发)</span>}
        extra={
          <Button icon={<PlusOutlined />} onClick={() => setTriggerModalOpen(true)}>
            模拟 SKU-Created 事件
          </Button>
        }
      >
        {data.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
            暂无待办。当 Shop 发布新品（SKU-Created 事件）时，此处将显示创建 SGU 的待办任务。
          </div>
        ) : (
          <Table dataSource={data} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} size="small" />
        )}
      </Card>

      {/* Create SGU from pending */}
      <Modal
        title={`创建 SGU - ${selectedPending?.sku_code || ''}`}
        open={createModalOpen}
        onOk={handleCreateFromPending}
        onCancel={() => { setCreateModalOpen(false); setSelectedPending(null); createForm.resetFields(); }}
        width={480}
      >
        <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="boothType" label="铺类型" rules={[{ required: true }]}>
            <Select options={boothTypeOptions} />
          </Form.Item>
          <Form.Item name="trafficCap" label="产能上限/日" initialValue={0}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="leadTimeHours" label="标准交期(小时)" initialValue={24}>
            <InputNumber min={1} max={720} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="unitPrice" label="单价(分)" initialValue={0}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Trigger SKU-Created event */}
      <Modal
        title="模拟 SKU-Created 事件"
        open={triggerModalOpen}
        onOk={handleTriggerSkuCreated}
        onCancel={() => { setTriggerModalOpen(false); triggerForm.resetFields(); }}
        width={480}
      >
        <Form form={triggerForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="skuId" label="选择 SKU" rules={[{ required: true }]}>
            <Select placeholder="选择新品 SKU"
              options={skus.map(s => ({ label: `${s.sku_code} - ${s.name}`, value: s.id }))}
              showSearch optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item name="suggestedBoothType" label="建议铺类型" initialValue="sundry">
            <Select options={boothTypeOptions} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
