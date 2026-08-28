import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, InputNumber, Select, message, Descriptions, Steps, List } from 'antd';
import { CheckCircleOutlined, ToolOutlined } from '@ant-design/icons';
import { api } from '../../api';

const woStatusMap: Record<string, { color: string; label: string }> = {
  pending: { color: 'default', label: '待接单' },
  accepted: { color: 'processing', label: '已接单' },
  in_progress: { color: 'blue', label: '制作中' },
  completed: { color: 'success', label: '已完成' },
  cancelled: { color: 'error', label: '已取消' },
};

const FabOperations: React.FC = () => {
  const [activeOrders, setActiveOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [selectedWo, setSelectedWo] = useState<any>(null);
  const [operations, setOperations] = useState<any[]>([]);
  const [form] = Form.useForm();

  const fetchActive = async () => {
    setLoading(true);
    try {
      const res = await api.get('/dexx/fab/active');
      setActiveOrders(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchActive(); }, []);

  const handleSelectWo = async (wo: any) => {
    setSelectedWo(wo);
    try {
      const res = await api.get(`/dex/fab/operations?workOrderId=${wo.id}`);
      setOperations(res.items || []);
    } catch (e) { setOperations([]); }
    setReportVisible(true);
  };

  const handleReport = async (values: any) => {
    if (!selectedWo) return;
    try {
      await api.post('/dexx/fab/report', {
        workOrderId: selectedWo.id,
        seq: values.seq,
        opName: values.opName,
        qtyCompleted: values.qtyCompleted,
        remark: values.remark,
      });
      message.success('报工成功');
      form.resetFields();
      // Refresh operations
      const res = await api.get(`/dex/fab/operations?workOrderId=${selectedWo.id}`);
      setOperations(res.items || []);
    } catch (e: any) { message.error(e.message || '报工失败'); }
  };

  const handleComplete = async () => {
    if (!selectedWo) return;
    try {
      await api.post('/dexx/fab/complete', { workOrderId: selectedWo.id });
      message.success('工单已完成，质检任务已创建');
      setReportVisible(false);
      fetchActive();
    } catch (e: any) { message.error(e.message || '操作失败'); }
  };

  const columns = [
    { title: '工单号', dataIndex: 'wo_no', width: 140 },
    { title: '产品', dataIndex: 'product_name', width: 150 },
    { title: '数量', dataIndex: 'qty', width: 80 },
    { title: '状态', dataIndex: 'status', width: 100, render: (s: string) => <Tag color={woStatusMap[s]?.color}>{woStatusMap[s]?.label || s}</Tag> },
    { title: '接单时间', dataIndex: 'accepted_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    {
      title: '操作', key: 'action', width: 120,
      render: (_: any, r: any) => <Button type="primary" size="small" icon={<ToolOutlined />} onClick={() => handleSelectWo(r)}>报工</Button>,
    },
  ];

  return (
    <Card title="工序报工">
      <Table dataSource={activeOrders} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} scroll={{ x: 700 }} />

      <Modal
        title={`报工 - ${selectedWo?.wo_no || ''} (${selectedWo?.product_name || ''})`}
        open={reportVisible}
        onCancel={() => setReportVisible(false)}
        width={700}
        footer={[
          <Button key="close" onClick={() => setReportVisible(false)}>关闭</Button>,
          <Button key="complete" type="primary" danger onClick={handleComplete}>完工</Button>,
        ]}
      >
        <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
          <Descriptions.Item label="数量">{selectedWo?.qty}</Descriptions.Item>
          <Descriptions.Item label="状态"><Tag color={woStatusMap[selectedWo?.status]?.color}>{woStatusMap[selectedWo?.status]?.label}</Tag></Descriptions.Item>
        </Descriptions>

        <Card size="small" title="已报工工序" style={{ marginBottom: 16 }}>
          {operations.length === 0 ? <span style={{ color: '#999' }}>暂无报工记录</span> : (
            <List size="small" dataSource={operations} renderItem={(op: any) => (
              <List.Item>
                <Space>
                  <Tag color="blue">工序{op.seq}</Tag>
                  <span>{op.op_name}</span>
                  <span>完成 {op.qty_completed} 件</span>
                </Space>
              </List.Item>
            )} />
          )}
        </Card>

        <Card size="small" title="新增报工">
          <Form form={form} layout="inline" onFinish={handleReport}>
            <Form.Item name="seq" label="工序序号" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: 80 }} />
            </Form.Item>
            <Form.Item name="opName" label="工序名称" rules={[{ required: true }]}>
              <Input style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="qtyCompleted" label="完成数量" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: 80 }} />
            </Form.Item>
            <Form.Item name="remark" label="备注">
              <Input style={{ width: 120 }} />
            </Form.Item>
            <Form.Item><Button type="primary" htmlType="submit">提交报工</Button></Form.Item>
          </Form>
        </Card>
      </Modal>
    </Card>
  );
};

export default FabOperations;
