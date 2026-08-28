import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, message, Descriptions } from 'antd';
import { PlayCircleOutlined, CheckOutlined, WarningOutlined } from '@ant-design/icons';
import { api } from '../../api';

const statusMap: Record<string, { color: string; label: string }> = {
  assigned: { color: 'processing', label: '已派单' },
  in_progress: { color: 'blue', label: '进行中' },
  completed: { color: 'success', label: '已完成' },
  exception: { color: 'error', label: '异常' },
};

const SvcExec: React.FC = () => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionVisible, setActionVisible] = useState(false);
  const [currentTask, setCurrentTask] = useState<any>(null);
  const [actionType, setActionType] = useState<'start' | 'complete' | 'exception'>('start');
  const [form] = Form.useForm();

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await api.get('/dexx/svc/tasks');
      setTasks(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchTasks(); }, []);

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
    { title: '服务内容', dataIndex: 'service_content', width: 200, ellipsis: true },
    { title: '客户', dataIndex: 'customer_name', width: 100 },
    { title: '电话', dataIndex: 'customer_phone', width: 120 },
    { title: '要求时间', dataIndex: 'required_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    { title: '状态', dataIndex: 'status', width: 100, render: (s: string) => <Tag color={statusMap[s]?.color}>{statusMap[s]?.label || s}</Tag> },
    {
      title: '操作', key: 'action', width: 200,
      render: (_: any, r: any) => (
        <Space>
          {r.status === 'assigned' && <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => { setCurrentTask(r); setActionType('start'); setActionVisible(true); }}>开始</Button>}
          {r.status === 'in_progress' && <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => { setCurrentTask(r); setActionType('complete'); setActionVisible(true); }}>完成</Button>}
          {['assigned', 'in_progress'].includes(r.status) && <Button size="small" danger icon={<WarningOutlined />} onClick={() => { setCurrentTask(r); setActionType('exception'); setActionVisible(true); }}>异常</Button>}
        </Space>
      ),
    },
  ];

  return (
    <Card title="服务执行">
      <Table dataSource={tasks} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} scroll={{ x: 1000 }} />

      <Modal
        title={actionType === 'start' ? '开始服务' : actionType === 'complete' ? '完成服务' : '上报异常'}
        open={actionVisible}
        onCancel={() => setActionVisible(false)}
        onOk={() => form.submit()}
      >
        {currentTask && (
          <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label="任务号">{currentTask.task_no}</Descriptions.Item>
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
