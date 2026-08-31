import React, { useEffect, useState, useCallback } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, Select, InputNumber, message, Tabs, Descriptions } from 'antd';
import { PlusOutlined, CheckOutlined, CloseOutlined, EyeOutlined } from '@ant-design/icons';
import { api } from '../../api';

const supplyTypeMap: Record<string, { color: string; label: string }> = {
  material: { color: 'green', label: '原料' },
  device: { color: 'blue', label: '设备' },
  plaza: { color: 'purple', label: '场地' },
};

const statusMap: Record<string, { color: string; label: string }> = {
  pending: { color: 'default', label: '待执行' },
  dispatched: { color: 'processing', label: '已下发' },
  supplied: { color: 'success', label: '已供给' },
  returned: { color: 'warning', label: '已退回' },
  cancelled: { color: 'error', label: '已取消' },
};

const targetTypeMap: Record<string, string> = {
  production_line: '产线',
  work_order: '工单',
  station: '工位',
  service: '服务单',
};

const SupplyOrders: React.FC = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<any>(null);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [form] = Form.useForm();

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = typeFilter ? `?supply_type=${typeFilter}` : '';
      const res = await api.get(`/dexx/wh/supply-orders${params}`);
      setOrders(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  }, [typeFilter]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const handleCreate = async (values: any) => {
    try {
      await api.post('/dexx/wh/supply-orders', values);
      message.success('供给单创建成功');
      setCreateVisible(false);
      form.resetFields();
      fetchOrders();
    } catch (e: any) { message.error(e.message || '创建失败'); }
  };

  const handleSupply = async (id: number) => {
    try {
      await api.post(`/dexx/wh/supply-orders/${id}/supply`);
      message.success('供给完成');
      fetchOrders();
    } catch (e: any) { message.error(e.message || '操作失败'); }
  };

  const handleCancel = async (id: number) => {
    try {
      await api.post(`/dexx/wh/supply-orders/${id}/cancel`);
      message.success('已取消');
      fetchOrders();
    } catch (e: any) { message.error(e.message || '操作失败'); }
  };

  const columns = [
    { title: '供给单号', dataIndex: 'supply_no', width: 160 },
    { title: '类型', dataIndex: 'supply_type', width: 80, render: (v: string) => <Tag color={supplyTypeMap[v]?.color}>{supplyTypeMap[v]?.label || v}</Tag> },
    { title: '供给对象', width: 140, render: (_: any, r: any) => r.target_name || (r.target_type ? targetTypeMap[r.target_type] : '-') },
    { title: '物料/设备', width: 140, render: (_: any, r: any) => r.sku_name || (r.device_id ? `设备#${r.device_id}` : '-') },
    { title: '数量', dataIndex: 'qty', width: 80, render: (v: number, r: any) => v ? `${v} ${r.unit || ''}` : '-' },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={statusMap[v]?.color}>{statusMap[v]?.label || v}</Tag> },
    { title: '创建时间', dataIndex: 'created_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    {
      title: '操作', key: 'action', width: 200,
      render: (_: any, r: any) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => { setCurrentOrder(r); setDetailVisible(true); }}>详情</Button>
          {['pending', 'dispatched'].includes(r.status) && (
            <>
              <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => handleSupply(r.id)}>执行</Button>
              <Button size="small" danger icon={<CloseOutlined />} onClick={() => handleCancel(r.id)}>取消</Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title="供给单管理" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateVisible(true)}>新建供给单</Button>}>
      <Tabs
        activeKey={typeFilter}
        onChange={setTypeFilter}
        style={{ marginBottom: 16 }}
        items={[
          { key: '', label: '全部' },
          { key: 'material', label: '原料供给' },
          { key: 'device', label: '设备供给' },
          { key: 'plaza', label: '场地供给' },
        ]}
      />
      <Table dataSource={orders} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 15 }} scroll={{ x: 1100 }} />

      <Modal title="新建供给单" open={createVisible} onCancel={() => setCreateVisible(false)} onOk={() => form.submit()} width={560}>
        <Form form={form} layout="vertical" onFinish={handleCreate} initialValues={{ supplyType: 'material' }}>
          <Form.Item name="supplyType" label="供给类型" rules={[{ required: true }]}>
            <Select options={[{ value: 'material', label: '原料' }, { value: 'device', label: '设备' }, { value: 'plaza', label: '场地' }]} />
          </Form.Item>
          <Form.Item name="targetType" label="供给对象类型">
            <Select allowClear placeholder="选择对象类型" options={[
              { value: 'production_line', label: '产线' },
              { value: 'work_order', label: '工单' },
              { value: 'station', label: '工位' },
              { value: 'service', label: '服务单' },
            ]} />
          </Form.Item>
          <Form.Item name="targetName" label="供给对象名称"><Input placeholder="如: A线 / WO-001" /></Form.Item>
          <Form.Item name="skuName" label="物料名称"><Input /></Form.Item>
          <Form.Item name="qty" label="数量"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="unit" label="单位"><Input placeholder="件/kg/台" /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="供给单详情" open={detailVisible} onCancel={() => setDetailVisible(false)} footer={null} width={500}>
        {currentOrder && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="供给单号">{currentOrder.supply_no}</Descriptions.Item>
            <Descriptions.Item label="类型">{supplyTypeMap[currentOrder.supply_type]?.label || currentOrder.supply_type}</Descriptions.Item>
            <Descriptions.Item label="对象类型">{targetTypeMap[currentOrder.target_type] || currentOrder.target_type || '-'}</Descriptions.Item>
            <Descriptions.Item label="对象名称">{currentOrder.target_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="物料">{currentOrder.sku_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="数量">{currentOrder.qty ? `${currentOrder.qty} ${currentOrder.unit || ''}` : '-'}</Descriptions.Item>
            <Descriptions.Item label="状态"><Tag color={statusMap[currentOrder.status]?.color}>{statusMap[currentOrder.status]?.label || currentOrder.status}</Tag></Descriptions.Item>
            <Descriptions.Item label="供给时间">{currentOrder.supplied_at ? new Date(currentOrder.supplied_at).toLocaleString() : '-'}</Descriptions.Item>
            <Descriptions.Item label="备注">{currentOrder.remark || '-'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{new Date(currentOrder.created_at).toLocaleString()}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </Card>
  );
};

export default SupplyOrders;
