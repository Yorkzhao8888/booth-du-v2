import React, { useEffect, useState, useCallback } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, Select, InputNumber, message } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { api } from '../../api';

const statusMap: Record<string, { color: string; label: string }> = {
  pending: { color: 'default', label: '待执行' },
  dispatched: { color: 'processing', label: '已下发' },
  supplied: { color: 'success', label: '已供给' },
  cancelled: { color: 'error', label: '已取消' },
};

const SupplyLineFeed: React.FC = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [skus, setSkus] = useState<any[]>([]);
  const [form] = Form.useForm();

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/exx/wh/supply-orders?supply_type=material');
      setOrders(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  }, []);

  const fetchSkus = useCallback(async () => {
    try {
      const res = await api.get('/exx/wh/inventory');
      setSkus(Array.isArray(res) ? res : []);
    } catch (e) { setSkus([]); }
  }, []);

  useEffect(() => { fetchOrders(); fetchSkus(); }, [fetchOrders, fetchSkus]);

  const handleCreate = async (values: any) => {
    try {
      const sku = skus.find((s: any) => s.id === values.skuId);
      await api.post('/exx/wh/supply-orders', {
        supplyType: 'material',
        targetType: values.targetType,
        targetName: values.targetName,
        skuId: values.skuId,
        skuName: sku?.name || values.skuName,
        qty: values.qty,
        unit: sku?.unit || values.unit,
        remark: values.remark,
      });
      message.success('补给单创建成功');
      setCreateVisible(false);
      form.resetFields();
      fetchOrders();
    } catch (e: any) { message.error(e.message || '创建失败'); }
  };

  const handleSupply = async (id: number) => {
    try {
      await api.post(`/exx/wh/supply-orders/${id}/supply`);
      message.success('已供给到产线');
      fetchOrders();
    } catch (e: any) { message.error(e.message || '操作失败'); }
  };

  const columns = [
    { title: '供给单号', dataIndex: 'supply_no', width: 160 },
    { title: '物料', dataIndex: 'sku_name', width: 140 },
    { title: '补给对象', dataIndex: 'target_name', width: 120, render: (v: string) => v || '-' },
    { title: '数量', dataIndex: 'qty', width: 80, render: (v: number, r: any) => v ? `${v} ${r.unit || ''}` : '-' },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={statusMap[v]?.color}>{statusMap[v]?.label || v}</Tag> },
    { title: '供给时间', dataIndex: 'supplied_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    {
      title: '操作', key: 'action', width: 120,
      render: (_: any, r: any) => ['pending', 'dispatched'].includes(r.status) ? (
        <Button size="small" type="primary" icon={<SendOutlined />} onClick={() => handleSupply(r.id)}>供给到线</Button>
      ) : null,
    },
  ];

  return (
    <Card title="补给产线" extra={<Button type="primary" icon={<SendOutlined />} onClick={() => setCreateVisible(true)}>新建补给</Button>}>
      <Table dataSource={orders} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 15 }} scroll={{ x: 900 }} />

      <Modal title="新建补给产线单" open={createVisible} onCancel={() => setCreateVisible(false)} onOk={() => form.submit()} width={500}>
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="targetType" label="补给对象类型" rules={[{ required: true }]}>
            <Select options={[
              { value: 'production_line', label: '产线' },
              { value: 'work_order', label: '工单' },
              { value: 'station', label: '工位' },
            ]} />
          </Form.Item>
          <Form.Item name="targetName" label="补给对象名称" rules={[{ required: true }]}><Input placeholder="如: A线 / WO-001" /></Form.Item>
          <Form.Item name="skuId" label="选择物料" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" placeholder="选择库存物料" options={skus.map((s: any) => ({ value: s.id, label: `${s.name} (库存: ${s.quantity || 0}${s.unit || ''})` }))} />
          </Form.Item>
          <Form.Item name="qty" label="补给数量" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default SupplyLineFeed;
