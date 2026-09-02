import React, { useEffect, useState, useCallback } from 'react';
import { Table, Typography, Button, Space, Tag, Modal, Form, Input, Select, InputNumber, message, Popconfirm } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { apiGet, apiPost, apiPut, apiDelete } from '../../api';
import type { ColumnsType } from 'antd/es/table';

const { Title } = Typography;

interface SkuOption {
  id: number;
  skuCode: string;
  name: string;
  unit: string;
}

interface BomMaterial {
  skuId: number;
  skuCode: string;
  name: string;
  qty: number;
  unit: string;
}

interface Bom {
  id: number;
  productName: string;
  productCode: string;
  materials: BomMaterial[];
  isActive: boolean;
}

const ExBoms: React.FC = () => {
  const [boms, setBoms] = useState<Bom[]>([]);
  const [skus, setSkus] = useState<SkuOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<Bom[]>('/ex/boms');
      setBoms(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const loadSkus = async () => {
    try {
      const res = await apiGet<SkuOption[]>('/ex/skus');
      setSkus(res);
    } catch {
      setSkus([]);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({ materials: [{ skuId: undefined, qty: 1, unit: 'g' }] });
    loadSkus();
    setModalOpen(true);
  };

  const openEdit = (record: Bom) => {
    setEditingId(record.id);
    form.setFieldsValue({
      productName: record.productName,
      productCode: record.productCode,
      materials: record.materials.map((m) => ({
        skuId: m.skuId,
        qty: m.qty,
        unit: m.unit,
      })),
    });
    loadSkus();
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const materials = values.materials.map((m: { skuId: number; qty: number; unit: string }) => {
        const sku = skus.find((s) => s.id === m.skuId);
        return {
          skuId: m.skuId,
          skuCode: sku?.skuCode || '',
          name: sku?.name || '',
          qty: m.qty,
          unit: m.unit,
        };
      });
      const payload = {
        productName: values.productName,
        productCode: values.productCode,
        materials,
      };

      if (editingId) {
        await apiPut(`/ex/boms/${editingId}`, payload);
        message.success('BOM 更新成功');
      } else {
        await apiPost('/ex/boms', payload);
        message.success('BOM 创建成功');
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

  const handleDelete = async (id: number) => {
    try {
      await apiDelete(`/ex/boms/${id}`);
      message.success('删除成功');
      fetchData();
    } catch (err: unknown) {
      const e = err as { error?: string };
      message.error(e.error || '删除失败');
    }
  };

  const columns: ColumnsType<Bom> = [
    { title: '商品名', dataIndex: 'productName', key: 'productName' },
    { title: '编码', dataIndex: 'productCode', key: 'productCode', width: 140 },
    {
      title: '原材料',
      dataIndex: 'materials',
      key: 'materials',
      render: (materials: BomMaterial[]) => (
        <div>
          {materials?.map((m, idx) => (
            <Tag key={idx} style={{ marginBottom: 4 }}>
              {m.name} {m.qty}{m.unit}
            </Tag>
          ))}
        </div>
      ),
    },
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
      width: 140,
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" onClick={() => openEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除此BOM？" onConfirm={() => handleDelete(record.id)} okText="删除" cancelText="取消">
            <Button type="link" danger size="small">删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>BOM 管理</Title>
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建BOM
        </Button>
      </div>
      <Table
        columns={columns}
        dataSource={boms}
        rowKey="id"
        loading={loading}
        scroll={{ x: 800 }}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
      />

      <Modal
        title={editingId ? '编辑BOM' : '新建BOM'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        width={640}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="productName" label="商品名称" rules={[{ required: true, message: '请输入商品名称' }]}>
            <Input placeholder="请输入商品名称" />
          </Form.Item>
          <Form.Item name="productCode" label="商品编码" rules={[{ required: true, message: '请输入商品编码' }]}>
            <Input placeholder="请输入商品编码" />
          </Form.Item>

          <Form.List name="materials">
            {(fields, { add, remove }) => (
              <div>
                <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 500 }}>原材料明细</span>
                  <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => add({ skuId: undefined, qty: 1, unit: 'g' })}>
                    添加原料
                  </Button>
                </div>
                {fields.map(({ key, name, ...restField }) => (
                  <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                    <Form.Item
                      {...restField}
                      name={[name, 'skuId']}
                      rules={[{ required: true, message: '选择SKU' }]}
                    >
                      <Select
                        placeholder="选择SKU"
                        style={{ width: 200 }}
                        showSearch
                        optionFilterProp="label"
                        options={skus.map((s) => ({ label: `${s.name} (${s.skuCode})`, value: s.id }))}
                      />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'qty']}
                      rules={[{ required: true, message: '输入数量' }]}
                    >
                      <InputNumber min={0} placeholder="数量" style={{ width: 100 }} />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'unit']}
                      rules={[{ required: true, message: '选择单位' }]}
                    >
                      <Select style={{ width: 80 }} options={[
                        { label: 'g', value: 'g' },
                        { label: 'kg', value: 'kg' },
                        { label: '个', value: '个' },
                        { label: '瓶', value: '瓶' },
                      ]} />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#ff4d4f' }} />
                  </Space>
                ))}
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>
    </div>
  );
};

export default ExBoms;
