import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, Select, InputNumber, message, Descriptions } from 'antd';
import { PlusOutlined, UserSwitchOutlined } from '@ant-design/icons';
import { api } from '../../api';

const statusMap: Record<string, { color: string; label: string }> = {
  pending: { color: 'default', label: '待派单' },
  assigned: { color: 'processing', label: '已派单' },
  delivering: { color: 'blue', label: '配送中' },
  signed: { color: 'success', label: '已签收' },
  exception: { color: 'error', label: '异常' },
};

const DlDispatch: React.FC = () => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [assignVisible, setAssignVisible] = useState(false);
  const [currentTask, setCurrentTask] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [createForm] = Form.useForm();
  const [assignForm] = Form.useForm();

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await api.get('/dex/dl/tasks');
      setTasks(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  const fetchUsers = async () => {
    try {
      const res = await api.get('/dex/users');
      setUsers((res.items || res || []).filter((u: any) => u.role === 'dexx'));
    } catch (e) { setUsers([]); }
  };

  useEffect(() => { fetchTasks(); fetchUsers(); }, []);

  const handleCreate = async (values: any) => {
    try {
      await api.post('/dex/dl/tasks', values);
      message.success('配送任务创建成功');
      setCreateVisible(false);
      createForm.resetFields();
      fetchTasks();
    } catch (e: any) { message.error(e.message || '创建失败'); }
  };

  const handleAssign = async (values: any) => {
    if (!currentTask) return;
    try {
      await api.post(`/dex/dl/tasks/${currentTask.id}/assign`, { assigneeId: values.assigneeId });
      message.success('派单成功');
      setAssignVisible(false);
      assignForm.resetFields();
      fetchTasks();
    } catch (e: any) { message.error(e.message || '派单失败'); }
  };

  const columns = [
    { title: '任务号', dataIndex: 'task_no', width: 140 },
    { title: '取货地址', dataIndex: 'pickup_addr', width: 150, ellipsis: true },
    { title: '送货地址', dataIndex: 'delivery_addr', width: 150, ellipsis: true },
    { title: '客户', dataIndex: 'customer_name', width: 100 },
    { title: '状态', dataIndex: 'status', width: 100, render: (s: string) => <Tag color={statusMap[s]?.color}>{statusMap[s]?.label || s}</Tag> },
    { title: '创建时间', dataIndex: 'created_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    {
      title: '操作', key: 'action', width: 120,
      render: (_: any, r: any) => r.status === 'pending' ? (
        <Button size="small" type="primary" icon={<UserSwitchOutlined />} onClick={() => { setCurrentTask(r); setAssignVisible(true); }}>派单</Button>
      ) : null,
    },
  ];

  return (
    <Card title="配送派单" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateVisible(true)}>新建任务</Button>}>
      <Table dataSource={tasks} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} scroll={{ x: 900 }} />

      <Modal title="新建配送任务" open={createVisible} onCancel={() => setCreateVisible(false)} onOk={() => createForm.submit()} width={500}>
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="pickupAddr" label="取货地址" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="deliveryAddr" label="送货地址" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="customerName" label="客户姓名"><Input /></Form.Item>
          <Form.Item name="customerPhone" label="客户电话"><Input /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="派单" open={assignVisible} onCancel={() => setAssignVisible(false)} onOk={() => assignForm.submit()}>
        {currentTask && (
          <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label="任务号">{currentTask.task_no}</Descriptions.Item>
            <Descriptions.Item label="送货地址">{currentTask.delivery_addr}</Descriptions.Item>
          </Descriptions>
        )}
        <Form form={assignForm} layout="vertical" onFinish={handleAssign}>
          <Form.Item name="assigneeId" label="选择铺员" rules={[{ required: true }]}>
            <Select placeholder="选择铺员" options={users.map((u: any) => ({ value: u.id, label: u.name || u.phone }))} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default DlDispatch;
