import React, { useEffect, useState } from 'react';
import { Table, Button, Tag, Space, Modal, Form, Input, Select, message, Card } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { api } from '../../api';

const statusMap: Record<string, { color: string; label: string }> = {
  pending: { color: 'default', label: '待派单' },
  assigned: { color: 'processing', label: '已派单' },
  delivering: { color: 'blue', label: '配送中' },
  signed: { color: 'success', label: '已签收' },
  exception: { color: 'error', label: '异常' },
  cancelled: { color: 'default', label: '已取消' },
};

const DlTasks: React.FC = () => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [form] = Form.useForm();

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await api.get('/du/dl/tasks');
      setTasks(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchTasks(); }, []);

  const handleCreate = async (values: any) => {
    try {
      await api.post('/du/dl/tasks', values);
      message.success('配送任务创建成功');
      setCreateVisible(false);
      form.resetFields();
      fetchTasks();
    } catch (e: any) { message.error(e.message || '创建失败'); }
  };

  const handleClose = async (id: number) => {
    try {
      await api.post(`/du/dl/tasks/${id}/close`);
      message.success('已关闭');
      fetchTasks();
    } catch (e: any) { message.error(e.message || '操作失败'); }
  };

  const columns = [
    { title: '任务号', dataIndex: 'task_no', width: 140 },
    { title: '取货地址', dataIndex: 'pickup_addr', width: 150, ellipsis: true },
    { title: '送货地址', dataIndex: 'delivery_addr', width: 150, ellipsis: true },
    { title: '客户', dataIndex: 'customer_name', width: 100 },
    { title: '电话', dataIndex: 'customer_phone', width: 120 },
    { title: '状态', dataIndex: 'status', width: 100, render: (s: string) => <Tag color={statusMap[s]?.color}>{statusMap[s]?.label || s}</Tag> },
    { title: '异常原因', dataIndex: 'exception_reason', width: 120, ellipsis: true, render: (v: string) => v || '-' },
    { title: '创建时间', dataIndex: 'created_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    {
      title: '操作', key: 'action', width: 100,
      render: (_: any, r: any) => r.status === 'exception' ? <Button size="small" type="primary" onClick={() => handleClose(r.id)}>关闭</Button> : null,
    },
  ];

  return (
    <Card title="配送任务管理" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateVisible(true)}>新建任务</Button>}>
      <Table dataSource={tasks} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} scroll={{ x: 1100 }} />
      <Modal title="新建配送任务" open={createVisible} onCancel={() => setCreateVisible(false)} onOk={() => form.submit()} width={500}>
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="pickupAddr" label="取货地址" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="deliveryAddr" label="送货地址" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="customerName" label="客户姓名"><Input /></Form.Item>
          <Form.Item name="customerPhone" label="客户电话"><Input /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default DlTasks;
