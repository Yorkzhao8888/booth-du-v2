import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Statistic, Table, Tabs, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckOutlined, CloseOutlined, ReloadOutlined, SettingOutlined, StopOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { apiGet, apiPost, apiPut, unwrapData } from '../../api';

/**
 * [XDP-ECO] VEM 平台方控制台 (#xvpz) 最小集
 * 铺位列表(直营/加盟标) / 入驻审核(通过→开通 Booth-EDP 铺+协议费率落库, 驳回带理由) /
 * 费率配置(万分比固定比例可配置) / 分成台账(结算触发×费率=应收记录, 全链路 0 金额) / 治理操作(停铺/恢复)
 * 红线: 台账不写金额; 金额级分账随 ERP 账本线另单
 */

interface EcoShop {
  id: number;
  shopName: string;
  ecoType: 'direct' | 'franchise';
  category: string;
  status: 'active' | 'suspended';
  rateBps: number;
  isDemo: boolean;
  createdAt: string;
}

interface EcoApp {
  id: number;
  applicant: string;
  contact: string;
  shopName: string;
  category: string;
  applyNote: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectReason?: string | null;
  rateBps?: number | null;
  createdAt: string;
  reviewedAt?: string | null;
}

interface LedgerRow {
  settleRef: string;
  waveNo?: string | null;
  shopId?: number | null;
  shopName?: string | null;
  ecoType?: string | null;
  rateBps?: number | null;
  triggeredAt: string;
  receivableNote: string;
}

interface EcoSummary {
  shopsTotal: number;
  directShops: number;
  franchiseShops: number;
  activeShops: number;
  suspendedShops: number;
  pendingApplications: number;
  ledgerEntries: number;
}

const fmtRate = (bps?: number | null): string => (bps === null || bps === undefined ? '-' : `${(bps / 100).toFixed(1)}%`);
const fmtTime = (t?: string | null): string => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '-');

const ecoTypeTag = (t?: string | null): React.ReactNode =>
  t === 'direct' ? <Tag color="geekblue">直营</Tag> : <Tag color="cyan">加盟</Tag>;

function StatusTag({ s }: { s: string }) {
  if (s === 'active') return <Tag color="success">在营</Tag>;
  if (s === 'suspended') return <Tag color="error">已停铺</Tag>;
  if (s === 'pending') return <Tag color="warning">待审核</Tag>;
  if (s === 'approved') return <Tag color="success">已通过</Tag>;
  if (s === 'rejected') return <Tag color="error">已驳回</Tag>;
  return <Tag>{s}</Tag>;
}

const VemConsole: React.FC = () => {
  const [summary, setSummary] = useState<EcoSummary | null>(null);
  const [shops, setShops] = useState<EcoShop[]>([]);
  const [apps, setApps] = useState<EcoApp[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [ledgerShopId, setLedgerShopId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [rateModal, setRateModal] = useState<{ shop: EcoShop | null; value: number | null }>({ shop: null, value: null });
  const [rejectModal, setRejectModal] = useState<{ app: EcoApp | null; reason: string }>({ app: null, reason: '' });
  const [approveModal, setApproveModal] = useState<{ app: EcoApp | null; rateBps: number | null }>({ app: null, rateBps: null });

  const loadLedger = useCallback(async (shopId: number | null) => {
    try {
      const lg = await apiGet<LedgerRow[] | { data?: LedgerRow[] }>(`/eco/ledger${shopId !== null ? `?shopId=${shopId}` : ''}`);
      setLedger(unwrapData<LedgerRow[]>(lg));
    } catch (err) {
      message.error(`台账加载失败: ${(err as Error).message}`);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, sh, ap, lg] = await Promise.all([
        apiGet<EcoSummary | { data?: EcoSummary }>('/eco/summary'),
        apiGet<EcoShop[] | { data?: EcoShop[] }>('/eco/shops'),
        apiGet<EcoApp[] | { data?: EcoApp[] }>('/eco/applications'),
        apiGet<LedgerRow[] | { data?: LedgerRow[] }>('/eco/ledger'),
      ]);
      setSummary(unwrapData<EcoSummary>(s));
      setShops(unwrapData<EcoShop[]>(sh));
      setApps(unwrapData<EcoApp[]>(ap));
      setLedger(unwrapData<LedgerRow[]>(lg));
    } catch (err) {
      message.error(`生态数据加载失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // 费率配置 (MVP 固定比例可配置)
  const submitRate = async () => {
    if (!rateModal.shop || rateModal.value === null) return;
    try {
      await apiPut(`/eco/shops/${rateModal.shop.id}/rate`, { rateBps: rateModal.value });
      message.success(`费率已更新为 ${fmtRate(rateModal.value)}`);
      setRateModal({ shop: null, value: null });
      void loadAll();
    } catch (err) {
      message.error(`费率配置失败: ${(err as Error).message}`);
    }
  };

  // 治理操作: 停铺/恢复
  const governance = async (shop: EcoShop, action: 'suspend' | 'resume') => {
    try {
      await apiPost(`/eco/shops/${shop.id}/${action}`);
      message.success(action === 'suspend' ? `已停铺: ${shop.shopName}` : `已恢复: ${shop.shopName}`);
      void loadAll();
    } catch (err) {
      message.error(`治理操作失败: ${(err as Error).message}`);
    }
  };

  // 入驻审核: 通过 (开通 Booth-EDP 铺 + 协议费率落库)
  const submitApprove = async () => {
    if (!approveModal.app || approveModal.rateBps === null) return;
    try {
      await apiPost(`/eco/applications/${approveModal.app.id}/review`, { decision: 'approve', rateBps: approveModal.rateBps });
      message.success(`已通过并开通铺: ${approveModal.app.shopName} (${fmtRate(approveModal.rateBps)})`);
      setApproveModal({ app: null, rateBps: null });
      void loadAll();
    } catch (err) {
      message.error(`审核失败: ${(err as Error).message}`);
    }
  };

  // 入驻审核: 驳回带理由
  const submitReject = async () => {
    if (!rejectModal.app || !rejectModal.reason.trim()) {
      message.warning('驳回必须填写理由');
      return;
    }
    try {
      await apiPost(`/eco/applications/${rejectModal.app.id}/review`, { decision: 'reject', reason: rejectModal.reason.trim() });
      message.success('已驳回');
      setRejectModal({ app: null, reason: '' });
      void loadAll();
    } catch (err) {
      message.error(`审核失败: ${(err as Error).message}`);
    }
  };

  const shopColumns: ColumnsType<EcoShop> = [
    { title: '铺位名称', dataIndex: 'shopName', key: 'shopName', render: (v: string, r) => (
      <Space size={6}>{v}{r.isDemo ? <Tag color="orange">演示</Tag> : null}</Space>
    ) },
    { title: '类型', dataIndex: 'ecoType', key: 'ecoType', width: 84, render: (v: string) => ecoTypeTag(v) },
    { title: '经营类目', dataIndex: 'category', key: 'category', width: 110 },
    { title: '协议费率', dataIndex: 'rateBps', key: 'rateBps', width: 96, render: (v: number) => <strong>{fmtRate(v)}</strong> },
    { title: '状态', dataIndex: 'status', key: 'status', width: 96, render: (v: string) => <StatusTag s={v} /> },
    { title: '操作', key: 'action', width: 230, render: (_, r) => (
      <Space size={4}>
        <Button size="small" icon={<SettingOutlined />} onClick={() => setRateModal({ shop: r, value: r.rateBps })}>费率</Button>
        {r.status === 'active' ? (
          <Button size="small" danger icon={<StopOutlined />} onClick={() => void governance(r, 'suspend')}>停铺</Button>
        ) : (
          <Button size="small" type="primary" ghost icon={<PlayCircleOutlined />} onClick={() => void governance(r, 'resume')}>恢复</Button>
        )}
      </Space>
    ) },
  ];

  const appColumns: ColumnsType<EcoApp> = [
    { title: '申请主体', dataIndex: 'applicant', key: 'applicant' },
    { title: '拟开铺名', dataIndex: 'shopName', key: 'shopName' },
    { title: '经营类目', dataIndex: 'category', key: 'category', width: 110 },
    { title: '联系方式', dataIndex: 'contact', key: 'contact', width: 120 },
    { title: '申请时间', dataIndex: 'createdAt', key: 'createdAt', width: 150, render: (v: string) => fmtTime(v) },
    { title: '状态', dataIndex: 'status', key: 'status', width: 96, render: (v: string) => <StatusTag s={v} /> },
    { title: '审核结果', key: 'review', width: 200, render: (_, r) => {
      if (r.status === 'approved') return <span>费率 {fmtRate(r.rateBps)} · {fmtTime(r.reviewedAt)}</span>;
      if (r.status === 'rejected') return <Typography.Text type="danger" style={{ fontSize: 12 }}>理由: {r.rejectReason}</Typography.Text>;
      return (
        <Space size={4}>
          <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => setApproveModal({ app: r, rateBps: 300 })}>通过</Button>
          <Button size="small" danger icon={<CloseOutlined />} onClick={() => setRejectModal({ app: r, reason: '' })}>驳回</Button>
        </Space>
      );
    } },
  ];

  const ledgerColumns: ColumnsType<LedgerRow> = [
    { title: '结算单号 (Case)', dataIndex: 'settleRef', key: 'settleRef' },
    { title: '波次', dataIndex: 'waveNo', key: 'waveNo', width: 120, render: (v?: string | null) => v || '-' },
    { title: '关联铺位', dataIndex: 'shopName', key: 'shopName', render: (v: string | null | undefined, r) => (v ? <Space size={6}>{v}{ecoTypeTag(r.ecoType)}</Space> : '-') },
    { title: '协议费率', dataIndex: 'rateBps', key: 'rateBps', width: 96, render: (v?: number | null) => <strong>{fmtRate(v)}</strong> },
    { title: '结算触发时间', dataIndex: 'triggeredAt', key: 'triggeredAt', width: 160, render: (v: string) => fmtTime(v) },
    { title: '应收分成说明', dataIndex: 'receivableNote', key: 'receivableNote', render: (v: string) => (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{v}</Typography.Text>
    ) },
  ];

  return (
    <div style={{ padding: '0 0 24px' }}>
      <Card style={{ borderRadius: 12, marginBottom: 14 }} styles={{ body: { padding: '16px 18px' } }}>
        <Space align="center" style={{ width: '100%', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>平台方控制台 <Tag color="gold">VEM · 生态治理</Tag></Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              入驻审核 · 费率配置 · 分成台账 · 铺位治理 (四主体生态 MVP)
            </Typography.Text>
          </div>
          <Button icon={<ReloadOutlined />} onClick={() => void loadAll()} loading={loading}>刷新</Button>
        </Space>
      </Card>

      <Card style={{ borderRadius: 12, marginBottom: 14 }} styles={{ body: { padding: '14px 8px' } }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 4 }}>
          <Statistic title="铺位总数" value={summary?.shopsTotal ?? '-'} loading={loading} />
          <Statistic title="直营铺" value={summary?.directShops ?? '-'} loading={loading} valueStyle={{ color: '#2f54eb' }} />
          <Statistic title="加盟铺" value={summary?.franchiseShops ?? '-'} loading={loading} valueStyle={{ color: '#13c2c2' }} />
          <Statistic title="在营" value={summary?.activeShops ?? '-'} loading={loading} valueStyle={{ color: '#52c41a' }} />
          <Statistic title="待审申请" value={summary?.pendingApplications ?? '-'} loading={loading} valueStyle={{ color: '#fa8c16' }} />
          <Statistic title="分成应收记录" value={summary?.ledgerEntries ?? '-'} loading={loading} valueStyle={{ color: '#764ba2' }} />
        </div>
      </Card>

      <Card style={{ borderRadius: 12 }} styles={{ body: { padding: '4px 16px 16px' } }}>
        <Tabs
          defaultActiveKey="shops"
          onChange={(k) => { if (k === 'ledger') void loadLedger(ledgerShopId); }}
          items={[
            {
              key: 'shops',
              label: `铺位列表 (${shops.length})`,
              children: <Table rowKey="id" size="small" columns={shopColumns} dataSource={shops} loading={loading} pagination={false} scroll={{ x: 720 }} />,
            },
            {
              key: 'applications',
              label: `入驻审核 (${apps.filter((a) => a.status === 'pending').length} 待审)`,
              children: <Table rowKey="id" size="small" columns={appColumns} dataSource={apps} loading={loading} pagination={false} scroll={{ x: 860 }} />,
            },
            {
              key: 'ledger',
              label: '分成台账',
              children: (
                <>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="台账口径: 只记「Case 结算触发事件 + 协议费率 = 应收分成记录」, 全链路不写金额"
                    description="金额级分账随 ERP 账本线另单; 台账为履约快照只读消费 (Case 结算事务零改动)。"
                  />
                  <Space size={8} style={{ marginBottom: 12 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>按铺位筛选:</Typography.Text>
                    <Select
                      size="small"
                      style={{ minWidth: 220 }}
                      value={ledgerShopId}
                      onChange={(v) => { setLedgerShopId(v); void loadLedger(v); }}
                      options={[
                        { value: null, label: '全部铺位' },
                        ...shops.map((s) => ({ value: s.id, label: `${s.shopName}${s.isDemo ? ' (演示)' : ''}` })),
                      ]}
                    />
                  </Space>
                  <Table rowKey="settleRef" size="small" columns={ledgerColumns} dataSource={ledger} loading={loading} pagination={false} scroll={{ x: 760 }} locale={{ emptyText: '暂无结算触发流水 (Case 结算发生后自动进入台账)' }} />
                </>
              ),
            },
          ]}
        />
      </Card>

      {/* 费率配置 Modal */}
      <Modal
        open={!!rateModal.shop}
        title={`费率配置 · ${rateModal.shop?.shopName ?? ''}`}
        okText="保存"
        cancelText="取消"
        onOk={() => void submitRate()}
        onCancel={() => setRateModal({ shop: null, value: null })}
        destroyOnClose
      >
        <Form layout="vertical">
          <Form.Item label="协议抽成比例 (MVP 固定比例, 万分比)" required>
            <InputNumber
              min={1}
              max={2000}
              step={10}
              style={{ width: '100%' }}
              value={rateModal.value ?? undefined}
              onChange={(v) => setRateModal((m) => ({ ...m, value: typeof v === 'number' ? v : null }))}
              addonAfter={`= ${fmtRate(rateModal.value)}`}
            />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>如 300 = 3.0%; 允许范围 0.1% - 20%</Typography.Text>
        </Form>
      </Modal>

      {/* 通过审核 Modal (费率落库) */}
      <Modal
        open={!!approveModal.app}
        title={`通过入驻 · ${approveModal.app?.applicant ?? ''}`}
        okText="通过并开通铺"
        cancelText="取消"
        onOk={() => void submitApprove()}
        onCancel={() => setApproveModal({ app: null, rateBps: null })}
        destroyOnClose
      >
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`通过后将开通 Booth-EDP 铺「${approveModal.app?.shopName ?? ''}」并落库加盟协议费率`} />
        <Form layout="vertical">
          <Form.Item label="加盟协议费率 (万分比)" required>
            <InputNumber
              min={1}
              max={2000}
              step={10}
              style={{ width: '100%' }}
              value={approveModal.rateBps ?? undefined}
              onChange={(v) => setApproveModal((m) => ({ ...m, rateBps: typeof v === 'number' ? v : null }))}
              addonAfter={`= ${fmtRate(approveModal.rateBps)}`}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 驳回 Modal (带理由) */}
      <Modal
        open={!!rejectModal.app}
        title={`驳回入驻 · ${rejectModal.app?.applicant ?? ''}`}
        okText="确认驳回"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        onOk={() => void submitReject()}
        onCancel={() => setRejectModal({ app: null, reason: '' })}
        destroyOnClose
      >
        <Form layout="vertical">
          <Form.Item label="驳回理由 (必填, 将回传申请方)" required>
            <Input.TextArea
              rows={3}
              value={rejectModal.reason}
              onChange={(e) => setRejectModal((m) => ({ ...m, reason: e.target.value }))}
              placeholder="例如: 经营类目与平台当前生态规划不符, 请补充资质后重新申请"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default VemConsole;
