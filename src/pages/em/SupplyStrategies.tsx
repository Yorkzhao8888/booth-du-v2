import React, { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Tag, Space, message, Popconfirm, Switch, InputNumber, Card, Descriptions } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { api } from '../../api';

const { TextArea } = Input;
const { Option } = Select;

interface Strategy {
  id: number;
  name: string;
  description: string;
  priority_mode: string;
  source_tier: string;
  quota_type: string;
  quota_value: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const priorityModeMap: Record<string, { text: string; color: string }> = {
  fifo: { text: '先进先出', color: 'blue' },
  fefo: { text: '先效先出', color: 'green' },
  priority: { text: '按优先级', color: 'orange' },
};

const sourceTierMap: Record<string, { text: string; color: string }> = {
  tier1: { text: '一级货源', color: 'gold' },
  tier2: { text: '二级货源', color: 'blue' },
  tier3: { text: '三级货源', color: 'default' },
};

const quotaTypeMap: Record<string, { text: string }> = {
  fixed: { text: '固定配额' },
  ratio: { text: '比例配额' },
  dynamic: { text: '动态配额' },
};

const SupplyStrategies: React.FC = () => {
  const [data, setData] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Strategy | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await api.get('/em/strategies');
      setData(res.data.items);
    } catch (err) {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingRecord(null);
    form.resetFields();
    form.setFieldsValue({ priority_mode: 'fifo', source_tier: 'tier1', quota_type: 'fixed', quota_value: 0, is_active: true });
    setModalVisible(true);
  };

  const handleEdit = (record: Strategy) => {
    setEditingRecord(record);
    form.setFieldsValue(record);
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingRecord) {
        await api.put(`/em/strategies/${editingRecord.id}`, values);
        message.success('更新成功');
      } else {
        await api.post('/em/strategies', values);
        message.success('创建成功');
      }
      setModalVisible(false);
      loadData();
    } catch (err) {
      message.error('操作失败');
    }
  };

  const handleToggleActive = async (record: Strategy) => {
    try {
      await api.put(`/em/strategies/${record.id}`, { is_active: !record.is_active });
      message.success(record.is_active ? '已停用' : '已启用');
      loadData();
    } catch (err) {
      message.error('操作失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/em/strategies/${id}`);
      message.success('删除成功');
      loadData();
    } catch (err) {
      message.error('删除失败');
    }
  };

  const columns = [
    { title: '策略名称', dataIndex: 'name', width: 150 },
    { title: '描述', dataIndex: 'description', width: 200, ellipsis: true },
    {
      title: '优先级模式',
      dataIndex: 'priority_mode',
      width: 120,
      render: (mode: string) => {
        const m = priorityModeMap[mode] || { text: mode, color: 'default' };
        return <Tag color={m.color}>{m.text}</Tag>;
      },
    },
    {
      title: '货源分层',
      dataIndex: 'source_tier',
      width: 120,
      render: (tier: string) => {
        const t = sourceTierMap[tier] || { text: tier, color: 'default' };
        return <Tag color={t.color}>{t.text}</Tag>;
      },
    },
    {
      title: '配额类型',
      dataIndex: 'quota_type',
      width: 120,
      render: (type: string) => quotaTypeMap[type]?.text || type,
    },
    {
      title: '配额值',
      dataIndex: 'quota_value',
      width: 100,
      render: (v: number, record: Strategy) => {
        if (record.quota_type === 'ratio') return `${v}%`;
        return v;
      },
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: 80,
      render: (active: boolean, record: Strategy) => (
        <Switch checked={active} onChange={() => handleToggleActive(record)} size="small" />
      ),
    },
    {
      title: '操作',
      width: 120,
      fixed: 'right' as const,
      render: (_: any, record: Strategy) => (
        <Space size="small">
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>供给策略配置</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新增策略</Button>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="优先级模式说明">
            <Space>
              <Tag color="blue">先进先出 FIFO</Tag>
              <Tag color="green">先效先出 FEFO</Tag>
              <Tag color="orange">按优先级</Tag>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="货源分层说明">
            <Space>
              <Tag color="gold">一级货源</Tag>
              <Tag color="blue">二级货源</Tag>
              <Tag>三级货源</Tag>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="配额类型说明">
            <Space>
              <span>固定配额</span>
              <span>比例配额</span>
              <span>动态配额</span>
            </Space>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Table
        dataSource={data}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
        scroll={{ x: 1000 }}
      />

      <Modal
        title={editingRecord ? '编辑策略' : '新增策略'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="策略名称" rules={[{ required: true, message: '请输入策略名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item name="priority_mode" label="优先级模式" rules={[{ required: true }]}>
            <Select>
              <Option value="fifo">先进先出 (FIFO)</Option>
              <Option value="fefo">先效先出 (FEFO)</Option>
              <Option value="priority">按优先级</Option>
            </Select>
          </Form.Item>
          <Form.Item name="source_tier" label="货源分层" rules={[{ required: true }]}>
            <Select>
              <Option value="tier1">一级货源</Option>
              <Option value="tier2">二级货源</Option>
              <Option value="tier3">三级货源</Option>
            </Select>
          </Form.Item>
          <Form.Item name="quota_type" label="配额类型" rules={[{ required: true }]}>
            <Select>
              <Option value="fixed">固定配额</Option>
              <Option value="ratio">比例配额 (%)</Option>
              <Option value="dynamic">动态配额</Option>
            </Select>
          </Form.Item>
          <Form.Item name="quota_value" label="配额值">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="is_active" label="是否启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SupplyStrategies;
