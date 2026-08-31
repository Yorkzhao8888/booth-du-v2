import React, { useEffect, useState } from 'react';
import { Table, Button, Tag, Space, Modal, Form, Input, DatePicker, Select, message, Card, Tabs } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { api } from '../../api';

const statusMap: Record<string, { color: string; label: string }> = {
  pending: { color: 'default', label: '待派单' },
  assigned: { color: 'processing', label: '已派单' },
  in_progress: { color: 'blue', label: '进行中' },
  completed: { color: 'success', label: '已完成' },
  exception: { color: 'error', label: '异常' },
  cancelled: { color: 'default', label: '已取消' },
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

const SvcTasks: React.FC = () => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [form] = Form.useForm();

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const params = categoryFilter ? `?service_category=${categoryFilter}` : '';
      const res = await api.get(`/du/svc/tasks${params}`);
      setTasks(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchTasks(); }, [categoryFilter]);

  const handleCreate = async (values: any) => {
    try {
      await api.post('/du/svc/tasks', values);
      message.success('服务任务创建成功');
      setCreateVisible(false);
      form.resetFields();
      fetchTasks();
    } catch (e: any) { message.error(e.message || '创建失败'); }
  };

  const columns = [
    { title: '任务号', dataIndex: 'task_no', width: 140 },
    { title: '类别', dataIndex: 'service_category', width: 90, render: (v: string) => <Tag>{categoryMap[v] || v || '客户'}</Tag> },
    { title: '类型', dataIndex: 'service_type', width: 80, render: (v: string) => v ? <Tag color="blue">{serviceTypeMap[v] || v}</Tag> : '-' },
    { title: '服务内容', dataIndex: 'service_content', width: 200, ellipsis: true },
    { title: '客户', dataIndex: 'customer_name', width: 100 },
    { title: '电话', dataIndex: 'customer_phone', width: 120 },
    { title: '要求时间', dataIndex: 'required_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    { title: '状态', dataIndex: 'status', width: 100, render: (s: string) => <Tag color={statusMap[s]?.color}>{statusMap[s]?.label || s}</Tag> },
    { title: '结果', dataIndex: 'result', width: 150, ellipsis: true, render: (v: string) => v || '-' },
    { title: '创建时间', dataIndex: 'created_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
  ];

  return (
    <Card title="服务任务管理" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateVisible(true)}>新建任务</Button>}>
      <Tabs
        activeKey={categoryFilter}
        onChange={(key) => setCategoryFilter(key)}
        style={{ marginBottom: 16 }}
        items={[
          { key: '', label: '全部' },
          { key: 'customer', label: '客户服务' },
          { key: 'internal', label: '内部服务' },
        ]}
      />
      <Table dataSource={tasks} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} scroll={{ x: 1200 }} />
      <Modal title="新建服务任务" open={createVisible} onCancel={() => setCreateVisible(false)} onOk={() => form.submit()} width={500}>
        <Form form={form} layout="vertical" onFinish={handleCreate} initialValues={{ serviceCategory: 'customer' }}>
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
    </Card>
  );
};

export default SvcTasks;
