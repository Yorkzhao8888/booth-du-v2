import React, { useEffect, useState } from 'react';
import { Table, Card, Typography, Button, Modal, Form, Input, Select, message, Space, Tag, Popconfirm } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../../api';
import { useAuthStore } from '../../store';

const { Title } = Typography;

interface Employee {
  id: number;
  name: string;
  phone: string;
  role: string;
  hats: string[];
  created_at: string;
}

const roleOptions = [
  { value: 'dm', label: 'DM 运营' },
  { value: 'du', label: 'DU 店主' },
  { value: 'dx', label: 'DX 店长' },
  { value: 'dxx', label: 'DXX 店员' },
  { value: 'ex', label: 'EX 铺长' },
  { value: 'exx', label: 'EXX 铺员' },
];

const hatOptions = [
  { value: 'FAB', label: 'FAB 制造' },
  { value: 'WH', label: 'WH 仓储' },
  { value: 'DL', label: 'DL 配送' },
  { value: 'SVC', label: 'SVC 服务' },
];

const EmployeeManagement: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();
  const user = useAuthStore((s) => s.user);
  const isReadOnly = user?.role === 'dm';
  const canAdd = ['dm', 'du'].includes(user?.role || '');

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: Employee[] }>('/du/users');
      setEmployees(res.items || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, []);

  const handleAdd = async (values: { name: string; phone: string; password: string; role: string; hats?: string[] }) => {
    try {
      await api.post('/du/users', values);
      message.success('员工添加成功');
      setModalVisible(false);
      form.resetFields();
      fetchEmployees();
    } catch (e: unknown) {
      const err = e as { error?: string };
      message.error(err.error || '添加失败');
    }
  };

  const handleResetPassword = async (id: number) => {
    try {
      await api.post(`/du/users/${id}/reset-password`, { password: '123456' });
      message.success('密码已重置为 123456');
    } catch (e: unknown) {
      const err = e as { error?: string };
      message.error(err.error || '重置失败');
    }
  };

  const columns = [
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '手机号', dataIndex: 'phone', key: 'phone' },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => {
        const opt = roleOptions.find((r) => r.value === role);
        return <Tag color="blue">{opt?.label || role}</Tag>;
      },
    },
    {
      title: '帽子',
      dataIndex: 'hats',
      key: 'hats',
      render: (hats: string[]) => hats?.length ? hats.map((h) => <Tag key={h}>{h}</Tag>) : '-',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: Employee) => (
        <Space>
          {!isReadOnly && canAdd && (
            <Popconfirm title="确认重置密码为 123456？" onConfirm={() => handleResetPassword(record.id)}>
              <Button size="small">重置密码</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4}>员工管理</Title>
      <Card
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchEmployees}>刷新</Button>
            {!isReadOnly && canAdd && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
                添加员工
              </Button>
            )}
          </Space>
        }
      >
        <Table
          dataSource={employees}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20 }}
        />
      </Card>

      <Modal
        title="添加员工"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} onFinish={handleAdd} layout="vertical">
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="手机号" rules={[{ required: true, message: '请输入手机号' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="初始密码" initialValue="123456" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select options={roleOptions} />
          </Form.Item>
          <Form.Item name="hats" label="帽子（EXX 铺员需要）">
            <Select mode="multiple" options={hatOptions} placeholder="选择帽子" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default EmployeeManagement;
