import React, { useEffect, useState, useCallback } from 'react';
import { Button, Typography, Empty } from 'antd';
import { apiGet } from '../../api';
import WorkOrderCard, { WorkOrderData } from '../../components/WorkOrderCard';

const { Title } = Typography;

const FabHistory: React.FC = () => {
  const [orders, setOrders] = useState<WorkOrderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;

  const fetchData = useCallback(async (p: number) => {
    try {
      const res = await apiGet<{ items: WorkOrderData[]; total: number }>(
        `/dexx/fab/history?page=${p}&pageSize=${pageSize}`
      );
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
  }, [page, fetchData]);

  return (
    <div style={{ padding: 12 }}>
      <Title level={5} style={{ marginBottom: 12 }}>历史工单</Title>
      {!loading && orders.length === 0 ? (
        <Empty description="暂无历史记录" style={{ marginTop: 60 }} />
      ) : (
        orders.map((wo) => <WorkOrderCard key={wo.id} workOrder={wo} />)
      )}
      {total > pageSize && (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <Button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            style={{ marginRight: 8 }}
          >
            上一页
          </Button>
          <span style={{ margin: '0 12px' }}>
            {page} / {Math.ceil(total / pageSize)}
          </span>
          <Button
            disabled={page >= Math.ceil(total / pageSize)}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
};

export default FabHistory;
