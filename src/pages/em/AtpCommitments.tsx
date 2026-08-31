import React, { useEffect, useState, useCallback } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, InputNumber, DatePicker, message, Descriptions, Alert } from 'antd';
import { CheckOutlined, CloseOutlined, SearchOutlined } from '@ant-design/icons';
import { api } from '../../api';

const statusMap: Record<string, { color: string; label: string }> = {
  pending: { color: 'processing', label: '待确认' },
  confirmed: { color: 'success', label: '已确认' },
  rejected: { color: 'error', label: '已拒绝' },
  expired: { color: 'default', label: '已过期' },
};

const EmAtpCommitments: React.FC = () => {
  const [commitments, setCommitments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkVisible, setCheckVisible] = useState(false);
  const [checkResult, setCheckResult] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [form] = Form.useForm();

  const fetchCommitments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/em/atp/commitments');
      setCommitments(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchCommitments(); }, [fetchCommitments]);

  const handleCheck = async (values: any) => {
    setChecking(true);
    try {
      const res = await api.post('/em/atp/check', {
        requestedQty: values.requestedQty,
        product: values.product,
        startDate: values.startDate?.format('YYYY-MM-DD'),
      });
      setCheckResult(res);
    } catch (e: any) { message.error(e.message || '校验失败'); }
    setChecking(false);
  };

  const handleCommit = async () => {
    if (!checkResult) return;
    try {
      await api.post('/em/atp/commit', {
        requestedQty: checkResult.requested_qty,
        requestedProduct: checkResult.requested_product,
        atpQty: checkResult.atp_qty,
        earliestDate: checkResult.earliest_date,
        queuePosition: checkResult.queue_position,
      });
      message.success('承诺已记录');
      setCheckVisible(false);
      setCheckResult(null);
      form.resetFields();
      fetchCommitments();
    } catch (e: any) { message.error(e.message || '操作失败'); }
  };

  const handleConfirm = async (id: number) => {
    try {
      await api.post(`/em/atp/commitments/${id}/confirm`);
      message.success('已确认');
      fetchCommitments();
    } catch (e: any) { message.error(e.message || '操作失败'); }
  };

  const handleReject = async (id: number) => {
    try {
      await api.post(`/em/atp/commitments/${id}/reject`, { reason: '产能不足' });
      message.success('已拒绝');
      fetchCommitments();
    } catch (e: any) { message.error(e.message || '操作失败'); }
  };

  const columns = [
    { title: '承诺号', dataIndex: 'commitment_no', width: 160 },
    { title: '需求量', dataIndex: 'requested_qty', width: 80 },
    { title: '可承诺量', dataIndex: 'atp_qty', width: 90 },
    { title: '最早交付', dataIndex: 'earliest_date', width: 120, render: (v: string) => v ? new Date(v).toLocaleDateString() : '-' },
    { title: '排队位', dataIndex: 'queue_position', width: 70, render: (v: number) => v || '-' },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={statusMap[v]?.color}>{statusMap[v]?.label || v}</Tag> },
    { title: '创建时间', dataIndex: 'created_at', width: 160, render: (v: string) => new Date(v).toLocaleString() },
    {
      title: '操作', key: 'action', width: 140,
      render: (_: any, r: any) => r.status === 'pending' ? (
        <Space>
          <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => handleConfirm(r.id)}>确认</Button>
          <Button size="small" danger icon={<CloseOutlined />} onClick={() => handleReject(r.id)}>拒绝</Button>
        </Space>
      ) : null,
    },
  ];

  return (
    <Card title="ATP 交期承诺" extra={<Button type="primary" icon={<SearchOutlined />} onClick={() => setCheckVisible(true)}>产能校验</Button>}>
      <Table dataSource={commitments} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 15 }} scroll={{ x: 1000 }} />

      <Modal title="ATP 产能校验" open={checkVisible} onCancel={() => { setCheckVisible(false); setCheckResult(null); }} footer={null} width={600}>
        <Form form={form} layout="vertical" onFinish={handleCheck}>
          <Form.Item name="requestedQty" label="需求数量" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="product" label="产品"><Input placeholder="产品名称" /></Form.Item>
          <Form.Item name="startDate" label="期望交付日期"><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item><Button type="primary" htmlType="submit" loading={checking}>校验产能</Button></Form.Item>
        </Form>

        {checkResult && (
          <div style={{ marginTop: 16 }}>
            <Alert
              type={checkResult.can_fulfill ? 'success' : 'warning'}
              message={checkResult.can_fulfill ? '产能充足，可承诺交付' : `产能不足，需排队（位置 #${checkResult.queue_position}）`}
              style={{ marginBottom: 12 }}
            />
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="需求量">{checkResult.requested_qty}</Descriptions.Item>
              <Descriptions.Item label="可承诺量(ATP)">{checkResult.atp_qty}</Descriptions.Item>
              <Descriptions.Item label="最早交付">{checkResult.earliest_date || '-'}</Descriptions.Item>
              <Descriptions.Item label="排队位置">{checkResult.queue_position || '-'}</Descriptions.Item>
              <Descriptions.Item label="日产能">{checkResult.total_daily_capacity}</Descriptions.Item>
              <Descriptions.Item label="当前负荷">{checkResult.total_current_load} ({checkResult.overall_load_rate}%)</Descriptions.Item>
            </Descriptions>
            {checkResult.can_fulfill && (
              <div style={{ marginTop: 12, textAlign: 'right' }}>
                <Button type="primary" onClick={handleCommit}>记录承诺</Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
};

export default EmAtpCommitments;
