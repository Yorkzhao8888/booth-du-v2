import { useEffect, useState } from 'react';
import { Card, Table, Button, Tag, Space, message, Tooltip, Popconfirm } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, PlusOutlined } from '@ant-design/icons';
import { api } from '../../api';

interface SguListing {
  id: number; listing_no: string; sgu_id: number; status: string; market_visible: boolean;
  listed_at: string | null; delisted_at: string | null;
  sgu_no: string; booth_type: string; sku_code: string; sku_name: string; unit: string;
  unit_price: number;
}

interface SguCatalog { id: number; sgu_no: string; sku_code: string; sku_name: string; booth_type: string; }

const statusMap: Record<string, { color: string; label: string }> = {
  pending: { color: 'default', label: '待上架' },
  listed: { color: 'green', label: '已上架' },
  delisted: { color: 'red', label: '已下架' },
  suspended: { color: 'orange', label: '已暂停' },
};

export default function EmSguListings() {
  const [data, setData] = useState<SguListing[]>([]);
  const [sgus, setSgus] = useState<SguCatalog[]>([]);
  const [loading, setLoading] = useState(false);

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
    message.success('上架成功，Market 可见');
    fetchData();
  };

  const handleDelist = async (id: number) => {
    await api.put(`/em/sgu/listings/${id}/delist`);
    message.success('已下架，Market 不可见');
    fetchData();
  };

  const handleCreate = async (sguId: number) => {
    await api.post('/em/sgu/listings', { sguId });
    message.success('挂牌创建成功');
    fetchData();
  };

  const columns = [
    { title: '挂牌编号', dataIndex: 'listing_no', width: 120 },
    { title: 'SGU编号', dataIndex: 'sgu_no', width: 120 },
    { title: 'SKU', dataIndex: 'sku_code', width: 100 },
    { title: '商品名称', dataIndex: 'sku_name', width: 140 },
    {
      title: '铺类型', dataIndex: 'booth_type', width: 80,
      render: (v: string) => {
        const map: Record<string, string> = { sundry: '杂货', material: '原料', device: '设备', plaza: '场地' };
        return <Tag>{map[v] || v}</Tag>;
      },
    },
    {
      title: 'Market可见', dataIndex: 'market_visible', width: 100, align: 'center' as const,
      render: (v: boolean) => v ? <Tag color="green">可见</Tag> : <Tag>不可见</Tag>,
    },
    {
      title: '状态', dataIndex: 'status', width: 80,
      render: (v: string) => {
        const s = statusMap[v] || { color: 'default', label: v };
        return <Tag color={s.color}>{s.label}</Tag>;
      },
    },
    {
      title: '上架时间', dataIndex: 'listed_at', width: 160,
      render: (v: string | null) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作', width: 150,
      render: (_: unknown, record: SguListing) => (
        <Space size="small">
          {record.status === 'pending' && (
            <Tooltip title="上架到 Market"><Button type="link" size="small" icon={<ArrowUpOutlined />} onClick={() => handleList(record.id)}>上架</Button></Tooltip>
          )}
          {record.status === 'listed' && (
            <Popconfirm title="确认下架？Market 将不再展示此条目" onConfirm={() => handleDelist(record.id)}>
              <Tooltip title="从 Market 下架"><Button type="link" size="small" danger icon={<ArrowDownOutlined />}>下架</Button></Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <Card
        title={<span style={{ fontWeight: 600 }}>SGU 挂牌管理</span>}
        extra={
          <Space>
            <span style={{ fontSize: 12, color: '#999' }}>为 SGU 创建挂牌条目，上架后 Market 可检索</span>
          </Space>
        }
      >
        <Table dataSource={data} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} size="small" scroll={{ x: 1000 }} />
      </Card>

      {sgus.length > 0 && (
        <Card title="可挂牌 SGU" style={{ marginTop: 16 }} size="small">
          <Space wrap>
            {sgus.filter(s => s.status === 'active').map(s => (
              <Button key={s.id} size="small" icon={<PlusOutlined />} onClick={() => handleCreate(s.id)}>
                {s.sgu_no} ({s.sku_code})
              </Button>
            ))}
          </Space>
        </Card>
      )}
    </div>
  );
}
