import React, { useEffect, useState, useCallback } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, message, Descriptions, Tabs, Select } from 'antd';
import { PlayCircleOutlined, CheckOutlined, WarningOutlined } from '@ant-design/icons';
import { api } from '../../api';

const statusMap: Record<string, { color: string; label: string }> = {
  assigned: { color: 'processing', label: '已派单' },
  accepted: { color: 'cyan', label: '已接受' },
  in_service: { color: 'blue', label: '服务中' },
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

const SvcExec: React.FC = () => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionVisible, setActionVisible] = useState(false);
  const [currentTask, setCurrentTask] = useState<any>(null);
  const [actionType, setActionType] = useState<'start' | 'complete' | 'exception'>('start');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [form] = Form.useForm();

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = categoryFilter ? `?service_category=${categoryFilter}` : '';
      const res = await api.get(`/dexx/svc/tasks${params}`);
      setTasks(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  }, [categoryFilter]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const handleAction = async (values: any) => {
    if (!currentTask) return;
    try {
      if (actionType === 'start') {
        await api.post(`/dexx/svc/tasks/${currentTask.id}/start`);
        message.success('开始服务');
      } else if (actionType === 'complete') {
        await api.post(`/dexx/svc/tasks/${currentTask.id}/complete`, { result: values.result, remark: values.remark });
        message.success('服务完成');
      } else {
        await api.post(`/dexx/svc/tasks/${currentTask.id}/exception`, { reason: values.reason });
        message.success('异常已上报');
      }
      setActionVisible(false);
      form.resetFields();
      fetchTasks();
    } catch (e: any) { message.error(e.message || '操作失败'); }
  };

  const columns = [
    { title: '任务号', dataIndex: 'task_no', width: 140 },
    { title: '类别', dataIndex: 'service_category', width: 90, render: (v: string) => <Tag>{categoryMap[v] || v || '客户'}</Tag> },
    { title: '类型', dataIndex: 'service_type', width: 80, render: (v: string) => v ? <Tag color="blue">{serviceTypeMap[v] || v}</Tag> : '-' },
    { title: '服务内容', dataIndex: 'service_content', width: 180, ellipsis: true },
    { title: '客户', dataIndex: 'customer_name', width: 100 },
    { title: '电话', dataIndex: 'customer_phone', width: 120 },
    { title: '要求时间', dataIndex: 'required_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    { title: '状态', dataIndex: 'status', width: 100, render: (s: string) => <Tag color={statusMap[s]?.color}>{statusMap[s]?.label || s}</Tag> },
    {
      title: '操作', key: 'action', width: 200,
      render: (_: any, r: any) => (
        <Space>
          {(r.status === 'assigned' || r.status === 'accepted') && <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => { setCurrentTask(r); setActionType('start'); setActionVisible(true); }}>开始</Button>}
          {(r.status === 'in_progress' || r.status === 'in_service') && <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => { setCurrentTask(r); setActionType('complete'); setActionVisible(true); }}>完成</Button>}
          {['assigned', 'accepted', 'in_progress', 'in_service'].includes(r.status) && <Button size="small" danger icon={<WarningOutlined />} onClick={() => { setCurrentTask(r); setActionType('exception'); setActionVisible(true); }}>异常</Button>}
        </Space>
      ),
    },
  ];

  return (
    <Card title="服务执行">
      <Tabs
        activeKey={categoryFilter}
        onChange={setCategoryFilter}
        style={{ marginBottom: 16 }}
        items={[
          { key: '', label: '全部' },
          { key: 'customer', label: '客户服务' },
          { key: 'internal', label: '内部服务' },
        ]}
      />
      <Table dataSource={tasks} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} scroll={{ x: 1200 }} />

      <Modal
        title={actionType === 'start' ? '开始服务' : actionType === 'complete' ? '完成服务' : '上报异常'}
        open={actionVisible}
        onCancel={() => setActionVisible(false)}
        onOk={() => form.submit()}
      >
        {currentTask && (
          <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label="任务号">{currentTask.task_no}</Descriptions.Item>
            <Descriptions.Item label="类别">{categoryMap[currentTask.service_category] || '客户'}</Descriptions.Item>
            <Descriptions.Item label="类型">{currentTask.service_type ? serviceTypeMap[currentTask.service_type] : '-'}</Descriptions.Item>
            <Descriptions.Item label="服务内容">{currentTask.service_content}</Descriptions.Item>
            <Descriptions.Item label="客户">{currentTask.customer_name} {currentTask.customer_phone}</Descriptions.Item>
          </Descriptions>
        )}
        <Form form={form} layout="vertical" onFinish={handleAction}>
          {actionType === 'complete' && (
            <>
              <Form.Item name="result" label="服务结果" rules={[{ required: true }]}><Input.TextArea rows={3} placeholder="描述服务完成情况" /></Form.Item>
              <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
            </>
          )}
          {actionType === 'exception' && <Form.Item name="reason" label="异常原因" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>}
        </Form>
      </Modal>
    </Card>
  );
};

export default SvcExec;
