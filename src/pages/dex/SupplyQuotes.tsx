import { useEffect, useState } from 'react';
import { Card, Table, Tag, Button, message, Modal, Descriptions, Tooltip, Alert, Space, Badge } from 'antd';
import { EyeOutlined, LockOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { api } from '../../api';

interface SupplyQuote {
  id: number;
  quote_no: string;
  sku_name: string | null;
  sgu_booth_type: string | null;
  version: number;
  status: string;
  effective_from: string | null;
  effective_to: string | null;
  created_at: string;
}

const statusColors: Record<string, string> = {
  draft: 'default',
  pending: 'processing',
  approved: 'success',
  rejected: 'error',
  expired: 'warning',
};

const statusLabels: Record<string, string> = {
  draft: '草稿',
  pending: '待审批',
  approved: '已批准',
  rejected: '已拒绝',
  expired: '已过期',
};

// Monospace font style for numbers
const monoStyle: React.CSSProperties = {
  fontFamily: "'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace",
  fontVariantNumeric: 'tabular-nums',
};

export default function DexSupplyQuotes() {
  const [quotes, setQuotes] = useState<SupplyQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedQuote, setSelectedQuote] = useState<SupplyQuote | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchQuotes = async () => {
    setLoading(true);
    try {
      const res = await api(`/dex/supply-quotes?page=${page}&pageSize=20`);
      setQuotes(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch { message.error('获取报价单失败'); }
    setLoading(false);
  };

  useEffect(() => { fetchQuotes(); }, [page]);

  // DEX sees NO price fields - only quote metadata
  // This is enforced by the backend which strips all price fields
  const columns = [
    {
      title: '报价单号',
      dataIndex: 'quote_no',
      key: 'quote_no',
      width: 150,
      fixed: 'left' as const,
      render: (v: string) => <span style={{ ...monoStyle, color: '#1F3A5F', fontWeight: 600 }}>{v}</span>,
    },
    {
      title: 'SKU',
      dataIndex: 'sku_name',
      key: 'sku_name',
      width: 120,
      render: (v: string) => v || '-',
    },
    {
      title: '铺类型',
      dataIndex: 'sgu_booth_type',
      key: 'sgu_booth_type',
      width: 80,
      render: (v: string) => {
        const colors: Record<string, string> = { sundry: '#8c8c8c', material: '#16a37b', device: '#2f6bff', plaza: '#c9a227' };
        const labels: Record<string, string> = { sundry: '杂货', material: '原料', device: '设备', plaza: '场地' };
        return v ? <Tag color={colors[v] || '#8c8c8c'}>{labels[v] || v}</Tag> : '-';
      },
    },
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 70,
      align: 'center' as const,
      render: (v: number) => (
        <Badge
          count={`v${v}`}
          style={{
            backgroundColor: v > 1 ? '#c9a227' : '#8c8c8c',
            fontFamily: monoStyle.fontFamily,
            fontWeight: 600,
          }}
        />
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (s: string) => (
        <Tag color={statusColors[s]} icon={s === 'approved' ? <span>✓</span> : null}>
          {statusLabels[s]}
        </Tag>
      ),
    },
    {
      title: '生效日期',
      dataIndex: 'effective_from',
      key: 'effective_from',
      width: 110,
      render: (v: string) => v ? <span style={monoStyle}>{new Date(v).toLocaleDateString()}</span> : '-',
    },
    {
      title: '失效日期',
      dataIndex: 'effective_to',
      key: 'effective_to',
      width: 110,
      render: (v: string) => v ? <span style={monoStyle}>{new Date(v).toLocaleDateString()}</span> : '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: any, r: SupplyQuote) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => { setSelectedQuote(r); setDetailOpen(true); }}>详情</Button>
      ),
    },
  ];

  return (
    <div>
      <Card
        title={
          <Space>
            <LockOutlined style={{ color: '#8c8c8c' }} />
            <span>供给报价单</span>
            <Tag color="warning" style={{ fontSize: 11 }}>DEX 执行管理 · 价格已脱敏</Tag>
          </Space>
        }
      >
        {/* Price boundary notice */}
        <Alert
          message="价格边界说明"
          description="当前视图仅显示报价单号、状态等元数据。价格信息（BOM成本、人工费、供给价、毛利率等）仅对决策层（EM/DU/DX）可见，执行层不可见。"
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          style={{ marginBottom: 16 }}
        />

        <Table
          rowKey="id"
          columns={columns}
          dataSource={quotes}
          loading={loading}
          pagination={{ current: page, total, pageSize: 20, onChange: setPage }}
          size="small"
          scroll={{ x: 900 }}
          rowClassName={(_, i) => i % 2 === 1 ? 'booth-zebra' : ''}
        />
      </Card>

      <Modal
        title={`报价单详情 - ${selectedQuote?.quote_no || ''}`}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={500}
      >
        {selectedQuote && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="报价单号"><span style={monoStyle}>{selectedQuote.quote_no}</span></Descriptions.Item>
            <Descriptions.Item label="状态"><Tag color={statusColors[selectedQuote.status]}>{statusLabels[selectedQuote.status]}</Tag></Descriptions.Item>
            <Descriptions.Item label="SKU">{selectedQuote.sku_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="铺类型">{selectedQuote.sgu_booth_type || '-'}</Descriptions.Item>
            <Descriptions.Item label="版本"><Badge count={`v${selectedQuote.version}`} style={{ backgroundColor: selectedQuote.version > 1 ? '#c9a227' : '#8c8c8c' }} /></Descriptions.Item>
            <Descriptions.Item label="生效日期">{selectedQuote.effective_from ? new Date(selectedQuote.effective_from).toLocaleDateString() : '-'}</Descriptions.Item>
            <Descriptions.Item label="失效日期">{selectedQuote.effective_to ? new Date(selectedQuote.effective_to).toLocaleDateString() : '-'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{new Date(selectedQuote.created_at).toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="价格信息">
              <Space>
                <LockOutlined style={{ color: '#d97b1f' }} />
                <span style={{ color: '#999' }}>价格信息仅决策层可见</span>
              </Space>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}
