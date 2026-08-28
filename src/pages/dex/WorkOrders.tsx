import React, { useEffect, useState, useCallback } from 'react';
import { Table, Typography, Button, Space, Select, Modal, Form, InputNumber, Input, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { apiGet, apiPost } from '../../api';
import StatusTag from '../../components/StatusTag';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const { Title } = Typography;

interface WorkOrder {
  id: number;
  productName: string;
  qty: number;
  status: string;
  progress: number;
  createdAt: string;
  bomId?: number;
}

interface BomOption {
  id: number;
  productName: string;
  productCode: string;
}

const ExWorkOrders: React.FC = () => {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<WorkOrder | null>(null);
  const [boms, setBoms] = useState<BomOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const [cancelForm] = Form.useForm();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const query = statusFilter ? `?status=${statusFilter}` : '';
      const res = await apiGet<{ items: WorkOrder[]; total: number }>(`/dex/work-orders${query}`);
      setOrders(res.items);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchData();
    const handler = () => fetchData();
    window.addEventListener('booth:refresh', handler);
    return () => window.removeEventListener('booth:refresh', handler);
  }, [fetchData]);

  const openCreate = async () => {
    try {
      const res = await apiGet<BomOption[]>('/dex/boms?active=1');
      setBoms(res);
    } catch {
      setBoms([]);
    }
    form.resetFields();
    setModalOpen(true);
  };

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await apiPost('/dex/work-orders', { bomId: values.bomId, qty: values.qty });
      message.success('工单创建成功');
      setModalOpen(false);
      fetchData();
    } catch (err: unknown) {
      if ((err as { errorFields?: unknown }).errorFields) return;
      const e = err as { error?: string };
      message.error(e.error || '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const openCancel = (record: WorkOrder) => {
    setCancelTarget(record);
    cancelForm.resetFields();
    setCancelModalOpen(true);
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    try {
      const values = await cancelForm.validateFields();
      setSubmitting(true);
      await apiPost(`/dex/work-orders/${cancelTarget.id}/cancel`, { reason: values.reason });
      message.success('工单已取消');
      setCancelModalOpen(false);
      fetchData();
    } catch (err: unknown) {
      if ((err as { errorFields?: unknown }).errorFields) return;
      const e = err as { error?: string };
      message.error(e.error || '取消失败');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnsType<WorkOrder> = [
    { title: '商品', dataIndex: 'productName', key: 'productName' },
    { title: '数量', dataIndex: 'qty', key: 'qty', width: 80 },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (s: string) => <StatusTag status={s} />,
    },
    {
      title: '进度',
      dataIndex: 'progress',
      key: 'progress',
      width: 120,
      render: (p: number) => `${p || 0}%`,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (t: string) => dayjs(t).format('MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) =>
        ['pending', 'accepted'].includes(record.status) ? (
          <Button type="link" danger size="small" onClick={() => openCancel(record)}>
            取消
          </Button>
        ) : null,
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>工单管理</Title>
      <Space style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%' }}>
        <Space>
          <span>状态:</span>
          <Select
            allowClear
            placeholder="全部"
            style={{ width: 140 }}
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v || '')}
            options={[
              { label: '待接单', value: 'pending' },
              { label: '已接单', value: 'accepted' },
              { label: '制作中', value: 'preparing' },
              { label: '已完成', value: 'completed' },
              { label: '已取消', value: 'cancelled' },
            ]}
          />
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建工单
        </Button>
      </Space>
      <Table
        columns={columns}
        dataSource={orders}
        rowKey="id"
        loading={loading}
        scroll={{ x: 800 }}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
      />

      <Modal
        title="新建工单"
        open={modalOpen}
        onOk={handleCreate}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="bomId" label="选择商品 (BOM)" rules={[{ required: true, message: '请选择商品' }]}>
            <Select
              placeholder="选择商品"
              options={boms.map((b) => ({ label: `${b.productName} (${b.productCode})`, value: b.id }))}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item name="qty" label="数量" rules={[{ required: true, message: '请输入数量' }]}>
            <InputNumber min={1} style={{ width: '100%' }} placeholder="请输入数量" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="取消工单"
        open={cancelModalOpen}
        onOk={handleCancel}
        onCancel={() => setCancelModalOpen(false)}
        confirmLoading={submitting}
        okText="确认取消"
        okButtonProps={{ danger: true }}
      >
        <p>确定要取消工单 <strong>{cancelTarget?.productName}</strong> 吗？</p>
        <Form form={cancelForm} layout="vertical">
          <Form.Item name="reason" label="取消原因" rules={[{ required: true, message: '请输入取消原因' }]}>
            <Input.TextArea rows={3} placeholder="请输入取消原因" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ExWorkOrders;
