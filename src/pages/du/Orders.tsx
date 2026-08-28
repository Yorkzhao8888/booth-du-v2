import React, { useEffect, useState, useCallback } from 'react';
import { Table, Typography, Tag } from 'antd';
import { apiGet } from '../../api';
import PriceText from '../../components/PriceText';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const { Title } = Typography;

interface OrderItem {
  productName: string;
  qty: number;
  price?: number;
}

interface Order {
  id: number;
  orderNo: string;
  items: OrderItem[];
  requiredTime: string;
  status: string;
  amount: number;
  grossProfit: number;
}

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'blue', text: '待处理' },
  processing: { color: 'orange', text: '处理中' },
  fulfilled: { color: 'green', text: '已完成' },
  cancelled: { color: 'red', text: '已取消' },
};

const EuOrders: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchData = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await apiGet<{ items: Order[]; total: number }>(`/du/orders?page=${p}&pageSize=10`);
      setOrders(res.items);
      setTotal(res.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(page);
    const handler = () => fetchData(page);
    window.addEventListener('booth:refresh', handler);
    return () => window.removeEventListener('booth:refresh', handler);
  }, [page, fetchData]);

  const columns: ColumnsType<Order> = [
    { title: '订单号', dataIndex: 'orderNo', key: 'orderNo', width: 160 },
    {
      title: '商品明细',
      dataIndex: 'items',
      key: 'items',
      render: (items: OrderItem[]) => (
        <div>
          {items?.map((item, idx) => (
            <Tag key={idx} style={{ marginBottom: 4 }}>
              {item.productName} x{item.qty}
            </Tag>
          ))}
        </div>
      ),
    },
    {
      title: '要求时间',
      dataIndex: 'requiredTime',
      key: 'requiredTime',
      width: 160,
      render: (t: string) => dayjs(t).format('MM-DD HH:mm'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: string) => {
        const cfg = statusMap[s] || { color: 'default', text: s };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      render: (v: number) => <PriceText value={v} />,
    },
    {
      title: '毛利',
      dataIndex: 'grossProfit',
      key: 'grossProfit',
      width: 120,
      render: (v: number) => <PriceText value={v} />,
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>订单管理</Title>
      <Table
        columns={columns}
        dataSource={orders}
        rowKey="id"
        loading={loading}
        scroll={{ x: 900 }}
        pagination={{
          current: page,
          total,
          pageSize: 10,
          onChange: setPage,
          showTotal: (t) => `共 ${t} 条`,
        }}
      />
    </div>
  );
};

export default EuOrders;
