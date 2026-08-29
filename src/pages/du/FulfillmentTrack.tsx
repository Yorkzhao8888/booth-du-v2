import React, { useState, useEffect, useCallback } from 'react';
import { Table, Card, Button, Tag, Space, message, Drawer, Timeline, Descriptions, Empty } from 'antd';
import { ReloadOutlined, NodeIndexOutlined, CheckCircleOutlined, ClockCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { api } from '../../api';

interface TrackNode {
  domain: string;
  nodeId?: number;
  productName?: string;
  status: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

interface TrackData {
  orderId: number;
  orderNo: string;
  status: string;
  trackNodes: TrackNode[];
}

interface Order {
  id: number;
  shop_order_id: string;
  status: string;
  items: any[];
  created_at: string;
}

const domainLabels: Record<string, string> = {
  ORDER: '订单',
  FAB: '制造',
  DL: '配送',
  SVC: '服务',
};

const domainColors: Record<string, string> = {
  ORDER: 'blue',
  FAB: 'orange',
  DL: 'green',
  SVC: 'purple',
};

const statusLabels: Record<string, { text: string; color: string }> = {
  pending: { text: '待处理', color: 'default' },
  in_progress: { text: '进行中', color: 'processing' },
  completed: { text: '已完成', color: 'success' },
  cancelled: { text: '已取消', color: 'error' },
  delivered: { text: '已交付', color: 'success' },
  signed: { text: '已签收', color: 'success' },
};

const FulfillmentTrack: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<TrackData | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [trackLoading, setTrackLoading] = useState(false);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<any>('/du/fulfillments?status=all&page=1&pageSize=50');
      setOrders(res?.items || []);
    } catch {
      message.error('加载订单列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const handleTrack = async (orderId: number) => {
    setTrackLoading(true);
    setDrawerVisible(true);
    try {
      const res = await api.get<any>(`/du/supply/orders/${orderId}/track`);
      setSelectedOrder(res);
    } catch {
      message.error('加载履约追踪失败');
    } finally {
      setTrackLoading(false);
    }
  };

  const getNodeStatus = (node: TrackNode) => {
    const info = statusLabels[node.status] || { text: node.status, color: 'default' };
    return info;
  };

  const columns = [
    {
      title: '订单号',
      dataIndex: 'shop_order_id',
      key: 'shop_order_id',
      width: 160,
    },
    {
      title: '商品数',
      key: 'item_count',
      width: 100,
      render: (_: unknown, record: Order) => {
        try {
          const items = typeof record.items === 'string' ? JSON.parse(record.items) : record.items;
          return Array.isArray(items) ? items.length : 0;
        } catch { return 0; }
      },
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
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: unknown, record: Order) => (
        <Button type="link" icon={<NodeIndexOutlined />} onClick={() => handleTrack(record.id)}>
          履约追踪
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card
        title={
          <Space>
            <NodeIndexOutlined />
            <span>履约追踪</span>
          </Space>
        }
        extra={
          <Button icon={<ReloadOutlined />} onClick={fetchOrders}>刷新</Button>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={orders}
          loading={loading}
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: '暂无订单' }}
        />
      </Card>

      <Drawer
        title={selectedOrder ? `履约追踪 - ${selectedOrder.orderNo}` : '履约追踪'}
        open={drawerVisible}
        onClose={() => { setDrawerVisible(false); setSelectedOrder(null); }}
        width={600}
      >
        {trackLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <SyncOutlined spin style={{ fontSize: 32, color: '#1677ff' }} />
            <p style={{ marginTop: 16 }}>加载履约链路...</p>
          </div>
        ) : selectedOrder ? (
          <div>
            <Descriptions bordered column={1} size="small" style={{ marginBottom: 24 }}>
              <Descriptions.Item label="订单号">{selectedOrder.orderNo}</Descriptions.Item>
              <Descriptions.Item label="订单状态">
                <Tag color={(statusLabels[selectedOrder.status] || { color: 'default' }).color}>
                  {(statusLabels[selectedOrder.status] || { text: selectedOrder.status }).text}
                </Tag>
              </Descriptions.Item>
            </Descriptions>

            {selectedOrder.trackNodes.length > 0 ? (
              <Timeline
                items={selectedOrder.trackNodes.map(node => {
                  const statusInfo = getNodeStatus(node);
                  const isCompleted = !!node.completedAt;
                  const isStarted = !!node.startedAt;
                  
                  return {
                    color: isCompleted ? 'green' : isStarted ? 'blue' : 'gray',
                    dot: isCompleted 
                      ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                      : isStarted 
                      ? <ClockCircleOutlined style={{ color: '#1677ff' }} />
                      : undefined,
                    children: (
                      <div>
                        <Space>
                          <Tag color={domainColors[node.domain] || 'default'}>
                            {domainLabels[node.domain] || node.domain}
                          </Tag>
                          <Tag color={statusInfo.color}>{statusInfo.text}</Tag>
                          {node.productName && <span>{node.productName}</span>}
                        </Space>
                        <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                          {node.createdAt && <span>创建: {new Date(node.createdAt).toLocaleString('zh-CN')}</span>}
                          {node.startedAt && <span> | 开始: {new Date(node.startedAt).toLocaleString('zh-CN')}</span>}
                          {node.completedAt && <span> | 完成: {new Date(node.completedAt).toLocaleString('zh-CN')}</span>}
                        </div>
                      </div>
                    ),
                  };
                })}
              />
            ) : (
              <Empty description="暂无履约节点" />
            )}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
};

export default FulfillmentTrack;
