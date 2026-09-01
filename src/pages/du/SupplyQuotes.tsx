import { useEffect, useState } from 'react';
import { Card, Table, Tag, Space, Button, message, Modal, Descriptions, Tooltip, Badge, Tabs, Timeline } from 'antd';
import { EyeOutlined, CheckOutlined, DollarOutlined, HistoryOutlined, SwapOutlined } from '@ant-design/icons';
import { api } from '../../api';

interface SupplyQuote {
  id: number;
  quote_no: string;
  sku_name: string | null;
  sgu_booth_type: string | null;
  bom_material_cost: number;
  labor_cost: number;
  manufacturing_fee: number;
  supply_price: number;
  margin_rate: number;
  gross_profit: number;
  total_price: number;
  version: number;
  status: string;
  effective_from: string | null;
  effective_to: string | null;
  created_at: string;
}

interface QuoteVersion {
  id: number;
  version: number;
  bom_material_cost: number;
  labor_cost: number;
  manufacturing_fee: number;
  supply_price: number;
  margin_rate: number;
  gross_profit: number;
  total_price: number;
  status: string;
  change_reason: string | null;
  created_at: string;
  changed_by_name: string | null;
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

// Format currency with monospace
const formatCurrency = (v: number | null | undefined): React.ReactNode => {
  if (v === null || v === undefined) return '-';
  return <span style={monoStyle}>¥{v.toFixed(2)}</span>;
};

// Format percentage with monospace
const formatPercent = (v: number | null | undefined): React.ReactNode => {
  if (v === null || v === undefined) return '-';
  return <span style={monoStyle}>{v.toFixed(1)}%</span>;
};

export default function DuSupplyQuotes() {
  const [quotes, setQuotes] = useState<SupplyQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedQuote, setSelectedQuote] = useState<SupplyQuote | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [versions, setVersions] = useState<QuoteVersion[]>([]);

  const fetchQuotes = async () => {
    setLoading(true);
    try {
      const res = await api(`/du/supply-quotes?page=${page}&pageSize=20`);
      setQuotes(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch { message.error('获取报价单失败'); }
    setLoading(false);
  };

  useEffect(() => { fetchQuotes(); }, [page]);

  const handleApprove = async (id: number) => {
    Modal.confirm({
      title: '确认批准',
      content: '确定要批准此报价单吗？批准后将对供给订单生效。',
      onOk: async () => {
        try {
          await api(`/du/supply-quotes/${id}/approve`, { method: 'POST' });
          message.success('报价单已批准');
          fetchQuotes();
        } catch { message.error('批准失败'); }
      },
    });
  };

  const showDetail = async (quote: SupplyQuote) => {
    setSelectedQuote(quote);
    setDetailOpen(true);
    try {
      const vRes = await api(`/du/supply-quotes/${quote.id}/versions`);
      setVersions(vRes.data || []);
    } catch { /* ignore */ }
  };

  const showCompare = async (quote: SupplyQuote) => {
    setSelectedQuote(quote);
    try {
      const vRes = await api(`/du/supply-quotes/${quote.id}/versions`);
      setVersions(vRes.data || []);
      setCompareOpen(true);
    } catch { message.error('获取版本历史失败'); }
  };

  // Version comparison columns
  const versionColumns = [
    { title: '版本', dataIndex: 'version', key: 'version', width: 60, render: (v: number) => <Badge count={`v${v}`} style={{ backgroundColor: '#1F3A5F' }} /> },
    { title: 'BOM材料', dataIndex: 'bom_material_cost', key: 'bom_material_cost', width: 90, align: 'right' as const, render: formatCurrency },
    { title: '人工费', dataIndex: 'labor_cost', key: 'labor_cost', width: 80, align: 'right' as const, render: formatCurrency },
    { title: '制费', dataIndex: 'manufacturing_fee', key: 'manufacturing_fee', width: 80, align: 'right' as const, render: formatCurrency },
    { title: '供给价', dataIndex: 'supply_price', key: 'supply_price', width: 90, align: 'right' as const, render: (v: number) => <span style={{ ...monoStyle, fontWeight: 600 }}>¥{v?.toFixed(2)}</span> },
    { title: '毛利率', dataIndex: 'margin_rate', key: 'margin_rate', width: 70, align: 'right' as const, render: formatPercent },
    { title: '总价', dataIndex: 'total_price', key: 'total_price', width: 90, align: 'right' as const, render: (v: number) => <span style={{ ...monoStyle, fontWeight: 600, color: '#16a37b' }}>¥{v?.toFixed(2)}</span> },
    { title: '状态', dataIndex: 'status', key: 'status', width: 70, render: (s: string) => <Tag color={statusColors[s]}>{statusLabels[s]}</Tag> },
    { title: '变更原因', dataIndex: 'change_reason', key: 'change_reason', width: 150, render: (v: string) => v || '-' },
    { title: '变更时间', dataIndex: 'created_at', key: 'created_at', width: 140, render: (v: string) => new Date(v).toLocaleString() },
  ];

  const columns = [
    {
      title: '报价单号',
      dataIndex: 'quote_no',
      key: 'quote_no',
      width: 140,
      fixed: 'left' as const,
      render: (v: string) => <span style={{ ...monoStyle, color: '#1F3A5F', fontWeight: 600 }}>{v}</span>,
    },
    {
      title: 'SKU',
      dataIndex: 'sku_name',
      key: 'sku_name',
      width: 100,
      render: (v: string) => v || '-',
    },
    {
      title: '铺类型',
      dataIndex: 'sgu_booth_type',
      key: 'sgu_booth_type',
      width: 70,
      render: (v: string) => {
        const colors: Record<string, string> = { sundry: '#8c8c8c', material: '#16a37b', device: '#2f6bff', plaza: '#c9a227' };
        const labels: Record<string, string> = { sundry: '杂货', material: '原料', device: '设备', plaza: '场地' };
        return v ? <Tag color={colors[v] || '#8c8c8c'}>{labels[v] || v}</Tag> : '-';
      },
    },
    {
      title: <Tooltip title="BOM材料成本"><DollarOutlined style={{ color: '#16a37b' }} /> BOM</Tooltip>,
      dataIndex: 'bom_material_cost',
      key: 'bom_material_cost',
      width: 90,
      align: 'right' as const,
      render: formatCurrency,
    },
    {
      title: <Tooltip title="人工费"><DollarOutlined style={{ color: '#2f6bff' }} /> 人工</Tooltip>,
      dataIndex: 'labor_cost',
      key: 'labor_cost',
      width: 80,
      align: 'right' as const,
      render: formatCurrency,
    },
    {
      title: <Tooltip title="制造/服务费"><DollarOutlined style={{ color: '#c9a227' }} /> 制费</Tooltip>,
      dataIndex: 'manufacturing_fee',
      key: 'manufacturing_fee',
      width: 80,
      align: 'right' as const,
      render: formatCurrency,
    },
    {
      title: <Tooltip title="供给价 = BOM + 人工 + 制费"><strong style={{ color: '#1F3A5F' }}>供给价</strong></Tooltip>,
      dataIndex: 'supply_price',
      key: 'supply_price',
      width: 100,
      align: 'right' as const,
      render: (v: number) => <span style={{ ...monoStyle, color: '#1F3A5F', fontWeight: 600 }}>¥{v?.toFixed(2)}</span>,
    },
    {
      title: <Tooltip title="毛利率"><strong style={{ color: '#c9a227' }}>毛利率</strong></Tooltip>,
      dataIndex: 'margin_rate',
      key: 'margin_rate',
      width: 70,
      align: 'right' as const,
      render: formatPercent,
    },
    {
      title: <Tooltip title="毛利额"><strong style={{ color: '#16a37b' }}>毛利</strong></Tooltip>,
      dataIndex: 'gross_profit',
      key: 'gross_profit',
      width: 80,
      align: 'right' as const,
      render: formatCurrency,
    },
    {
      title: <Tooltip title="总价 = 供给价 × (1 + 毛利率)"><strong style={{ color: '#16a37b' }}>总价</strong></Tooltip>,
      dataIndex: 'total_price',
      key: 'total_price',
      width: 100,
      align: 'right' as const,
      render: (v: number) => <span style={{ ...monoStyle, color: '#16a37b', fontWeight: 600 }}>¥{v?.toFixed(2)}</span>,
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
      width: 80,
      render: (s: string) => <Tag color={statusColors[s]}>{statusLabels[s]}</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      fixed: 'right' as const,
      render: (_: any, r: SupplyQuote) => (
        <Space size="small">
          <Tooltip title="查看详情+版本历史">
            <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => showDetail(r)}>详情</Button>
          </Tooltip>
          {r.version > 1 && (
            <Tooltip title="版本对比">
              <Button type="link" size="small" icon={<SwapOutlined />} onClick={() => showCompare(r)}>对比</Button>
            </Tooltip>
          )}
          {r.status === 'draft' && (
            <Button type="link" size="small" icon={<CheckOutlined />} onClick={() => handleApprove(r.id)}>批准</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title={
          <Space>
            <DollarOutlined style={{ color: '#c9a227' }} />
            <span>供给报价单</span>
            <Tag color="default" style={{ fontSize: 11 }}>DU 决策层 · 完整价格可见</Tag>
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={quotes}
          loading={loading}
          pagination={{ current: page, total, pageSize: 20, onChange: setPage }}
          size="small"
          scroll={{ x: 1400 }}
          rowClassName={(_, i) => i % 2 === 1 ? 'booth-zebra' : ''}
        />
      </Card>

      {/* Detail Modal with Tabs */}
      <Modal
        title={`报价单详情 - ${selectedQuote?.quote_no || ''}`}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={700}
      >
        {selectedQuote && (
          <Tabs
            items={[
              {
                key: 'detail',
                label: '报价详情',
                children: (
                  <Descriptions column={2} bordered size="small">
                    <Descriptions.Item label="报价单号"><span style={monoStyle}>{selectedQuote.quote_no}</span></Descriptions.Item>
                    <Descriptions.Item label="状态"><Tag color={statusColors[selectedQuote.status]}>{statusLabels[selectedQuote.status]}</Tag></Descriptions.Item>
                    <Descriptions.Item label="SKU">{selectedQuote.sku_name || '-'}</Descriptions.Item>
                    <Descriptions.Item label="铺类型">{selectedQuote.sgu_booth_type || '-'}</Descriptions.Item>
                    <Descriptions.Item label="版本"><Badge count={`v${selectedQuote.version}`} style={{ backgroundColor: selectedQuote.version > 1 ? '#c9a227' : '#8c8c8c' }} /></Descriptions.Item>
                    <Descriptions.Item label="创建时间">{new Date(selectedQuote.created_at).toLocaleString()}</Descriptions.Item>
                    <Descriptions.Item label="BOM材料成本">{formatCurrency(selectedQuote.bom_material_cost)}</Descriptions.Item>
                    <Descriptions.Item label="人工费">{formatCurrency(selectedQuote.labor_cost)}</Descriptions.Item>
                    <Descriptions.Item label="制造/服务费">{formatCurrency(selectedQuote.manufacturing_fee)}</Descriptions.Item>
                    <Descriptions.Item label="供给价"><span style={{ ...monoStyle, color: '#1F3A5F', fontWeight: 600, fontSize: 16 }}>¥{selectedQuote.supply_price?.toFixed(2)}</span></Descriptions.Item>
                    <Descriptions.Item label="毛利率">{formatPercent(selectedQuote.margin_rate)}</Descriptions.Item>
                    <Descriptions.Item label="毛利额">{formatCurrency(selectedQuote.gross_profit)}</Descriptions.Item>
                    <Descriptions.Item label="总价" span={2}><span style={{ ...monoStyle, color: '#16a37b', fontWeight: 600, fontSize: 18 }}>¥{selectedQuote.total_price?.toFixed(2)}</span></Descriptions.Item>
                    <Descriptions.Item label="生效日期">{selectedQuote.effective_from ? new Date(selectedQuote.effective_from).toLocaleDateString() : '-'}</Descriptions.Item>
                    <Descriptions.Item label="失效日期">{selectedQuote.effective_to ? new Date(selectedQuote.effective_to).toLocaleDateString() : '-'}</Descriptions.Item>
                  </Descriptions>
                ),
              },
              {
                key: 'versions',
                label: <span><HistoryOutlined /> 版本历史</span>,
                children: (
                  <Table
                    rowKey="id"
                    columns={versionColumns}
                    dataSource={versions}
                    pagination={false}
                    size="small"
                    scroll={{ x: 900 }}
                  />
                ),
              },
            ]}
          />
        )}
      </Modal>

      {/* Version Compare Modal */}
      <Modal
        title={`版本对比 - ${selectedQuote?.quote_no || ''}`}
        open={compareOpen}
        onCancel={() => setCompareOpen(false)}
        footer={null}
        width={900}
      >
        <Table
          rowKey="id"
          columns={versionColumns}
          dataSource={versions}
          pagination={false}
          size="small"
          scroll={{ x: 900 }}
          rowClassName={(_, i) => i % 2 === 1 ? 'booth-zebra' : ''}
        />
      </Modal>
    </div>
  );
}
