import React, { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Tag, Space, message, Popconfirm, DatePicker, InputNumber, Card, Progress, Drawer, Descriptions } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined, SettingOutlined } from '@ant-design/icons';
import { api } from '../../api';
import dayjs from 'dayjs';

const { TextArea } = Input;
const { Option } = Select;
const { RangePicker } = DatePicker;

interface CapacityPlan {
  id: number;
  name: string;
  period_type: string;
  period_start: string;
  period_end: string;
  total_capacity: number;
  allocated_capacity: number;
  remaining_capacity: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Allocation {
  id: number;
  plan_id: number;
  target_type: string;
  target_id: number;
  target_name: string;
  allocated_qty: number;
  used_qty: number;
  created_at: string;
}

const statusMap: Record<string, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  active: { text: '生效中', color: 'green' },
  completed: { text: '已完成', color: 'blue' },
  cancelled: { text: '已取消', color: 'red' },
};

const periodTypeMap: Record<string, string> = {
  daily: '日',
  weekly: '周',
  monthly: '月',
};

const CapacityPlanning: React.FC = () => {
  const [data, setData] = useState<CapacityPlan[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CapacityPlan | null>(null);
  const [allocDrawerVisible, setAllocDrawerVisible] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<CapacityPlan | null>(null);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [allocModalVisible, setAllocModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [allocForm] = Form.useForm();

  useEffect(() => {
    loadData();
  }, [page, pageSize, statusFilter]);

  const loadData = async () => {
    setLoading(true);
    try {
      const params: any = { page, pageSize };
      if (statusFilter !== 'all') params.status = statusFilter;
      const res = await api.get('/em/capacity-plans', { params });
      setData(res.data.items);
      setTotal(res.data.total);
    } catch (err) {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingRecord(null);
    form.resetFields();
    form.setFieldsValue({ period_type: 'monthly', status: 'draft' });
    setModalVisible(true);
  };

  const handleEdit = (record: CapacityPlan) => {
    setEditingRecord(record);
    form.setFieldsValue({
      ...record,
      dateRange: [dayjs(record.period_start), dayjs(record.period_end)],
    });
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const { dateRange, ...rest } = values;
      const payload = {
        ...rest,
        period_start: dateRange[0].format('YYYY-MM-DD'),
        period_end: dateRange[1].format('YYYY-MM-DD'),
      };
      if (editingRecord) {
        await api.put(`/em/capacity-plans/${editingRecord.id}`, payload);
        message.success('更新成功');
      } else {
        await api.post('/em/capacity-plans', payload);
        message.success('创建成功');
      }
      setModalVisible(false);
      loadData();
    } catch (err) {
      message.error('操作失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/em/capacity-plans/${id}`);
      message.success('删除成功');
      loadData();
    } catch (err) {
      message.error('删除失败');
    }
  };

  const handleViewAllocations = async (record: CapacityPlan) => {
    setSelectedPlan(record);
    setAllocDrawerVisible(true);
    try {
      const res = await api.get(`/em/capacity-plans/${record.id}/allocations`);
      setAllocations(res.data.items);
    } catch (err) {
      message.error('加载分配明细失败');
    }
  };

  const handleAddAllocation = () => {
    allocForm.resetFields();
    allocForm.setFieldsValue({ target_type: 'shop' });
    setAllocModalVisible(true);
  };

  const handleAllocSubmit = async () => {
    try {
      const values = await allocForm.validateFields();
      await api.post(`/em/capacity-plans/${selectedPlan!.id}/allocations`, values);
      message.success('分配成功');
      setAllocModalVisible(false);
      // Refresh allocations and plan data
      const res = await api.get(`/em/capacity-plans/${selectedPlan!.id}/allocations`);
      setAllocations(res.data.items);
      loadData();
    } catch (err: any) {
      message.error(err?.response?.data?.error || '分配失败');
    }
  };

  const handleDeleteAllocation = async (allocId: number) => {
    try {
      await api.delete(`/em/capacity-plans/${selectedPlan!.id}/allocations/${allocId}`);
      message.success('删除成功');
      const res = await api.get(`/em/capacity-plans/${selectedPlan!.id}/allocations`);
      setAllocations(res.data.items);
      loadData();
    } catch (err) {
      message.error('删除失败');
    }
  };

  const columns = [
    { title: '规划名称', dataIndex: 'name', width: 150 },
    {
      title: '周期类型',
      dataIndex: 'period_type',
      width: 80,
      render: (type: string) => periodTypeMap[type] || type,
    },
    {
      title: '周期',
      width: 180,
      render: (_: any, record: CapacityPlan) =>
        `${dayjs(record.period_start).format('YYYY-MM-DD')} ~ ${dayjs(record.period_end).format('YYYY-MM-DD')}`,
    },
    {
      title: '总产能',
      dataIndex: 'total_capacity',
      width: 100,
      render: (v: number) => Number(v).toFixed(0),
    },
    {
      title: '产能利用率',
      width: 150,
      render: (_: any, record: CapacityPlan) => {
        const total = Number(record.total_capacity);
        const allocated = Number(record.allocated_capacity);
        const rate = total > 0 ? (allocated / total) * 100 : 0;
        return (
          <Space>
            <Progress percent={Number(rate.toFixed(1))} size="small" style={{ width: 80 }} />
            <span style={{ fontSize: 12 }}>{allocated.toFixed(0)}/{total.toFixed(0)}</span>
          </Space>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: string) => {
        const s = statusMap[status] || { text: status, color: 'default' };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    {
      title: '操作',
      width: 200,
      fixed: 'right' as const,
      render: (_: any, record: CapacityPlan) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleViewAllocations(record)}>分配</Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const allocColumns = [
    { title: '分配对象类型', dataIndex: 'target_type', render: (t: string) => t === 'shop' ? '店铺' : '商品' },
    { title: '分配对象', dataIndex: 'target_name' },
    {
      title: '分配数量',
      dataIndex: 'allocated_qty',
      render: (v: number) => Number(v).toFixed(0),
    },
    {
      title: '已使用',
      dataIndex: 'used_qty',
      render: (v: number) => Number(v).toFixed(0),
    },
    {
      title: '操作',
      render: (_: any, record: Allocation) => (
        <Popconfirm title="确定删除此分配？" onConfirm={() => handleDeleteAllocation(record.id)}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>产能规划管理</h2>
        <Space>
          <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 120 }}>
            <Option value="all">全部状态</Option>
            <Option value="draft">草稿</Option>
            <Option value="active">生效中</Option>
            <Option value="completed">已完成</Option>
            <Option value="cancelled">已取消</Option>
          </Select>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新增规划</Button>
        </Space>
      </div>

      <Table
        dataSource={data}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          pageSize,
          total,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
        }}
        scroll={{ x: 1000 }}
      />

      <Modal
        title={editingRecord ? '编辑产能规划' : '新增产能规划'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="规划名称" rules={[{ required: true, message: '请输入规划名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="period_type" label="周期类型" rules={[{ required: true }]}>
            <Select>
              <Option value="daily">日</Option>
              <Option value="weekly">周</Option>
              <Option value="monthly">月</Option>
            </Select>
          </Form.Item>
          <Form.Item name="dateRange" label="周期范围" rules={[{ required: true, message: '请选择周期范围' }]}>
            <RangePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="total_capacity" label="总产能" rules={[{ required: true, message: '请输入总产能' }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          {editingRecord && (
            <Form.Item name="status" label="状态">
              <Select>
                <Option value="draft">草稿</Option>
                <Option value="active">生效</Option>
                <Option value="completed">完成</Option>
                <Option value="cancelled">取消</Option>
              </Select>
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Drawer
        title={`产能分配 - ${selectedPlan?.name || ''}`}
        open={allocDrawerVisible}
        onClose={() => setAllocDrawerVisible(false)}
        width={700}
        extra={
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddAllocation}>新增分配</Button>
          </Space>
        }
      >
        {selectedPlan && (
          <Card size="small" style={{ marginBottom: 16 }}>
            <Descriptions size="small" column={3}>
              <Descriptions.Item label="总产能">{Number(selectedPlan.total_capacity).toFixed(0)}</Descriptions.Item>
              <Descriptions.Item label="已分配">{Number(selectedPlan.allocated_capacity).toFixed(0)}</Descriptions.Item>
              <Descriptions.Item label="剩余产能">{Number(selectedPlan.remaining_capacity).toFixed(0)}</Descriptions.Item>
            </Descriptions>
          </Card>
        )}
        <Table
          dataSource={allocations}
          columns={allocColumns}
          rowKey="id"
          pagination={false}
          size="small"
        />
      </Drawer>

      <Modal
        title="新增产能分配"
        open={allocModalVisible}
        onOk={handleAllocSubmit}
        onCancel={() => setAllocModalVisible(false)}
      >
        <Form form={allocForm} layout="vertical">
          <Form.Item name="target_type" label="分配对象类型" rules={[{ required: true }]}>
            <Select>
              <Option value="shop">店铺</Option>
              <Option value="product">商品</Option>
            </Select>
          </Form.Item>
          <Form.Item name="target_name" label="分配对象名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：旗舰店A / 商品X" />
          </Form.Item>
          <Form.Item name="allocated_qty" label="分配数量" rules={[{ required: true, message: '请输入数量' }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CapacityPlanning;
