import React, { useEffect, useState } from 'react';
import { Table, Button, Tag, Space, Modal, Form, Input, InputNumber, Select, message, Card, Descriptions, Steps, Popconfirm, DatePicker } from 'antd';
import { PlusOutlined, ShoppingCartOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { api } from '../../api';
import { getCurrentRole } from '../../utils/jwt';

const statusMap: Record<string, { color: string; label: string }> = {
  draft: { color: 'default', label: '草稿' },
  submitted: { color: 'processing', label: '待审批' },
  approved: { color: 'cyan', label: '已审批' },
  ordered: { color: 'blue', label: '已下单' },
  received: { color: 'success', label: '已收货' },
  cancelled: { color: 'error', label: '已取消' },
};

interface PurchaseOrder {
  id: number;
  po_no: string;
  supplier: string;
  status: string;
  total_amount: number;
  items: any[];
  remark: string;
  created_at: string;
  submitted_at: string;
  approved_at: string;
  received_at: string;
}

const PurchaseOrders: React.FC = () => {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [receiveVisible, setReceiveVisible] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<PurchaseOrder | null>(null);
  const [form] = Form.useForm();
  const [receiveForm] = Form.useForm();
  const [skuOptions, setSkuOptions] = useState<any[]>([]);
  const role = getCurrentRole();
  const isDu = role === 'du';

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await api.get('/du/purchase-orders');
      setOrders(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  const fetchSkus = async () => {
    try {
      const res = await api.get('/du/skus?pageSize=200');
      setSkuOptions(res.items || []);
    } catch (e) { /* ignore */ }
  };

  useEffect(() => { fetchOrders(); fetchSkus(); }, []);

  const handleCreate = async (values: any) => {
    try {
      await api.post('/du/purchase-orders', values);
      message.success('采购单创建成功');
      setCreateVisible(false);
      form.resetFields();
      fetchOrders();
    } catch (e: any) { message.error(e.message || '创建失败'); }
  };

  const handleSubmit = async (id: number) => {
    try {
      await api.post(`/du/purchase-orders/${id}/submit`);
      message.success('已提交审批');
      fetchOrders();
    } catch (e: any) { message.error(e.message || '提交失败'); }
  };

  const handleApprove = async (id: number) => {
    try {
      await api.post(`/du/purchase-orders/${id}/approve`);
      message.success('审批通过');
      fetchOrders();
    } catch (e: any) { message.error(e.message || '审批失败'); }
  };

  const handleReject = async (id: number) => {
    try {
      await api.post(`/du/purchase-orders/${id}/reject`);
      message.success('已驳回');
      fetchOrders();
    } catch (e: any) { message.error(e.message || '驳回失败'); }
  };

  const handleReceive = async (values: any) => {
    if (!currentOrder) return;
    try {
      await api.post(`/du/purchase-orders/${currentOrder.id}/receive`, { items: values.items });
      message.success('收货成功');
      setReceiveVisible(false);
      receiveForm.resetFields();
      fetchOrders();
    } catch (e: any) { message.error(e.message || '收货失败'); }
  };

  const columns = [
    { title: '采购单号', dataIndex: 'po_no', key: 'po_no', width: 160 },
    { title: '供应商', dataIndex: 'supplier', key: 'supplier', width: 120 },
    { title: '金额', dataIndex: 'total_amount', key: 'total_amount', width: 100, render: (v: number) => `¥${(v || 0).toFixed(2)}` },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (s: string) => <Tag color={statusMap[s]?.color}>{statusMap[s]?.label || s}</Tag> },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    {
      title: '操作', key: 'action', width: 200,
      render: (_: any, record: PurchaseOrder) => (
        <Space>
          <Button size="small" onClick={() => { setCurrentOrder(record); setDetailVisible(true); }}>详情</Button>
          {record.status === 'draft' && <Button size="small" type="primary" onClick={() => handleSubmit(record.id)}>提交</Button>}
          {record.status === 'submitted' && isDu && (
            <>
              <Button size="small" type="primary" onClick={() => handleApprove(record.id)}>审批</Button>
              <Popconfirm title="确定驳回？" onConfirm={() => handleReject(record.id)}><Button size="small" danger>驳回</Button></Popconfirm>
            </>
          )}
          {['approved', 'ordered'].includes(record.status) && (
            <Button size="small" type="primary" icon={<ShoppingCartOutlined />} onClick={() => { setCurrentOrder(record); setReceiveVisible(true); }}>收货</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card title="采购管理" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateVisible(true)}>新建采购单</Button>}>
        <Table dataSource={orders} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} scroll={{ x: 900 }} />
      </Card>

      {/* Create Modal */}
      <Modal title="新建采购单" open={createVisible} onCancel={() => setCreateVisible(false)} onOk={() => form.submit()} width={700}>
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="supplier" label="供应商" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                {fields.map(f => (
                  <Space key={f.key} align="start" style={{ display: 'flex', marginBottom: 8 }}>
                    <Form.Item {...f} name={[f.name, 'skuId']} rules={[{ required: true }]}>
                      <Select style={{ width: 180 }} placeholder="选择SKU" showSearch optionFilterProp="label"
                        options={skuOptions.map((s: any) => ({ value: s.id, label: `${s.sku_code} - ${s.name}` }))} />
                    </Form.Item>
                    <Form.Item {...f} name={[f.name, 'qty']} rules={[{ required: true }]}>
                      <InputNumber placeholder="数量" min={1} />
                    </Form.Item>
                    <Form.Item {...f} name={[f.name, 'unitPrice']} rules={[{ required: true }]}>
                      <InputNumber placeholder="单价" min={0} precision={2} prefix="¥" />
                    </Form.Item>
                    <Button danger onClick={() => remove(f.name)}>删除</Button>
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>添加物料</Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>

      {/* Detail Modal */}
      <Modal title={`采购单 ${currentOrder?.po_no || ''}`} open={detailVisible} onCancel={() => setDetailVisible(false)} footer={null} width={600}>
        {currentOrder && (
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="单号">{currentOrder.po_no}</Descriptions.Item>
            <Descriptions.Item label="供应商">{currentOrder.supplier}</Descriptions.Item>
            <Descriptions.Item label="金额">¥{(currentOrder.total_amount || 0).toFixed(2)}</Descriptions.Item>
            <Descriptions.Item label="状态"><Tag color={statusMap[currentOrder.status]?.color}>{statusMap[currentOrder.status]?.label}</Tag></Descriptions.Item>
            <Descriptions.Item label="创建时间">{currentOrder.created_at ? new Date(currentOrder.created_at).toLocaleString() : '-'}</Descriptions.Item>
            <Descriptions.Item label="备注" span={2}>{currentOrder.remark || '-'}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* Receive Modal */}
      <Modal title={`收货 - ${currentOrder?.po_no || ''}`} open={receiveVisible} onCancel={() => setReceiveVisible(false)} onOk={() => receiveForm.submit()} width={600}>
        <Form form={receiveForm} layout="vertical" onFinish={handleReceive}
          initialValues={{ items: (currentOrder?.items || []).map((it: any) => ({ skuId: it.skuId || it.sku_id, receivedQty: it.qty, unitPrice: it.unitPrice, batchNo: `B${Date.now()}` })) }}>
          <Form.List name="items">
            {(fields) => (
              fields.map(f => (
                <Space key={f.key} align="start" style={{ display: 'flex', marginBottom: 8 }}>
                  <Form.Item {...f} name={[f.name, 'skuId']}><Input disabled style={{ width: 80 }} /></Form.Item>
                  <Form.Item {...f} name={[f.name, 'receivedQty']} label="收货数量"><InputNumber min={0} /></Form.Item>
                  <Form.Item {...f} name={[f.name, 'unitPrice']} label="单价"><InputNumber min={0} precision={2} prefix="¥" /></Form.Item>
                  <Form.Item {...f} name={[f.name, 'batchNo']} label="批次号"><Input style={{ width: 140 }} /></Form.Item>
                  <Form.Item {...f} name={[f.name, 'expiryDate']} label="有效期"><DatePicker /></Form.Item>
                </Space>
              ))
            )}
          </Form.List>
        </Form>
      </Modal>
    </div>
  );
};

export default PurchaseOrders;
