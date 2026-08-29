import React, { useState, useEffect, useCallback } from 'react';
import { Table, Card, Button, Tag, Space, message, Drawer, Descriptions, List, Modal, Form, Input } from 'antd';
import { ReloadOutlined, TeamOutlined, DollarOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { api } from '../../api';
import { fmtMoney } from '../../utils/format';

interface Supplier {
  supplier: string;
  po_count: number;
  total_settled: number;
  pending_settlement: number;
}

interface SettlementOrder {
  id: number;
  po_no: string;
  supplier: string;
  total_amount: number;
  status: string;
  approved_at: string | null;
  received_at: string | null;
  created_at: string;
}

const statusLabels: Record<string, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  pending: { text: '待审批', color: 'processing' },
  approved: { text: '待结算', color: 'warning' },
  received: { text: '已结算', color: 'success' },
  rejected: { text: '已驳回', color: 'error' },
};

const Suppliers: React.FC = () => {
  const [data, setData] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);
  const [settlements, setSettlements] = useState<SettlementOrder[]>([]);
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/du/supply/suppliers');
      setData(res.data?.items || []);
    } catch {
      message.error('加载供应商列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleViewSettlements = async (supplier: string) => {
    setSelectedSupplier(supplier);
    setDrawerVisible(true);
    setSettlementLoading(true);
    try {
      const res = await api.get(`/du/supply/suppliers/${encodeURIComponent(supplier)}/settlements`);
      setSettlements(res.data?.items || []);
    } catch {
      message.error('加载结算单失败');
    } finally {
      setSettlementLoading(false);
    }
  };

  const handleSettle = async (id: number) => {
    if (!selectedSupplier) return;
    try {
      await api.post(`/du/supply/suppliers/${encodeURIComponent(selectedSupplier)}/settlements/${id}/settle`);
      message.success('结算确认成功');
      handleViewSettlements(selectedSupplier);
      fetchData();
    } catch {
      message.error('结算确认失败');
    }
  };

  const columns = [
    {
      title: '供应商',
      dataIndex: 'supplier',
      key: 'supplier',
      width: 200,
    },
    {
      title: '采购单数',
      dataIndex: 'po_count',
      key: 'po_count',
      width: 120,
      align: 'right' as const,
    },
    {
      title: '已结算金额',
      dataIndex: 'total_settled',
      key: 'total_settled',
      width: 150,
      align: 'right' as const,
      render: (v: number) => fmtMoney(v),
    },
    {
      title: '待结算金额',
      dataIndex: 'pending_settlement',
      key: 'pending_settlement',
      width: 150,
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
      width: 120,
      render: (_: unknown, record: Supplier) => (
        <Button type="link" onClick={() => handleViewSettlements(record.supplier)}>
          查看结算单
        </Button>
      ),
    },
  ];

  const settlementColumns = [
    {
      title: '采购单号',
      dataIndex: 'po_no',
      key: 'po_no',
      width: 160,
    },
    {
      title: '金额',
      dataIndex: 'total_amount',
      key: 'total_amount',
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
      title: '审批时间',
      dataIndex: 'approved_at',
      key: 'approved_at',
      width: 160,
      render: (v: string | null) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: '结算时间',
      dataIndex: 'received_at',
      key: 'received_at',
      width: 160,
      render: (v: string | null) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: unknown, record: SettlementOrder) => (
        record.status === 'approved' ? (
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
          <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
        }
      >
        <Table
          rowKey="supplier"
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: '暂无供应商数据' }}
        />
      </Card>

      <Drawer
        title={`结算单 - ${selectedSupplier}`}
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
    </div>
  );
};

export default Suppliers;
