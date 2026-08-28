import React, { useEffect, useState, useCallback } from 'react';
import { Row, Col, Card, Button, Typography, List, Tag, message, Alert } from 'antd';
import { apiGet, apiPost } from '../../api';
import StatCard from '../../components/StatCard';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

interface FulfillmentItem {
  productName: string;
  qty: number;
}

interface Fulfillment {
  id: number;
  orderNo: string;
  items: FulfillmentItem[];
  requiredTime: string;
  status: string;
}

interface DashboardData {
  fulfillments: Fulfillment[];
  pendingCount: number;
  preparingCount: number;
  lowStock: { id: number; skuCode: string; name: string; quantity: number; safetyStock: number; unit: string }[];
}

const ExDashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await apiGet<DashboardData>('/ex/dashboard');
      setData(res);
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

  const handleDispatch = async (id: number) => {
    setDispatching(id);
    try {
      await apiPost(`/ex/fulfillments/${id}/dispatch`);
      message.success('拆单成功，工单已创建');
      fetchData();
    } catch (err: unknown) {
      const e = err as { error?: string };
      message.error(e.error || '拆单失败');
    } finally {
      setDispatching(null);
    }
  };

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>履约工作台</Title>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12}>
          <StatCard title="待接单工单" value={data?.pendingCount ?? 0} color="#1890ff" />
        </Col>
        <Col xs={24} sm={12}>
          <StatCard title="制作中工单" value={data?.preparingCount ?? 0} color="#fa8c16" />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col xs={24} lg={16}>
          <Card title="待处理履约单" size="small" loading={loading}>
            <List
              dataSource={data?.fulfillments || []}
              locale={{ emptyText: '暂无待处理订单' }}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button
                      key="dispatch"
                      type="primary"
                      size="small"
                      loading={dispatching === item.id}
                      onClick={() => handleDispatch(item.id)}
                    >
                      拆单
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <span>
                        {item.orderNo}
                        <Tag color="blue" style={{ marginLeft: 8 }}>
                          {dayjs(item.requiredTime).format('MM-DD HH:mm')}
                        </Tag>
                      </span>
                    }
                    description={
                      <div>
                        {item.items?.map((it, idx) => (
                          <Tag key={idx}>{it.productName} x{it.qty}</Tag>
                        ))}
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="库存预警" size="small">
            {data?.lowStock && data.lowStock.length > 0 ? (
              <List
                size="small"
                dataSource={data.lowStock}
                renderItem={(item) => (
                  <List.Item>
                    <Text>{item.name}</Text>
                    <Text type="danger" strong>
                      {item.quantity}{item.unit} / 安全 {item.safetyStock}{item.unit}
                    </Text>
                  </List.Item>
                )}
              />
            ) : (
              <Alert message="库存充足" type="success" showIcon />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default ExDashboard;
