import React, { useState, useEffect, useCallback } from 'react';
import { Table, Card, Button, Tag, Space, message, Drawer, Modal, Form, Input, InputNumber } from 'antd';
import { ReloadOutlined, TeamOutlined, PlusOutlined, CheckCircleOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { api } from '../../api';
import { fmtMoney } from '../../utils/format';

interface Supplier {
  id: number;
  name: string;
  contact_person: string | null;
  contact_phone: string | null;
  payment_terms: number;
  remark: string | null;
  created_at: string;
  total_settled: number;
  pending_settlement: number;
  settlement_count: number;
}

interface SettlementOrder {
  id: number;
  supplier_id: number;
  po_id: number;
  amount: number;
  status: string;
  settled_at: string | null;
  remark: string | null;
  created_at: string;
  po_no: string | null;
}

const statusLabels: Record<string, { text: string; color: string }> = {
  pending: { text: '待结算', color: 'warning' },
  settled: { text: '已结算', color: 'success' },
};

const Suppliers: React.FC = () => {
  const [data, setData] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [settlements, setSettlements] = useState<SettlementOrder[]>([]);
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<any>('/du/supply/suppliers');
      setData(res?.items || []);
    } catch {
      message.error('加载供应商列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async (values: any) => {
    setSubmitting(true);
    try {
      await api.post('/du/supply/suppliers', values);
      message.success('供应商创建成功');
      setCreateModalVisible(false);
      form.resetFields();
      fetchData();
    } catch (err: any) {
      message.error(err.message || '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除供应商"${name}"吗？`,
      onOk: async () => {
        try {
          await api.delete(`/du/supply/suppliers/${id}`);
          message.success('删除成功');
          fetchData();
        } catch {
          message.error('删除失败');
        }
      },
    });
  };

  const handleViewSettlements = async (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setDrawerVisible(true);
    setSettlementLoading(true);
    try {
      const res = await api.get<any>(`/du/supply/suppliers/${supplier.id}/settlements`);
      setSettlements(res?.items || []);
    } catch {
      message.error('加载结算单失败');
    } finally {
      setSettlementLoading(false);
    }
  };

  const handleSettle = async (settlementId: number) => {
    if (!selectedSupplier) return;
    try {
      await api.post(`/du/supply/suppliers/${selectedSupplier.id}/settlements/${settlementId}/settle`);
      message.success('结算确认成功');
      handleViewSettlements(selectedSupplier);
      fetchData();
    } catch {
      message.error('结算确认失败');
    }
  };

  const columns = [
    {
      title: '供应商名称',
      dataIndex: 'name',
      key: 'name',
      width: 180,
    },
    {
      title: '联系人',
      dataIndex: 'contact_person',
      key: 'contact_person',
      width: 120,
      render: (v: string | null) => v || '-',
    },
    {
      title: '联系电话',
      dataIndex: 'contact_phone',
      key: 'contact_phone',
      width: 130,
      render: (v: string | null) => v || '-',
    },
    {
      title: '账期(天)',
      dataIndex: 'payment_terms',
      key: 'payment_terms',
      width: 90,
      align: 'right' as const,
    },
    {
      title: '已结算金额',
      dataIndex: 'total_settled',
      key: 'total_settled',
      width: 130,
      align: 'right' as const,
      render: (v: number) => fmtMoney(v),
    },
    {
      title: '待结算金额',
      dataIndex: 'pending_settlement',
      key: 'pending_settlement',
      width: 130,
      align: 'right' as const,
      render: (v: number) => (
        <span style={{ color: v > 0 ? '#faad14' : '#52c41a', fontWeight: 600 }}>
          {fmtMoney(v)}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_: unknown, record: Supplier) => (
        <Space>
          <Button type="link" size="small" onClick={() => handleViewSettlements(record)}>
            结算单
          </Button>
          <Button type="link" size="small" danger onClick={() => handleDelete(record.id, record.name)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const settlementColumns = [
    {
      title: '采购单号',
      dataIndex: 'po_no',
      key: 'po_no',
      width: 140,
      render: (v: string | null) => v || '-',
    },
    {
      title: '结算金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      align: 'right' as const,
      render: (v: number) => fmtMoney(v),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: string) => {
        const info = statusLabels[v] || { text: v, color: 'default' };
        return <Tag color={info.color}>{info.text}</Tag>;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 160,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '结算时间',
      dataIndex: 'settled_at',
      key: 'settled_at',
      width: 160,
      render: (v: string | null) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: unknown, record: SettlementOrder) => (
        record.status === 'pending' ? (
          <Button type="link" icon={<CheckCircleOutlined />} onClick={() => handleSettle(record.id)}>
            确认结算
          </Button>
        ) : '-'
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card
        title={
          <Space>
            <TeamOutlined />
            <span>供应商管理</span>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalVisible(true)}>
              新建供应商
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: '暂无供应商' }}
        />
      </Card>

      <Drawer
        title={selectedSupplier ? `结算单 - ${selectedSupplier.name}` : '结算单'}
        open={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        width={800}
      >
        <Table
          rowKey="id"
          columns={settlementColumns}
          dataSource={settlements}
          loading={settlementLoading}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: '暂无结算单' }}
        />
      </Drawer>

      <Modal
        title="新建供应商"
        open={createModalVisible}
        onCancel={() => { setCreateModalVisible(false); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={submitting}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="供应商名称" rules={[{ required: true, message: '请输入供应商名称' }]}>
            <Input placeholder="请输入供应商名称" />
          </Form.Item>
          <Form.Item name="contact_person" label="联系人">
            <Input placeholder="请输入联系人" />
          </Form.Item>
          <Form.Item name="contact_phone" label="联系电话">
            <Input placeholder="请输入联系电话" />
          </Form.Item>
          <Form.Item name="payment_terms" label="账期(天)" initialValue={0}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="请输入备注" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Suppliers;
