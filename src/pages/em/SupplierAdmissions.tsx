import React, { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Tag, Space, message, Popconfirm, DatePicker, InputNumber, Rate, Row, Col } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { api } from '../../api';
import dayjs from 'dayjs';

const { TextArea } = Input;
const { Option } = Select;

interface Admission {
  id: number;
  supplier_code: string;
  supplier_name: string;
  contact_person: string;
  contact_phone: string;
  business_license: string;
  category: string;
  region: string;
  status: string;
  score: number;
  level: string;
  reject_reason: string;
  exit_reason: string;
  applied_at: string;
  reviewed_at: string;
  admitted_at: string;
  exited_at: string;
  remark: string;
}

const statusMap: Record<string, { text: string; color: string }> = {
  applied: { text: '已申请', color: 'orange' },
  reviewed: { text: '已审核', color: 'blue' },
  admitted: { text: '已准入', color: 'green' },
  rejected: { text: '已拒绝', color: 'red' },
  exited: { text: '已退出', color: 'default' },
};

const SupplierAdmissions: React.FC = () => {
  const [data, setData] = useState<Admission[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Admission | null>(null);
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [targetStatus, setTargetStatus] = useState('');
  const [form] = Form.useForm();
  const [statusForm] = Form.useForm();

  useEffect(() => {
    loadData();
  }, [page, pageSize, statusFilter]);

  const loadData = async () => {
    setLoading(true);
    try {
      const params: any = { page, pageSize };
      if (statusFilter !== 'all') params.status = statusFilter;
      const res = await api.get('/em/admissions', { params });
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
    setModalVisible(true);
  };

  const handleEdit = (record: Admission) => {
    setEditingRecord(record);
    form.setFieldsValue(record);
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingRecord) {
        await api.put(`/em/admissions/${editingRecord.id}`, values);
        message.success('更新成功');
      } else {
        await api.post('/em/admissions', values);
        message.success('创建成功');
      }
      setModalVisible(false);
      loadData();
    } catch (err) {
      message.error('操作失败');
    }
  };

  const handleStatusChange = (record: Admission, newStatus: string) => {
    setEditingRecord(record);
    setTargetStatus(newStatus);
    statusForm.resetFields();
    setStatusModalVisible(true);
  };

  const handleStatusSubmit = async () => {
    try {
      const values = await statusForm.validateFields();
      await api.put(`/em/admissions/${editingRecord!.id}`, {
        status: targetStatus,
        ...values,
      });
      message.success('状态更新成功');
      setStatusModalVisible(false);
      loadData();
    } catch (err) {
      message.error('状态更新失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/em/admissions/${id}`);
      message.success('删除成功');
      loadData();
    } catch (err) {
      message.error('删除失败');
    }
  };

  const columns = [
    { title: '供应商编码', dataIndex: 'supplier_code', width: 120 },
    { title: '供应商名称', dataIndex: 'supplier_name', width: 150 },
    { title: '联系人', dataIndex: 'contact_person', width: 100 },
    { title: '联系电话', dataIndex: 'contact_phone', width: 120 },
    { title: '供应品类', dataIndex: 'category', width: 100 },
    { title: '区域', dataIndex: 'region', width: 80 },
    {
      title: '等级',
      dataIndex: 'level',
      width: 60,
      render: (level: string) => {
        const colorMap: Record<string, string> = { A: 'gold', B: 'blue', C: 'default' };
        return <Tag color={colorMap[level] || 'default'}>{level}</Tag>;
      },
    },
    {
      title: '评分',
      dataIndex: 'score',
      width: 100,
      render: (score: number) => <Rate disabled defaultValue={Math.min(5, Math.round(score / 20))} style={{ fontSize: 14 }} />,
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
      title: '申请时间',
      dataIndex: 'applied_at',
      width: 120,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD'),
    },
    {
      title: '操作',
      width: 200,
      fixed: 'right' as const,
      render: (_: any, record: Admission) => (
        <Space size="small">
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          {record.status === 'applied' && (
            <>
              <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => handleStatusChange(record, 'admitted')}>准入</Button>
              <Button size="small" danger icon={<CloseOutlined />} onClick={() => handleStatusChange(record, 'rejected')}>拒绝</Button>
            </>
          )}
          {record.status === 'reviewed' && (
            <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => handleStatusChange(record, 'admitted')}>准入</Button>
          )}
          {record.status === 'admitted' && (
            <Button size="small" onClick={() => handleStatusChange(record, 'exited')}>退出</Button>
          )}
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
        <h2 style={{ margin: 0 }}>供应商准入管理</h2>
        <Space>
          <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 120 }}>
            <Option value="all">全部状态</Option>
            <Option value="applied">已申请</Option>
            <Option value="reviewed">已审核</Option>
            <Option value="admitted">已准入</Option>
            <Option value="rejected">已拒绝</Option>
            <Option value="exited">已退出</Option>
          </Select>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新增申请</Button>
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
        scroll={{ x: 1200 }}
      />

      <Modal
        title={editingRecord ? '编辑供应商' : '新增供应商准入申请'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="supplier_name" label="供应商名称" rules={[{ required: true, message: '请输入供应商名称' }]}>
            <Input />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="contact_person" label="联系人">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contact_phone" label="联系电话">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="category" label="供应品类">
                <Input placeholder="如：原材料/包材/成品" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="region" label="区域">
                <Input placeholder="如：华东/华南/华北" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="business_license" label="营业执照号">
            <Input />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`确认${targetStatus === 'admitted' ? '准入' : targetStatus === 'rejected' ? '拒绝' : '退出'}`}
        open={statusModalVisible}
        onOk={handleStatusSubmit}
        onCancel={() => setStatusModalVisible(false)}
      >
        <Form form={statusForm} layout="vertical">
          {targetStatus === 'admitted' && (
            <>
              <Form.Item name="score" label="评分 (0-100)" rules={[{ required: true, message: '请输入评分' }]}>
                <InputNumber min={0} max={100} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="level" label="等级" rules={[{ required: true, message: '请选择等级' }]}>
                <Select>
                  <Option value="A">A (战略供应商)</Option>
                  <Option value="B">B (核心供应商)</Option>
                  <Option value="C">C (普通供应商)</Option>
                </Select>
              </Form.Item>
            </>
          )}
          {targetStatus === 'rejected' && (
            <Form.Item name="reject_reason" label="拒绝原因" rules={[{ required: true, message: '请输入拒绝原因' }]}>
              <TextArea rows={3} />
            </Form.Item>
          )}
          {targetStatus === 'exited' && (
            <Form.Item name="exit_reason" label="退出原因" rules={[{ required: true, message: '请输入退出原因' }]}>
              <TextArea rows={3} />
            </Form.Item>
          )}
          <Form.Item name="remark" label="备注">
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SupplierAdmissions;
