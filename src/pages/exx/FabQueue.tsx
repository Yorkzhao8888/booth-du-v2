import React, { useEffect, useState, useCallback } from 'react';
import { Button, message, Typography, Empty } from 'antd';
import { apiGet, apiPost } from '../../api';
import WorkOrderCard, { WorkOrderData } from '../../components/WorkOrderCard';

const { Title } = Typography;

const FabQueue: React.FC = () => {
  const [orders, setOrders] = useState<WorkOrderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await apiGet<WorkOrderData[]>('/exx/fab/queue');
      setOrders(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const handler = () => fetchData();
    window.addEventListener('booth:refresh', handler);
    return () => window.removeEventListener('booth:refresh', handler);
  }, [fetchData]);

  const handleAccept = async (id: number) => {
    setAccepting(id);
    try {
      await apiPost(`/exx/fab/work-orders/${id}/accept`);
      message.success('接单成功');
      fetchData();
    } catch (err: unknown) {
      const e = err as { error?: string };
      message.error(e.error || '接单失败');
    } finally {
      setAccepting(null);
    }
  };

  return (
    <div style={{ padding: 12 }}>
      <Title level={5} style={{ marginBottom: 12 }}>待接单</Title>
      {!loading && orders.length === 0 ? (
        <Empty description="暂无待接单工单" style={{ marginTop: 60 }} />
      ) : (
        orders.map((wo) => (
          <WorkOrderCard
            key={wo.id}
            workOrder={wo}
            actions={
              <Button
                type="primary"
                size="large"
                loading={accepting === wo.id}
                onClick={() => handleAccept(wo.id)}
              >
                接单
              </Button>
            }
          />
        ))
      )}
    </div>
  );
};

export default FabQueue;
