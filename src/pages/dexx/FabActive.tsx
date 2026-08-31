import React, { useEffect, useState, useCallback } from 'react';
import { Button, message, Typography, Empty, Modal, List } from 'antd';
import { apiGet, apiPost } from '../../api';
import WorkOrderCard, { WorkOrderData } from '../../components/WorkOrderCard';

const { Title, Text } = Typography;

interface ShortageItem {
  skuCode: string;
  name: string;
  required: number;
  available: number;
  unit: string;
}

const FabActive: React.FC = () => {
  const [orders, setOrders] = useState<WorkOrderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<number | null>(null);
  const [shortageModal, setShortageModal] = useState<{ open: boolean; items: ShortageItem[] }>({
    open: false,
    items: [],
  });

  const fetchData = useCallback(async () => {
    try {
      const res = await apiGet<{ items: WorkOrderData[]; total: number }>('/dexx/fab/active');
      setOrders(res.items);
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

  const handleStart = async (id: number) => {
    setActionId(id);
    try {
      await apiPost(`/dexx/fab/work-orders/${id}/start`);
      message.success('开始制作，原料已领用');
      fetchData();
    } catch (err: unknown) {
      const e = err as { code?: number; error?: string; details?: ShortageItem[] };
      if (e.code === 409) {
        setShortageModal({ open: true, items: e.details || [] });
      } else {
        message.error(e.error || '操作失败');
      }
    } finally {
      setActionId(null);
    }
  };

  const handleComplete = async (id: number) => {
    setActionId(id);
    try {
      await apiPost(`/dexx/fab/work-orders/${id}/complete`);
      message.success('出餐完成');
      fetchData();
    } catch (err: unknown) {
      const e = err as { error?: string };
      message.error(e.error || '操作失败');
    } finally {
      setActionId(null);
    }
  };

  const acceptedOrders = orders.filter((o) => o.status === 'accepted' || o.status === 'Accepted' || o.status === 'Dispatched');
  const preparingOrders = orders.filter((o) => o.status === 'preparing' || o.status === 'Running');

  return (
    <div style={{ padding: 12 }}>
      {acceptedOrders.length > 0 && (
        <>
          <Title level={5} style={{ marginBottom: 12 }}>已接单 - 待开始</Title>
          {acceptedOrders.map((wo) => (
            <WorkOrderCard
              key={wo.id}
              workOrder={wo}
              actions={
                <Button
                  type="primary"
                  size="large"
                  loading={actionId === wo.id}
                  onClick={() => handleStart(wo.id)}
                >
                  开始制作
                </Button>
              }
            />
          ))}
        </>
      )}

      {preparingOrders.length > 0 && (
        <>
          <Title level={5} style={{ margin: '16px 0 12px' }}>制作中</Title>
          {preparingOrders.map((wo) => (
            <WorkOrderCard
              key={wo.id}
              workOrder={wo}
              actions={
                <Button
                  type="primary"
                  size="large"
                  style={{ background: '#52c41a', borderColor: '#52c41a' }}
                  loading={actionId === wo.id}
                  onClick={() => handleComplete(wo.id)}
                >
                  完成出餐
                </Button>
              }
            />
          ))}
        </>
      )}

      {!loading && orders.length === 0 && (
        <Empty description="暂无进行中的工单" style={{ marginTop: 60 }} />
      )}

      <Modal
        title="库存不足"
        open={shortageModal.open}
        onCancel={() => setShortageModal({ open: false, items: [] })}
        footer={[
          <Button key="close" onClick={() => setShortageModal({ open: false, items: [] })}>
            知道了
          </Button>,
        ]}
      >
        <Text type="danger">以下原材料库存不足，无法领料：</Text>
        <List
          style={{ marginTop: 12 }}
          dataSource={shortageModal.items}
          renderItem={(item) => (
            <List.Item>
              <Text>{item.name} ({item.skuCode})</Text>
              <Text type="danger">
                需 {item.required}{item.unit} / 现有 {item.available}{item.unit}
              </Text>
            </List.Item>
          )}
        />
      </Modal>
    </div>
  );
};

export default FabActive;
