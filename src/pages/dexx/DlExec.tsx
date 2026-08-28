import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, message, Descriptions } from 'antd';
import { CarOutlined, CheckOutlined, WarningOutlined } from '@ant-design/icons';
import { api } from '../../api';

const statusMap: Record<string, { color: string; label: string }> = {
  assigned: { color: 'processing', label: '已派单' },
  delivering: { color: 'blue', label: '配送中' },
  signed: { color: 'success', label: '已签收' },
  exception: { color: 'error', label: '异常' },
};

const DlExec: React.FC = () => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionVisible, setActionVisible] = useState(false);
  const [currentTask, setCurrentTask] = useState<any>(null);
  const [actionType, setActionType] = useState<'start' | 'complete' | 'exception'>('start');
  const [form] = Form.useForm();

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await api.get('/dexx/dl/tasks');
      setTasks(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchTasks(); }, []);

  const handleAction = async (values: any) => {
    if (!currentTask) return;
    try {
      if (actionType === 'start') {
        await api.post(`/dexx/dl/tasks/${currentTask.id}/start`);
        message.success('开始配送');
      } else if (actionType === 'complete') {
        await api.post(`/dexx/dl/tasks/${currentTask.id}/complete`, { signedBy: values.signedBy });
        message.success('配送完成');
      } else {
        await api.post(`/dexx/dl/tasks/${currentTask.id}/exception`, { reason: values.reason });
        message.success('异常已上报');
      }
      setActionVisible(false);
      form.resetFields();
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
    {
      title: '操作', key: 'action', width: 200,
      render: (_: any, r: any) => (
        <Space>
          {r.status === 'assigned' && <Button size="small" type="primary" icon={<CarOutlined />} onClick={() => { setCurrentTask(r); setActionType('start'); setActionVisible(true); }}>开始配送</Button>}
          {r.status === 'delivering' && <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => { setCurrentTask(r); setActionType('complete'); setActionVisible(true); }}>完成</Button>}
          {['assigned', 'delivering'].includes(r.status) && <Button size="small" danger icon={<WarningOutlined />} onClick={() => { setCurrentTask(r); setActionType('exception'); setActionVisible(true); }}>异常</Button>}
        </Space>
      ),
    },
  ];

  return (
    <Card title="配送执行">
      <Table dataSource={tasks} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} scroll={{ x: 900 }} />

      <Modal
        title={actionType === 'start' ? '开始配送' : actionType === 'complete' ? '完成配送' : '上报异常'}
        open={actionVisible}
        onCancel={() => setActionVisible(false)}
        onOk={() => form.submit()}
      >
        {currentTask && (
          <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label="任务号">{currentTask.task_no}</Descriptions.Item>
            <Descriptions.Item label="送货地址">{currentTask.delivery_addr}</Descriptions.Item>
            <Descriptions.Item label="客户">{currentTask.customer_name} {currentTask.customer_phone}</Descriptions.Item>
          </Descriptions>
        )}
        <Form form={form} layout="vertical" onFinish={handleAction}>
          {actionType === 'complete' && <Form.Item name="signedBy" label="签收人"><Input /></Form.Item>}
          {actionType === 'exception' && <Form.Item name="reason" label="异常原因" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>}
        </Form>
      </Modal>
    </Card>
  );
};

export default DlExec;
