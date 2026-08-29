import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Typography, Spin, Alert, Button, Space, Tag, Tabs, Table, Badge } from 'antd';
import { ShoppingCartOutlined, InboxOutlined, CarOutlined, CheckCircleOutlined, AppstoreOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { fmtNum } from '../../utils/format';

const { Title, Text } = Typography;

interface OrderTask {
  id: number;
  orderNo: string;
  status: string;
  items: { name: string; qty: number }[];
  createdAt: string;
}

interface InventoryItem {
  id: number;
  skuId: number;
  qtyOnHand: number;
  warehouseType: string;
  sku?: { name: string; salePrice: number };
}

interface DxxStats {
  pendingOrders: number;
  pickingOrders: number;
  packingOrders: number;
  deliveringOrders: number;
  lowStockItems: number;
  pendingReceiving: number;
}

const DxxDashboard: React.FC = () => {
  const [stats, setStats] = useState<DxxStats | null>(null);
  const [orders, setOrders] = useState<OrderTask[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [ordersRes, inventoryRes] = await Promise.all([
          api.get<{ items: OrderTask[]; total: number }>('/du/orders?pageSize=20'),
          api.get<{ items: InventoryItem[]; lowStockCount: number }>('/du/inventory?pageSize=1'),
        ]);

        const items = ordersRes.items || [];
        setOrders(items);
        setStats({
          pendingOrders: items.filter(o => o.status === 'pending').length,
          pickingOrders: items.filter(o => o.status === 'picking').length,
          packingOrders: items.filter(o => o.status === 'packing').length,
          deliveringOrders: items.filter(o => o.status === 'delivering').length,
          lowStockItems: inventoryRes.lowStockCount || 0,
          pendingReceiving: 0, // Would need purchase orders endpoint
        });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  const statusColors: Record<string, string> = {
    pending: 'orange',
    picking: 'blue',
    packing: 'cyan',
    delivering: 'purple',
    delivered: 'green',
  };

  const orderColumns = [
    { title: '订单号', dataIndex: 'orderNo', key: 'orderNo' },
    { 
      title: '状态', 
      dataIndex: 'status', 
      key: 'status',
      render: (status: string) => <Tag color={statusColors[status] || 'default'}>{status}</Tag>
    },
    { 
      title: '商品', 
      dataIndex: 'items', 
      key: 'items',
      render: (items: { name: string; qty: number }[]) => items?.slice(0, 2).map(i => `${i.name}×${i.qty}`).join(', ') || '-'
    },
    { 
      title: '操作', 
      key: 'action',
      render: (_: unknown, record: OrderTask) => (
        <Space>
          {record.status === 'pending' && <Button size="small" type="link" onClick={() => navigate(`/dxx/fulfillment/${record.id}/pick`)}>拣货</Button>}
          {record.status === 'picking' && <Button size="small" type="link" onClick={() => navigate(`/dxx/fulfillment/${record.id}/pack`)}>打包</Button>}
          {record.status === 'packing' && <Button size="small" type="link" onClick={() => navigate(`/dxx/fulfillment/${record.id}/deliver`)}>交付</Button>}
        </Space>
      )
    },
  ];

  const tabItems = [
    {
      key: 'fulfillment',
      label: <span><ShoppingCartOutlined /> 接单履约</span>,
      children: (
        <div>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} sm={6}>
              <Card size="small">
                <Statistic title="待接单" value={stats?.pendingOrders || 0} valueStyle={{ color: '#faad14' }} formatter={(v) => fmtNum(Number(v))} />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card size="small">
                <Statistic title="待拣货" value={stats?.pickingOrders || 0} valueStyle={{ color: '#1890ff' }} formatter={(v) => fmtNum(Number(v))} />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card size="small">
                <Statistic title="待打包" value={stats?.packingOrders || 0} valueStyle={{ color: '#13c2c2' }} formatter={(v) => fmtNum(Number(v))} />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card size="small">
                <Statistic title="待交付" value={stats?.deliveringOrders || 0} valueStyle={{ color: '#722ed1' }} formatter={(v) => fmtNum(Number(v))} />
              </Card>
            </Col>
          </Row>
          <Table 
            dataSource={orders} 
            columns={orderColumns} 
            rowKey="id" 
            size="small"
            pagination={{ pageSize: 10 }}
          />
        </div>
      ),
    },
    {
      key: 'products',
      label: <span><AppstoreOutlined /> 货品维护</span>,
      children: (
        <div>
          <Alert
            message="货品维护"
            description="维护商品信息和售价。采购价和毛利字段已隐藏（您只能看到售价）。"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Space>
            <Button type="primary" onClick={() => navigate('/du/boms')}>商品/BOM 管理</Button>
            <Button onClick={() => navigate('/du/inventory')}>库存查看</Button>
          </Space>
        </div>
      ),
    },
    {
      key: 'receiving',
      label: <span><InboxOutlined /> 来料收货</span>,
      children: (
        <div>
          <Alert
            message="来料收货"
            description="接收采购到货商品，登记入库。选择目标仓库（物料/设备/杂货/场地）。"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Space>
            <Button type="primary" onClick={() => navigate('/du/purchase-orders')}>采购单列表</Button>
            <Button onClick={() => navigate('/dexx/wh/inbound')}>入库登记</Button>
          </Space>
          <Card size="small" style={{ marginTop: 16 }}>
            <Statistic title="待收货" value={stats?.pendingReceiving || 0} prefix={<InboxOutlined />} formatter={(v) => fmtNum(Number(v))} />
          </Card>
        </div>
      ),
    },
    {
      key: 'delivery',
      label: <span><CheckCircleOutlined /> 现场交付</span>,
      children: (
        <div>
          <Alert
            message="现场交付"
            description="确认订单交付，登记签收信息。"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12}>
              <Card
                title="配送任务"
                extra={<Badge count={stats?.deliveringOrders || 0} />}
                hoverable
                onClick={() => navigate('/dexx/dl')}
              >
                <Text type="secondary">查看待配送任务，执行配送</Text>
              </Card>
            </Col>
            <Col xs={24} sm={12}>
              <Card
                title="服务任务"
                hoverable
                onClick={() => navigate('/dexx/svc')}
              >
                <Text type="secondary">查看待服务任务，执行服务</Text>
              </Card>
            </Col>
          </Row>
        </div>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>供给一线执行台</Title>
      <Alert
        message="供给一线执行"
        description="您是一线执行人员，负责接单履约、货品维护、来料收货和现场交付。"
        type="success"
        showIcon
        style={{ marginBottom: 24 }}
      />
      
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic title="今日订单" value={stats?.pendingOrders || 0} prefix={<ShoppingCartOutlined />} formatter={(v) => fmtNum(Number(v))} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic title="库存预警" value={stats?.lowStockItems || 0} valueStyle={{ color: (stats?.lowStockItems || 0) > 0 ? '#cf1322' : undefined }} />
          </Card>
        </Col>
      </Row>

      <Card>
        <Tabs items={tabItems} defaultActiveKey="fulfillment" />
      </Card>
    </div>
  );
};

export default DxxDashboard;
