import { useEffect, useState } from 'react';
import { Table, Card, Tag, Button, Modal, Form, Input, InputNumber, Select, message, Space, Popconfirm, Steps, Descriptions } from 'antd';
import { PlusOutlined, CheckOutlined, CloseOutlined, SendOutlined } from '@ant-design/icons';
import { api } from '../../api';

interface TransferOrder {
  id: number;
  transfer_no: string;
  from_warehouse_type: string;
  to_warehouse_type: string;
  status: string;
  remark: string;
  creator_name: string;
  created_at: string;
  approved_at: string | null;
  completed_at: string | null;
  items: TransferItem[];
}

interface TransferItem {
  id: number;
  sku_id: number;
  sku_name: string;
  qty: number;
  remark: string;
}

const WAREHOUSE_LABELS: Record<string, string> = {
  material: '原材料仓',
  device: '设备仓',
  sundry: '杂项仓',
  plaza: '门店仓',
};

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  approved: { label: '已审批', color: 'processing' },
  rejected: { label: '已拒绝', color: 'error' },
  completed: { label: '已完成', color: 'success' },
};

export default function InventoryTransfer() {
  const [transfers, setTransfers] = useState<TransferOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<TransferOrder | null>(null);
  const [form] = Form.useForm();
  const [items, setItems] = useState<{ skuId: number; skuName: string; qty: number }[]>([]);
  const [skus, setSkus] = useState<any[]>([]);

  const fetchTransfers = async () => {
    setLoading(true);
    try {
      const res = await api.get<any>('/du/transfers?pageSize=50');
      if (res) { // api.ts 解包后 res 即业务数据
        setTransfers(res.items || []);
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const fetchSkus = async () => {
    try {
      const res = await api.get<any>('/du/skus?pageSize=100');
      if (res) { // api.ts 解包后 res 即业务数据
        setSkus(res.items || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchTransfers();
  }, []);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      if (items.length === 0) {
        message.warning('请添加调拨商品');
        return;
      }

      const res = await api.post<any>('/du/transfers', {
        fromWarehouseType: values.fromWarehouseType,
        toWarehouseType: values.toWarehouseType,
        remark: values.remark,
        items: items.map((i) => ({ skuId: i.skuId, skuName: i.skuName, qty: i.qty })),
      });

      if (res) { // api.ts 解包后 res 即业务数据
        message.success('调拨单创建成功');
        setModalVisible(false);
        form.resetFields();
        setItems([]);
        fetchTransfers();
      } else {
        message.error(res?.error || '创建失败');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleApprove = async (id: number, action: 'approve' | 'reject') => {
    try {
      const res = await api.post<any>(`/du/transfers/${id}/approve`, { action });
      if (res) { // api.ts 解包后 res 即业务数据
        message.success(action === 'approve' ? '审批通过' : '已拒绝');
        fetchTransfers();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleComplete = async (id: number) => {
    try {
      const res = await api.post<any>(`/du/transfers/${id}/complete`);
      if (res) { // api.ts 解包后 res 即业务数据
        message.success('调拨完成，库存已更新');
        fetchTransfers();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const openCreateModal = () => {
    fetchSkus();
    setModalVisible(true);
  };

  const addItem = () => {
    setItems([...items, { skuId: 0, skuName: '', qty: 1 }]);
  };

  const updateItem = (index: number, field: string, value: any) => {
    const newItems = [...items];
    (newItems[index] as any)[field] = value;
    if (field === 'skuId') {
      const sku = skus.find((s) => s.id === value);
      newItems[index].skuName = sku?.name || '';
    }
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const getStatusStep = (status: string) => {
    switch (status) {
      case 'draft': return 0;
      case 'approved': return 1;
      case 'completed': return 2;
      case 'rejected': return 1;
      default: return 0;
    }
  };

  const columns = [
    {
      title: '调拨单号',
      dataIndex: 'transfer_no',
      key: 'transfer_no',
      render: (text: string, record: TransferOrder) => (
        <a onClick={() => { setSelectedTransfer(record); setDetailVisible(true); }}>{text}</a>
      ),
    },
    {
      title: '源仓库',
      dataIndex: 'from_warehouse_type',
      key: 'from_warehouse_type',
      render: (v: string) => WAREHOUSE_LABELS[v] || v,
    },
    {
      title: '目标仓库',
      dataIndex: 'to_warehouse_type',
      key: 'to_warehouse_type',
      render: (v: string) => WAREHOUSE_LABELS[v] || v,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const s = STATUS_MAP[status] || { label: status, color: 'default' };
        return <Tag color={s.color}>{s.label}</Tag>;
      },
    },
    {
      title: '商品数',
      key: 'item_count',
      render: (_: any, record: TransferOrder) => record.items?.length || 0,
    },
    {
      title: '创建人',
      dataIndex: 'creator_name',
      key: 'creator_name',
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val: string) => new Date(val).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: TransferOrder) => (
        <Space>
          {record.status === 'draft' && (
            <>
              <Button size="small" type="link" icon={<CheckOutlined />} onClick={() => handleApprove(record.id, 'approve')}>
                审批
              </Button>
              <Button size="small" type="link" danger icon={<CloseOutlined />} onClick={() => handleApprove(record.id, 'reject')}>
                拒绝
              </Button>
            </>
          )}
          {record.status === 'approved' && (
            <Popconfirm title="确认完成调拨？库存将立即更新。" onConfirm={() => handleComplete(record.id)}>
              <Button size="small" type="link" icon={<SendOutlined />}>
                完成调拨
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>库存调拨</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          新建调拨单
        </Button>
      </div>

      <Card>
        <Table
          dataSource={transfers}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* Create Modal */}
      <Modal
        title="新建调拨单"
        open={modalVisible}
        onOk={handleCreate}
        onCancel={() => { setModalVisible(false); form.resetFields(); setItems([]); }}
        okText="创建"
        cancelText="取消"
        width={700}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="fromWarehouseType" label="源仓库" rules={[{ required: true, message: '请选择源仓库' }]}>
            <Select placeholder="选择源仓库">
              {Object.entries(WAREHOUSE_LABELS).map(([key, label]) => (
                <Select.Option key={key} value={key}>{label}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="toWarehouseType" label="目标仓库" rules={[{ required: true, message: '请选择目标仓库' }]}>
            <Select placeholder="选择目标仓库">
              {Object.entries(WAREHOUSE_LABELS).map(([key, label]) => (
                <Select.Option key={key} value={key}>{label}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="备注（可选）" />
          </Form.Item>
        </Form>

        <div style={{ marginTop: 16, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>调拨商品</strong>
          <Button size="small" icon={<PlusOutlined />} onClick={addItem}>添加商品</Button>
        </div>

        {items.map((item, index) => (
          <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <Select
              style={{ flex: 2 }}
              placeholder="选择商品"
              value={item.skuId || undefined}
              onChange={(v) => updateItem(index, 'skuId', v)}
            >
              {skus.map((sku) => (
                <Select.Option key={sku.id} value={sku.id}>{sku.name}</Select.Option>
              ))}
            </Select>
            <InputNumber
              style={{ flex: 1 }}
              min={1}
              placeholder="数量"
              value={item.qty}
              onChange={(v) => updateItem(index, 'qty', v)}
            />
            <Button danger size="small" onClick={() => removeItem(index)}>删除</Button>
          </div>
        ))}
        {items.length === 0 && <div style={{ textAlign: 'center', color: '#999', padding: 16 }}>暂无商品，点击"添加商品"</div>}
      </Modal>

      {/* Detail Modal */}
      <Modal
        title={`调拨单详情 - ${selectedTransfer?.transfer_no}`}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={600}
      >
        {selectedTransfer && (
          <>
            <Steps
              current={getStatusStep(selectedTransfer.status)}
              status={selectedTransfer.status === 'rejected' ? 'error' : 'process'}
              style={{ marginBottom: 24 }}
              items={[
                { title: '创建' },
                { title: '审批' },
                { title: '完成' },
              ]}
            />
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="源仓库">{WAREHOUSE_LABELS[selectedTransfer.from_warehouse_type]}</Descriptions.Item>
              <Descriptions.Item label="目标仓库">{WAREHOUSE_LABELS[selectedTransfer.to_warehouse_type]}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={STATUS_MAP[selectedTransfer.status]?.color}>
                  {STATUS_MAP[selectedTransfer.status]?.label}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="创建人">{selectedTransfer.creator_name}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{new Date(selectedTransfer.created_at).toLocaleString('zh-CN')}</Descriptions.Item>
              <Descriptions.Item label="备注" span={2}>{selectedTransfer.remark || '-'}</Descriptions.Item>
            </Descriptions>
            <div style={{ marginTop: 16 }}>
              <strong>调拨商品</strong>
              <Table
                dataSource={selectedTransfer.items}
                rowKey="id"
                size="small"
                pagination={false}
                columns={[
                  { title: '商品', dataIndex: 'sku_name' },
                  { title: '数量', dataIndex: 'qty' },
                ]}
              />
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
