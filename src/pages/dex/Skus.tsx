import React, { useEffect, useState, useCallback } from 'react';
import { Table, Typography, Button, Space, Tag, Modal, Form, Input, Select, InputNumber, message, Popconfirm } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { apiGet, apiPost, apiPut } from '../../api';
import type { ColumnsType } from 'antd/es/table';

const { Title } = Typography;

interface Sku {
  id: number;
  skuCode: string;
  name: string;
  unit: string;
  safetyStock: number;
  isActive: boolean;
}

const ExSkus: React.FC = () => {
  const [skus, setSkus] = useState<Sku[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<Sku[]>('/dex/skus');
      setSkus(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreate = () => {
    setEditingId(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record: Sku) => {
    setEditingId(record.id);
    form.setFieldsValue(record);
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (editingId) {
        await apiPut(`/dex/skus/${editingId}`, values);
        message.success('SKU 更新成功');
      } else {
        await apiPost('/dex/skus', values);
        message.success('SKU 创建成功');
      }
      setModalOpen(false);
      fetchData();
    } catch (err: unknown) {
      if ((err as { errorFields?: unknown }).errorFields) return;
      const e = err as { error?: string };
      message.error(e.error || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (id: number) => {
    try {
      await apiPut(`/dex/skus/${id}`, { isActive: false });
      message.success('已停用');
      fetchData();
    } catch (err: unknown) {
      const e = err as { error?: string };
      message.error(e.error || '操作失败');
    }
  };

  const columns: ColumnsType<Sku> = [
    { title: 'SKU编码', dataIndex: 'skuCode', key: 'skuCode', width: 140 },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '单位', dataIndex: 'unit', key: 'unit', width: 80 },
    { title: '安全库存', dataIndex: 'safetyStock', key: 'safetyStock', width: 100 },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 80,
      render: (a: boolean) => (a ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" onClick={() => openEdit(record)}>编辑</Button>
          {record.isActive && (
            <Popconfirm title="确定停用此SKU？" onConfirm={() => handleDeactivate(record.id)} okText="停用" cancelText="取消">
              <Button type="link" danger size="small">停用</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>SKU 管理</Title>
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建SKU
        </Button>
      </div>
      <Table
        columns={columns}
        dataSource={skus}
        rowKey="id"
        loading={loading}
        scroll={{ x: 800 }}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
      />

      <Modal
        title={editingId ? '编辑SKU' : '新建SKU'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="skuCode" label="SKU编码" rules={[{ required: true, message: '请输入SKU编码' }]}>
            <Input placeholder="请输入SKU编码" disabled={!!editingId} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="请输入名称" />
          </Form.Item>
          <Form.Item name="unit" label="单位" rules={[{ required: true, message: '请选择单位' }]}>
            <Select options={[
              { label: 'g', value: 'g' },
              { label: 'kg', value: 'kg' },
              { label: '个', value: '个' },
              { label: '瓶', value: '瓶' },
            ]} />
          </Form.Item>
          <Form.Item name="safetyStock" label="安全库存" rules={[{ required: true, message: '请输入安全库存' }]}>
            <InputNumber min={0} style={{ width: '100%' }} placeholder="请输入安全库存" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ExSkus;
