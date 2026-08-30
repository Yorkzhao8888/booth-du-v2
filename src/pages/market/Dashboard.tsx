import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, Card, Button, Tag, Space, message, Modal, Form, Input, InputNumber,
  Select, Statistic, Row, Col, Tabs, Popconfirm, Drawer, Descriptions
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, ShoppingOutlined, CheckCircleOutlined,
  CloseCircleOutlined, EditOutlined, DeleteOutlined, EyeOutlined
} from '@ant-design/icons';
import { api } from '../../api';
import { useAuthStore } from '../../store';

const { TextArea } = Input;
const { Option } = Select;

// 商品状态配置
const productStatusConfig: Record<string, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  active: { text: '上架中', color: 'success' },
  inactive: { text: '已下架', color: 'warning' },
  sold_out: { text: '售罄', color: 'error' },
};

// 订单状态配置
const orderStatusConfig: Record<string, { text: string; color: string }> = {
  pending: { text: '待处理', color: 'processing' },
  confirmed: { text: '已确认', color: 'cyan' },
  fulfilling: { text: '履约中', color: 'blue' },
  completed: { text: '已完成', color: 'success' },
  cancelled: { text: '已取消', color: 'error' },
};

// 准入状态配置
const admissionStatusConfig: Record<string, { text: string; color: string }> = {
  pending: { text: '待审核', color: 'processing' },
  approved: { text: '已准入', color: 'success' },
  rejected: { text: '已驳回', color: 'error' },
  exited: { text: '已退出', color: 'default' },
};

interface Product {
  id: number;
  product_name: string;
  product_code: string;
  specification: string;
  unit: string;
  unit_price: number;
  stock_qty: number;
  supplier_name: string;
  status: string;
  description: string;
  created_at: string;
}

interface Order {
  id: number;
  order_no: string;
  customer_name: string;
  customer_phone: string;
  items: any[];
  total_amount: number;
  status: string;
  created_at: string;
}

interface Admission {
  id: number;
  supplier_name: string;
  contact_person: string;
  contact_phone: string;
  business_license: string;
  category: string;
  region: string;
  status: string;
  review_remark: string;
  created_at: string;
}

interface OverviewStats {
  products: { status: string; count: string }[];
  admissions: { status: string; count: string }[];
  orders: { status: string; count: string; total_amount: string }[];
}

const MarketDashboard: React.FC = () => {
  const { user } = useAuthStore();
  const role = user?.role || '';
  const isEM = role === 'em';
  const canSeePrice = ['em', 'dm', 'du', 'dx'].includes(role);
  const canEdit = isEM;

  const [activeTab, setActiveTab] = useState('products');
  const [stats, setStats] = useState<OverviewStats | null>(null);

  // 商品管理
  const [products, setProducts] = useState<Product[]>([]);
  const [productLoading, setProductLoading] = useState(false);
  const [productModalVisible, setProductModalVisible] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productForm] = Form.useForm();

  // 订单管理
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderLoading, setOrderLoading] = useState(false);

  // 准入管理
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [admissionLoading, setAdmissionLoading] = useState(false);
  const [admissionModalVisible, setAdmissionModalVisible] = useState(false);
  const [admissionForm] = Form.useForm();

  // 详情
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);

  // 获取统计
  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get<any>('/market/overview/stats');
      setStats(res);
    } catch { /* ignore */ }
  }, []);

  // 获取商品列表
  const fetchProducts = useCallback(async () => {
    setProductLoading(true);
    try {
      const res = await api.get<any>('/market/products');
      setProducts(res?.items || []);
    } catch {
      message.error('加载商品列表失败');
    } finally {
      setProductLoading(false);
    }
  }, []);

  // 获取订单列表
  const fetchOrders = useCallback(async () => {
    setOrderLoading(true);
    try {
      const res = await api.get<any>('/market/orders');
      setOrders(res?.items || []);
    } catch {
      message.error('加载订单列表失败');
    } finally {
      setOrderLoading(false);
    }
  }, []);

  // 获取准入列表
  const fetchAdmissions = useCallback(async () => {
    setAdmissionLoading(true);
    try {
      const res = await api.get<any>('/market/supplier-admissions');
      setAdmissions(res?.items || []);
    } catch {
      message.error('加载准入列表失败');
    } finally {
      setAdmissionLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchProducts();
    fetchOrders();
    fetchAdmissions();
  }, [fetchStats, fetchProducts, fetchOrders, fetchAdmissions]);

  // 创建/编辑商品
  const handleSaveProduct = async (values: any) => {
    try {
      if (editingProduct) {
        await api.put(`/market/products/${editingProduct.id}`, values);
        message.success('商品更新成功');
      } else {
        await api.post('/market/products', values);
        message.success('商品创建成功');
      }
      setProductModalVisible(false);
      setEditingProduct(null);
      productForm.resetFields();
      fetchProducts();
      fetchStats();
    } catch (err: any) {
      message.error(err.message || '操作失败');
    }
  };

  // 上架/下架商品
  const handleToggleProduct = async (id: number, action: 'activate' | 'deactivate') => {
    try {
      await api.post(`/market/products/${id}/toggle`, { action });
      message.success(action === 'activate' ? '上架成功' : '下架成功');
      fetchProducts();
      fetchStats();
    } catch (err: any) {
      message.error(err.message || '操作失败');
    }
  };

  // 删除商品
  const handleDeleteProduct = async (id: number) => {
    try {
      await api.delete(`/market/products/${id}`);
      message.success('删除成功');
      fetchProducts();
    } catch (err: any) {
      message.error(err.message || '删除失败');
    }
  };

  // 创建准入申请
  const handleSaveAdmission = async (values: any) => {
    try {
      await api.post('/market/supplier-admissions', values);
      message.success('准入申请提交成功');
      setAdmissionModalVisible(false);
      admissionForm.resetFields();
      fetchAdmissions();
      fetchStats();
    } catch (err: any) {
      message.error(err.message || '提交失败');
    }
  };

  // 审核准入
  const handleReviewAdmission = async (id: number, status: 'approved' | 'rejected') => {
    try {
      await api.post(`/market/supplier-admissions/${id}/review`, { status });
      message.success(status === 'approved' ? '准入成功' : '已驳回');
      fetchAdmissions();
      fetchStats();
    } catch (err: any) {
      message.error(err.message || '操作失败');
    }
  };

  // 更新订单状态
  const handleUpdateOrderStatus = async (id: number, status: string) => {
    try {
      await api.post(`/market/orders/${id}/status`, { status });
      message.success('状态更新成功');
      fetchOrders();
      fetchStats();
    } catch (err: any) {
      message.error(err.message || '操作失败');
    }
  };

  // 统计卡片数据
  const getStatCounts = () => {
    if (!stats) return { activeProducts: 0, pendingAdmissions: 0, pendingOrders: 0, totalRevenue: 0 };
    const activeProducts = stats.products.find(p => p.status === 'active');
    const pendingAdmissions = stats.admissions.find(a => a.status === 'pending');
    const pendingOrders = stats.orders.find(o => o.status === 'pending');
    const completedOrders = stats.orders.filter(o => o.status === 'completed');
    const totalRevenue = completedOrders.reduce((sum, o) => sum + parseFloat(o.total_amount || '0'), 0);
    return {
      activeProducts: parseInt(activeProducts?.count || '0'),
      pendingAdmissions: parseInt(pendingAdmissions?.count || '0'),
      pendingOrders: parseInt(pendingOrders?.count || '0'),
      totalRevenue,
    };
  };

  const statCounts = getStatCounts();

  // 商品表格列
  const productColumns = [
    { title: '商品编码', dataIndex: 'product_code', width: 120, render: (v: string) => v || '-' },
    { title: '商品名称', dataIndex: 'product_name', width: 150 },
    { title: '规格', dataIndex: 'specification', width: 100, render: (v: string) => v || '-' },
    { title: '单位', dataIndex: 'unit', width: 60 },
    canSeePrice ? { title: '单价', dataIndex: 'unit_price', width: 100, render: (v: number) => `¥${v?.toFixed(2)}` } : null,
    { title: '库存', dataIndex: 'stock_qty', width: 80, render: (v: number) => v?.toFixed(2) },
    { title: '供应商', dataIndex: 'supplier_name', width: 120, render: (v: string) => v || '-' },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (s: string) => <Tag color={productStatusConfig[s]?.color}>{productStatusConfig[s]?.text || s}</Tag>,
    },
    {
      title: '操作', width: 180, fixed: 'right' as const,
      render: (_: any, record: Product) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />}
            onClick={() => { setDetailProduct(record); setDetailVisible(true); }} />
          {canEdit && (
            <>
              <Button type="link" size="small" icon={<EditOutlined />}
                onClick={() => {
                  setEditingProduct(record);
                  productForm.setFieldsValue(record);
                  setProductModalVisible(true);
                }} />
              {record.status === 'draft' && (
                <Popconfirm title="确定删除？" onConfirm={() => handleDeleteProduct(record.id)}>
                  <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              )}
              {record.status === 'draft' || record.status === 'inactive' ? (
                <Button type="link" size="small" onClick={() => handleToggleProduct(record.id, 'activate')}>上架</Button>
              ) : record.status === 'active' ? (
                <Button type="link" size="small" onClick={() => handleToggleProduct(record.id, 'deactivate')}>下架</Button>
              ) : null}
            </>
          )}
        </Space>
      ),
    },
  ].filter(Boolean);

  // 订单表格列
  const orderColumns = [
    { title: '订单号', dataIndex: 'order_no', width: 140 },
    { title: '客户', dataIndex: 'customer_name', width: 100, render: (v: string) => v || '-' },
    { title: '电话', dataIndex: 'customer_phone', width: 120, render: (v: string) => v || '-' },
    canSeePrice ? { title: '金额', dataIndex: 'total_amount', width: 100, render: (v: number) => `¥${v?.toFixed(2)}` } : null,
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (s: string) => <Tag color={orderStatusConfig[s]?.color}>{orderStatusConfig[s]?.text || s}</Tag>,
    },
    { title: '下单时间', dataIndex: 'created_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    {
      title: '操作', width: 150,
      render: (_: any, record: Order) => (
        <Space size="small">
          {record.status === 'pending' && (
            <Button type="link" size="small" onClick={() => handleUpdateOrderStatus(record.id, 'confirmed')}>确认</Button>
          )}
          {record.status === 'confirmed' && (
            <Button type="link" size="small" onClick={() => handleUpdateOrderStatus(record.id, 'fulfilling')}>开始履约</Button>
          )}
          {record.status === 'fulfilling' && (
            <Button type="link" size="small" onClick={() => handleUpdateOrderStatus(record.id, 'completed')}>完成</Button>
          )}
          {['pending', 'confirmed'].includes(record.status) && (
            <Popconfirm title="确定取消？" onConfirm={() => handleUpdateOrderStatus(record.id, 'cancelled')}>
              <Button type="link" size="small" danger>取消</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ].filter(Boolean);

  // 准入表格列
  const admissionColumns = [
    { title: '供应商名称', dataIndex: 'supplier_name', width: 150 },
    { title: '联系人', dataIndex: 'contact_person', width: 100, render: (v: string) => v || '-' },
    { title: '电话', dataIndex: 'contact_phone', width: 120, render: (v: string) => v || '-' },
    { title: '类别', dataIndex: 'category', width: 100, render: (v: string) => v || '-' },
    { title: '区域', dataIndex: 'region', width: 100, render: (v: string) => v || '-' },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (s: string) => <Tag color={admissionStatusConfig[s]?.color}>{admissionStatusConfig[s]?.text || s}</Tag>,
    },
    {
      title: '操作', width: 150,
      render: (_: any, record: Admission) => (
        <Space size="small">
          {record.status === 'pending' && isEM && (
            <>
              <Button type="link" size="small" icon={<CheckCircleOutlined />}
                onClick={() => handleReviewAdmission(record.id, 'approved')}>准入</Button>
              <Popconfirm title="确定驳回？" onConfirm={() => handleReviewAdmission(record.id, 'rejected')}>
                <Button type="link" size="small" danger icon={<CloseCircleOutlined />}>驳回</Button>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic title="上架商品" value={statCounts.activeProducts} prefix={<ShoppingOutlined />} suffix="件" />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="待审核准入" value={statCounts.pendingAdmissions} valueStyle={{ color: '#1890ff' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="待处理订单" value={statCounts.pendingOrders} valueStyle={{ color: '#faad14' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            {canSeePrice ? (
              <Statistic title="累计营收" value={statCounts.totalRevenue} precision={2} prefix="¥" valueStyle={{ color: '#52c41a' }} />
            ) : (
              <Statistic title="累计营收" value="****" valueStyle={{ color: '#999' }} />
            )}
          </Card>
        </Col>
      </Row>

      {/* 主内容区 */}
      <Card>
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
          {
            key: 'products',
            label: '通货商品',
            children: (
              <>
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 16, fontWeight: 500 }}>商品列表</span>
                  <Space>
                    <Button icon={<ReloadOutlined />} onClick={fetchProducts}>刷新</Button>
                    {canEdit && (
                      <Button type="primary" icon={<PlusOutlined />} onClick={() => {
                        setEditingProduct(null);
                        productForm.resetFields();
                        setProductModalVisible(true);
                      }}>
                        新增商品
                      </Button>
                    )}
                  </Space>
                </div>
                <Table
                  rowKey="id"
                  columns={productColumns}
                  dataSource={products}
                  loading={productLoading}
                  pagination={{ pageSize: 20 }}
                  scroll={{ x: 1100 }}
                  size="middle"
                />
              </>
            ),
          },
          {
            key: 'orders',
            label: '订单管理',
            children: (
              <>
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 16, fontWeight: 500 }}>订单列表</span>
                  <Button icon={<ReloadOutlined />} onClick={fetchOrders}>刷新</Button>
                </div>
                <Table
                  rowKey="id"
                  columns={orderColumns}
                  dataSource={orders}
                  loading={orderLoading}
                  pagination={{ pageSize: 20 }}
                  scroll={{ x: 900 }}
                  size="middle"
                />
              </>
            ),
          },
          {
            key: 'admissions',
            label: '供应商准入',
            children: (
              <>
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 16, fontWeight: 500 }}>准入申请列表</span>
                  <Space>
                    <Button icon={<ReloadOutlined />} onClick={fetchAdmissions}>刷新</Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => {
                      admissionForm.resetFields();
                      setAdmissionModalVisible(true);
                    }}>
                      提交准入申请
                    </Button>
                  </Space>
                </div>
                <Table
                  rowKey="id"
                  columns={admissionColumns}
                  dataSource={admissions}
                  loading={admissionLoading}
                  pagination={{ pageSize: 20 }}
                  scroll={{ x: 900 }}
                  size="middle"
                />
              </>
            ),
          },
        ]} />
      </Card>

      {/* 商品创建/编辑 Modal */}
      <Modal
        title={editingProduct ? '编辑商品' : '新增商品'}
        open={productModalVisible}
        onCancel={() => { setProductModalVisible(false); setEditingProduct(null); productForm.resetFields(); }}
        footer={null}
        width={600}
      >
        <Form form={productForm} layout="vertical" onFinish={handleSaveProduct}>
          <Form.Item name="product_name" label="商品名称" rules={[{ required: true, message: '请输入商品名称' }]}>
            <Input placeholder="请输入商品名称" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="product_code" label="商品编码">
                <Input placeholder="商品编码" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="specification" label="规格">
                <Input placeholder="规格" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="unit" label="单位" initialValue="件">
                <Select>
                  <Option value="件">件</Option>
                  <Option value="kg">kg</Option>
                  <Option value="箱">箱</Option>
                  <Option value="个">个</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="unit_price" label="单价" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={0} precision={2} prefix="¥" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="stock_qty" label="库存" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={0} precision={2} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="supplier_name" label="供应商">
            <Input placeholder="供应商名称" />
          </Form.Item>
          <Form.Item name="description" label="商品描述">
            <TextArea rows={3} placeholder="商品描述" />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => { setProductModalVisible(false); setEditingProduct(null); }}>取消</Button>
              <Button type="primary" htmlType="submit">{editingProduct ? '更新' : '创建'}</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 准入申请 Modal */}
      <Modal
        title="提交准入申请"
        open={admissionModalVisible}
        onCancel={() => { setAdmissionModalVisible(false); admissionForm.resetFields(); }}
        footer={null}
        width={500}
      >
        <Form form={admissionForm} layout="vertical" onFinish={handleSaveAdmission}>
          <Form.Item name="supplier_name" label="供应商名称" rules={[{ required: true }]}>
            <Input placeholder="供应商名称" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="contact_person" label="联系人">
                <Input placeholder="联系人" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contact_phone" label="联系电话">
                <Input placeholder="联系电话" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="category" label="供应类别">
                <Input placeholder="供应类别" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="region" label="区域">
                <Input placeholder="区域" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="business_license" label="营业执照号">
            <Input placeholder="营业执照号" />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => setAdmissionModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit">提交</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 商品详情 Drawer */}
      <Drawer
        title="商品详情"
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        width={400}
      >
        {detailProduct && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="商品编码">{detailProduct.product_code || '-'}</Descriptions.Item>
            <Descriptions.Item label="商品名称">{detailProduct.product_name}</Descriptions.Item>
            <Descriptions.Item label="规格">{detailProduct.specification || '-'}</Descriptions.Item>
            <Descriptions.Item label="单位">{detailProduct.unit}</Descriptions.Item>
            {canSeePrice && (
              <Descriptions.Item label="单价">¥{detailProduct.unit_price?.toFixed(2)}</Descriptions.Item>
            )}
            <Descriptions.Item label="库存">{detailProduct.stock_qty?.toFixed(2)}</Descriptions.Item>
            <Descriptions.Item label="供应商">{detailProduct.supplier_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={productStatusConfig[detailProduct.status]?.color}>
                {productStatusConfig[detailProduct.status]?.text || detailProduct.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="描述">{detailProduct.description || '-'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{new Date(detailProduct.created_at).toLocaleString()}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
};

export default MarketDashboard;
