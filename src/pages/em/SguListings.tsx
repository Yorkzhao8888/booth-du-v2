import { useEffect, useState } from 'react';
import { Card, Table, Button, Tag, Space, message, Tooltip, Popconfirm, Row, Col, Statistic, Badge, Modal, Select } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, PlusOutlined, ShopOutlined, EditOutlined, GlobalOutlined, EyeInvisibleOutlined, CheckCircleOutlined, ClockCircleOutlined, StopOutlined } from '@ant-design/icons';
import { api } from '../../api';

interface SguListing {
  id: number; listing_no: string; sgu_id: number; status: string; market_visible: boolean;
  listed_at: string | null; delisted_at: string | null;
  sgu_no: string; booth_type: string; sku_code: string; sku_name: string; unit: string;
  unit_price: number;
}

interface SguCatalog { id: number; sgu_no: string; sku_code: string; sku_name: string; booth_type: string; }

const statusMap: Record<string, { color: string; label: string; icon: React.ReactNode; desc: string }> = {
  pending: { color: 'default', label: '待上架', icon: <ClockCircleOutlined />, desc: '已创建，等待上架到 Market' },
  listed: { color: 'success', label: '已挂牌', icon: <CheckCircleOutlined />, desc: 'Market 可检索，对外可见' },
  delisted: { color: 'error', label: '已下架', icon: <StopOutlined />, desc: '已从 Market 下架，不可检索' },
  suspended: { color: 'warning', label: '已暂停', icon: <StopOutlined />, desc: '暂停挂牌，Market 不可见' },
};

// Monospace font style for numbers
const monoStyle: React.CSSProperties = {
  fontFamily: "'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace",
  fontVariantNumeric: 'tabular-nums',
};

export default function EmSguListings() {
  const [data, setData] = useState<SguListing[]>([]);
  const [sgus, setSgus] = useState<SguCatalog[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedSguId, setSelectedSguId] = useState<number | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [listRes, sguRes] = await Promise.all([
        api.get('/em/sgu/listings'),
        api.get('/em/sgu/catalog'),
      ]);
      setData(listRes.data?.data || []);
      setSgus(sguRes.data?.data || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleList = async (id: number) => {
    await api.put(`/em/sgu/listings/${id}/list`);
    message.success('挂牌成功，Market 即时可见');
    fetchData();
  };

  const handleDelist = async (id: number) => {
    await api.put(`/em/sgu/listings/${id}/delist`);
    message.success('已下架，Market 即时不可见');
    fetchData();
  };

  const handleCreate = async () => {
    if (!selectedSguId) {
      message.warning('请选择 SGU');
      return;
    }
    await api.post('/em/sgu/listings', { sguId: selectedSguId });
    message.success('挂牌创建成功');
    setCreateModalOpen(false);
    setSelectedSguId(null);
    fetchData();
  };

  // Statistics
  const totalListings = data.length;
  const listedCount = data.filter(d => d.status === 'listed').length;
  const pendingCount = data.filter(d => d.status === 'pending').length;
  const delistedCount = data.filter(d => d.status === 'delisted').length;

  const columns = [
    {
      title: '挂牌编号',
      dataIndex: 'listing_no',
      width: 130,
      render: (v: string) => <span style={{ ...monoStyle, fontWeight: 500, color: '#1f3a5f' }}>{v}</span>,
    },
    {
      title: 'SGU编号',
      dataIndex: 'sgu_no',
      width: 120,
      render: (v: string) => <span style={monoStyle}>{v}</span>,
    },
    {
      title: 'SKU',
      dataIndex: 'sku_code',
      width: 90,
      render: (v: string) => <span style={monoStyle}>{v}</span>,
    },
    {
      title: '商品名称',
      dataIndex: 'sku_name',
      width: 130,
      ellipsis: true,
    },
    {
      title: '铺类型',
      dataIndex: 'booth_type',
      width: 80,
      render: (v: string) => {
        const map: Record<string, { label: string; color: string }> = {
          sundry: { label: '杂货', color: '#8c8c8c' },
          material: { label: '原料', color: '#16a37b' },
          device: { label: '设备', color: '#2f6bff' },
          plaza: { label: '场地', color: '#c9a227' },
        };
        const info = map[v] || { label: v, color: '#8c8c8c' };
        return <Tag color={info.color}>{info.label}</Tag>;
      },
    },
    {
      title: 'Market 可见性',
      dataIndex: 'market_visible',
      width: 120,
      align: 'center' as const,
      render: (v: boolean, record: SguListing) => {
        if (v && record.status === 'listed') {
          return (
            <Badge status="success" text={<span style={{ color: '#16a37b', fontSize: 12 }}>可见</span>} />
          );
        }
        return (
          <Badge status="default" text={<span style={{ color: '#8c8c8c', fontSize: 12 }}>不可见</span>} />
        );
      },
    },
    {
      title: '挂牌状态',
      dataIndex: 'status',
      width: 140,
      render: (v: string) => {
        const s = statusMap[v] || { color: 'default', label: v, icon: null, desc: '' };
        return (
          <Tooltip title={s.desc}>
            <Tag color={s.color} icon={s.icon} style={{ minWidth: 80, textAlign: 'center' }}>
              {s.label}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '上架时间',
      dataIndex: 'listed_at',
      width: 150,
      render: (v: string | null) => v ? (
        <span style={monoStyle}>{new Date(v).toLocaleString('zh-CN')}</span>
      ) : <span style={{ color: '#bfbfbf' }}>-</span>,
    },
    {
      title: '下架时间',
      dataIndex: 'delisted_at',
      width: 150,
      render: (v: string | null) => v ? (
        <span style={monoStyle}>{new Date(v).toLocaleString('zh-CN')}</span>
      ) : <span style={{ color: '#bfbfbf' }}>-</span>,
    },
    {
      title: '操作',
      width: 180,
      fixed: 'right' as const,
      render: (_: unknown, record: SguListing) => (
        <Space size="small">
          {record.status === 'pending' && (
            <Tooltip title="挂牌到 Market，对外可见">
              <Button
                type="link"
                size="small"
                icon={<ArrowUpOutlined />}
                onClick={() => handleList(record.id)}
                style={{ color: '#16a37b' }}
              >
                挂牌
              </Button>
            </Tooltip>
          )}
          {record.status === 'listed' && (
            <Popconfirm
              title="确认下架？"
              description="下架后 Market 将即时不可见此条目，无法检索。"
              onConfirm={() => handleDelist(record.id)}
              okText="确认下架"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Tooltip title="从 Market 下架，即时不可见">
                <Button type="link" size="small" danger icon={<ArrowDownOutlined />}>
                  下架
                </Button>
              </Tooltip>
            </Popconfirm>
          )}
          {(record.status === 'delisted' || record.status === 'suspended') && (
            <Tooltip title="重新挂牌到 Market">
              <Button
                type="link"
                size="small"
                icon={<ArrowUpOutlined />}
                onClick={() => handleList(record.id)}
                style={{ color: '#2f6bff' }}
              >
                重新挂牌
              </Button>
            </Tooltip>
          )}
          <Tooltip title="编辑 SGU 详情">
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => window.open(`/em/sgu-catalog`, '_blank')}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* Statistics Cards */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small" style={{ borderLeft: '3px solid #1f3a5f' }}>
            <Statistic
              title={<span style={{ fontSize: 12, color: '#666' }}>挂牌总数</span>}
              value={totalListings}
              prefix={<ShopOutlined style={{ color: '#1f3a5f' }} />}
              valueStyle={{ ...monoStyle, color: '#1f3a5f', fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ borderLeft: '3px solid #16a37b' }}>
            <Statistic
              title={<span style={{ fontSize: 12, color: '#666' }}>已挂牌 (Market 可见)</span>}
              value={listedCount}
              prefix={<GlobalOutlined style={{ color: '#16a37b' }} />}
              valueStyle={{ ...monoStyle, color: '#16a37b', fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ borderLeft: '3px solid #8c8c8c' }}>
            <Statistic
              title={<span style={{ fontSize: 12, color: '#666' }}>待上架</span>}
              value={pendingCount}
              prefix={<ClockCircleOutlined style={{ color: '#8c8c8c' }} />}
              valueStyle={{ ...monoStyle, color: '#666', fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ borderLeft: '3px solid #c63a3a' }}>
            <Statistic
              title={<span style={{ fontSize: 12, color: '#666' }}>已下架 (Market 不可见)</span>}
              value={delistedCount}
              prefix={<EyeInvisibleOutlined style={{ color: '#c63a3a' }} />}
              valueStyle={{ ...monoStyle, color: '#c63a3a', fontWeight: 600 }}
            />
          </Card>
        </Col>
      </Row>

      <Card
        title={<span style={{ fontWeight: 600, color: '#1f3a5f' }}>SGU 挂牌管理</span>}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
            新建挂牌
          </Button>
        }
      >
        <Table
          dataSource={data}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
          size="small"
          scroll={{ x: 1200 }}
        />
      </Card>

      {/* Create Listing Modal */}
      <Modal
        title="新建挂牌"
        open={createModalOpen}
        onOk={handleCreate}
        onCancel={() => { setCreateModalOpen(false); setSelectedSguId(null); }}
        okText="创建挂牌"
      >
        <div style={{ margin: '16px 0' }}>
          <p style={{ color: '#666', marginBottom: 12 }}>选择要挂牌到 Market 的 SGU：</p>
          <Select
            style={{ width: '100%' }}
            placeholder="选择 SGU"
            value={selectedSguId}
            onChange={setSelectedSguId}
            showSearch
            optionFilterProp="label"
            options={sgus
              .filter(s => s.status === 'active')
              .map(s => ({
                label: `${s.sgu_no} - ${s.sku_code} ${s.sku_name}`,
                value: s.id,
              }))}
          />
          <p style={{ color: '#8c8c8c', fontSize: 12, marginTop: 12 }}>
            挂牌后，Market 侧可即时检索此 SGU 的供给能力。
          </p>
        </div>
      </Modal>
    </div>
  );
}
