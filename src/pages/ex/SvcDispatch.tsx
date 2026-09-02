import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, Select, DatePicker, message, Descriptions } from 'antd';
import { PlusOutlined, UserSwitchOutlined } from '@ant-design/icons';
import { api } from '../../api';

const statusMap: Record<string, { color: string; label: string }> = {
  pending: { color: 'default', label: '待派单' },
  assigned: { color: 'processing', label: '已派单' },
  in_progress: { color: 'blue', label: '进行中' },
  completed: { color: 'success', label: '已完成' },
  exception: { color: 'error', label: '异常' },
};

const categoryMap: Record<string, string> = {
  customer: '客户服务',
  internal: '内部服务',
};

const serviceTypeMap: Record<string, string> = {
  qa: '质检',
  production: '生产',
  maintenance: '维护',
  line_setup: '线体架设',
};

const SvcDispatch: React.FC = () => {
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
      const res = await api.get<any>('/ex/svc/tasks');
      setTasks(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  const fetchUsers = async () => {
    try {
      const res = await api.get<any>('/ex/users');
      setUsers((res.items || res || []).filter((u: any) => u.role === 'exx'));
    } catch (e) { setUsers([]); }
  };

  useEffect(() => { fetchTasks(); fetchUsers(); }, []);

  const handleCreate = async (values: any) => {
    try {
      await api.post('/ex/svc/tasks', values);
      message.success('服务任务创建成功');
      setCreateVisible(false);
      createForm.resetFields();
      fetchTasks();
    } catch (e: any) { message.error(e.message || '创建失败'); }
  };

  const handleAssign = async (values: any) => {
    if (!currentTask) return;
    try {
      await api.post(`/ex/svc/tasks/${currentTask.id}/assign`, { assigneeId: values.assigneeId });
      message.success('派单成功');
      setAssignVisible(false);
      assignForm.resetFields();
      fetchTasks();
    } catch (e: any) { message.error(e.message || '派单失败'); }
  };

  const columns = [
    { title: '任务号', dataIndex: 'task_no', width: 140 },
    { title: '类别', dataIndex: 'service_category', width: 90, render: (v: string) => <Tag>{categoryMap[v] || v || '客户'}</Tag> },
    { title: '类型', dataIndex: 'service_type', width: 80, render: (v: string) => v ? <Tag color="blue">{serviceTypeMap[v] || v}</Tag> : '-' },
    { title: '服务内容', dataIndex: 'service_content', width: 200, ellipsis: true },
    { title: '客户', dataIndex: 'customer_name', width: 100 },
    { title: '要求时间', dataIndex: 'required_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
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
    <Card title="服务派单" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateVisible(true)}>新建任务</Button>}>
      <Table dataSource={tasks} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} scroll={{ x: 1000 }} />

      <Modal title="新建服务任务" open={createVisible} onCancel={() => setCreateVisible(false)} onOk={() => createForm.submit()} width={500}>
        <Form form={createForm} layout="vertical" onFinish={handleCreate} initialValues={{ serviceCategory: 'customer' }}>
          <Form.Item name="serviceCategory" label="服务类别" rules={[{ required: true }]}>
            <Select options={[{ value: 'customer', label: '客户服务' }, { value: 'internal', label: '内部服务' }]} />
          </Form.Item>
          <Form.Item name="serviceType" label="服务类型">
            <Select allowClear placeholder="选择类型" options={[
              { value: 'qa', label: '质检' },
              { value: 'production', label: '生产' },
              { value: 'maintenance', label: '维护' },
              { value: 'line_setup', label: '线体架设' },
            ]} />
          </Form.Item>
          <Form.Item name="serviceContent" label="服务内容" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="customerName" label="客户姓名"><Input /></Form.Item>
          <Form.Item name="customerPhone" label="客户电话"><Input /></Form.Item>
          <Form.Item name="requiredAt" label="要求完成时间"><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="派单" open={assignVisible} onCancel={() => setAssignVisible(false)} onOk={() => assignForm.submit()}>
        {currentTask && (
          <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label="任务号">{currentTask.task_no}</Descriptions.Item>
            <Descriptions.Item label="服务内容">{currentTask.service_content}</Descriptions.Item>
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

export default SvcDispatch;
