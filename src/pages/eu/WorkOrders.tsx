import React, { useEffect, useState, useCallback } from 'react';
import { Table, Typography, Select, Space, Progress } from 'antd';
import { apiGet } from '../../api';
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
  acceptedAt?: string;
  completedAt?: string;
}

const EuWorkOrders: React.FC = () => {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const query = statusFilter ? `?status=${statusFilter}` : '';
      const res = await apiGet<WorkOrder[]>(`/eu/work-orders${query}`);
      setOrders(res);
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
      width: 160,
      render: (p: number) => <Progress percent={p || 0} size="small" />,
    },
    {
      title: '接单时间',
      dataIndex: 'acceptedAt',
      key: 'acceptedAt',
      width: 160,
      render: (t?: string) => (t ? dayjs(t).format('MM-DD HH:mm') : '-'),
    },
    {
      title: '完成时间',
      dataIndex: 'completedAt',
      key: 'completedAt',
      width: 160,
      render: (t?: string) => (t ? dayjs(t).format('MM-DD HH:mm') : '-'),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>工单管理</Title>
      <Space style={{ marginBottom: 16 }}>
        <span>状态筛选:</span>
        <Select
          allowClear
          placeholder="全部状态"
          style={{ width: 160 }}
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
      <Table
        columns={columns}
        dataSource={orders}
        rowKey="id"
        loading={loading}
        scroll={{ x: 900 }}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
      />
    </div>
  );
};

export default EuWorkOrders;
