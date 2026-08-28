import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, InputNumber, Radio, message, Descriptions } from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { api } from '../../api';

const QcExecute: React.FC = () => {
  const [pendingQc, setPendingQc] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [executeVisible, setExecuteVisible] = useState(false);
  const [currentQc, setCurrentQc] = useState<any>(null);
  const [form] = Form.useForm();

  const fetchPending = async () => {
    setLoading(true);
    try {
      const res = await api.get('/dexx/fab/qc/pending');
      setPendingQc(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchPending(); }, []);

  const handleExecute = async (values: any) => {
    if (!currentQc) return;
    try {
      await api.post('/dexx/fab/qc/execute', {
        qcId: currentQc.id,
        passed: values.passed,
        passedQty: values.passedQty,
        failedQty: values.failedQty,
        remark: values.remark,
      });
      message.success(values.passed ? '质检通过' : '质检不通过');
      setExecuteVisible(false);
      form.resetFields();
      fetchPending();
    } catch (e: any) { message.error(e.message || '操作失败'); }
  };

  const columns = [
    { title: 'QC ID', dataIndex: 'id', width: 80 },
    { title: '工单ID', dataIndex: 'work_order_id', width: 80 },
    { title: '产品', dataIndex: 'product_name', width: 150 },
    { title: '工单数量', dataIndex: 'wo_qty', width: 80 },
    { title: 'QC类型', dataIndex: 'qc_type', width: 100, render: (v: string) => v === 'final' ? '终检' : v },
    { title: '创建时间', dataIndex: 'created_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    {
      title: '操作', key: 'action', width: 100,
      render: (_: any, r: any) => <Button type="primary" size="small" icon={<CheckCircleOutlined />} onClick={() => { setCurrentQc(r); setExecuteVisible(true); }}>执行质检</Button>,
    },
  ];

  return (
    <Card title="质检执行">
      <Table dataSource={pendingQc} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} scroll={{ x: 700 }} />

      <Modal title={`质检 - ${currentQc?.product_name || ''}`} open={executeVisible} onCancel={() => setExecuteVisible(false)} onOk={() => form.submit()} width={500}>
        {currentQc && (
          <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label="产品">{currentQc.product_name}</Descriptions.Item>
            <Descriptions.Item label="工单数量">{currentQc.wo_qty}</Descriptions.Item>
          </Descriptions>
        )}
        <Form form={form} layout="vertical" onFinish={handleExecute} initialValues={{ passed: true }}>
          <Form.Item name="passed" label="质检结果" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio value={true}>通过</Radio>
              <Radio value={false}>不通过</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="passedQty" label="合格数量"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="failedQty" label="不合格数量"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default QcExecute;
