/**
 * 能力市场 (BOOTH-PK-01 v1.1 能力登记+匹配子集)
 * 目录登记 / 上下线 / Station 槽位卡片 / 订单→能力匹配预览
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Empty, Form, Input, InputNumber, message, Modal, Radio, Select,
  Space, Spin, Table, Tag, Typography,
} from 'antd';
import { ApiOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { api } from '../../api';

const MONO = "'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace";
const NAVY = '#1F3A5F';

const STAGE_LABELS: Record<string, string> = {
  preprocessing: '前置工序',
  production: '产线中段',
  packaging: '包装',
  sorting: '分拣',
};

interface CapItem {
  id: number;
  station_id: number;
  capability_code: string;
  name: string;
  inputs: string[];
  outputs: string[];
  estimated_time: number | null;
  rate: number | null;
  status: string;
  station_name?: string;
  station_code?: string;
  mount_state?: string;
}

interface MatchReq {
  stage: string;
  label: string;
  matched: boolean;
  capability: { capability_code: string; name: string; station_name?: string } | null;
}

export default function FabPlugins() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CapItem[]>([]);
  const [stations, setStations] = useState<{ id: number; code?: string; name?: string }[]>([]);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [registerOpen, setRegisterOpen] = useState(false);
  const [matchOrderId, setMatchOrderId] = useState('');
  const [matchResult, setMatchResult] = useState<{ requirements: MatchReq[]; missing_labels: string[]; coverage: string } | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [form] = Form.useForm();

  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (keyword.trim()) params.set('q', keyword.trim());
      const res = await api.get(`/dexx/fab/plugins/catalog${params.toString() ? `?${params}` : ''}`);
      setItems(res?.items || []);
    } catch (e: any) {
      message.error(e?.message || '目录加载失败');
    } finally {
      setLoading(false);
    }
  }, [keyword, statusFilter]);

  useEffect(() => {
    fetchCatalog();
    api.get('/dexx/fab/stations').then((res) => {
      setStations((res?.stations || []).map((s: any) => ({ id: s.id, code: s.code, name: s.name })));
    }).catch(() => undefined);
  }, [fetchCatalog]);

  const register = async (values: any) => {
    try {
      const toList = (v: string) => (v || '').split(/[,，;；\s]+/).map((s) => s.trim()).filter(Boolean);
      await api.post(`/dexx/fab/station/${values.station_id}/capabilities/register`, {
        capability_code: values.capability_code,
        name: values.name,
        inputs: toList(values.inputs),
        outputs: toList(values.outputs),
        estimated_time: values.estimated_time ?? null,
        rate: values.rate ?? null,
      });
      message.success('能力已登记并挂载到 Station');
      setRegisterOpen(false);
      form.resetFields();
      fetchCatalog();
    } catch (e: any) {
      message.error(e?.message || '登记失败');
    }
  };

  const toggle = async (row: CapItem) => {
    const next = row.status === 'active' ? 'unregister' : 'register';
    try {
      if (next === 'unregister') {
        await api.post(`/dexx/fab/station/${row.station_id}/capabilities/${encodeURIComponent(row.capability_code)}/unregister`, {});
        message.success(`能力 ${row.capability_code} 已停用 (不影响既有工单状态机)`);
      } else {
        await api.post(`/dexx/fab/station/${row.station_id}/capabilities/register`, {
          capability_code: row.capability_code, name: row.name, inputs: row.inputs, outputs: row.outputs,
          estimated_time: row.estimated_time, rate: row.rate,
        });
        message.success(`能力 ${row.capability_code} 已上线`);
      }
      fetchCatalog();
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    }
  };

  const runMatch = async () => {
    const oid = matchOrderId.trim().replace(/\D/g, '');
    if (!oid) {
      message.warning('请输入工单号');
      return;
    }
    setMatchLoading(true);
    try {
      const res = await api.get(`/dexx/fab/orders/${oid}/capability-match`);
      setMatchResult(res || null);
    } catch (e: any) {
      message.error(e?.message || '匹配查询失败');
    } finally {
      setMatchLoading(false);
    }
  };

  const columns = [
    { title: '能力代码', dataIndex: 'capability_code', key: 'code', render: (v: string) => <span style={{ fontFamily: MONO, color: NAVY }}>{v}</span> },
    { title: '能力名', dataIndex: 'name', key: 'name' },
    { title: '挂载 Station', key: 'station', render: (_: unknown, r: CapItem) => (
      <span style={{ fontFamily: MONO }}>{r.station_code || r.station_name || `#${r.station_id}`}</span>
    ) },
    { title: '预计耗时(min)', dataIndex: 'estimated_time', key: 'et', render: (v: number | null) => v ?? '-' },
    { title: '速率(件/h)', dataIndex: 'rate', key: 'rate', render: (v: number | null) => v ?? '-' },
    { title: '输入/输出', key: 'io', render: (_: unknown, r: CapItem) => (
      <span style={{ fontFamily: MONO, fontSize: 12 }}>
        [{(r.inputs || []).join(',')}] → [{(r.outputs || []).join(',')}]
      </span>
    ) },
    { title: '状态', key: 'status', width: 110, render: (_: unknown, r: CapItem) => (
      <Tag color={r.status === 'active' ? 'green' : 'default'}>{r.status === 'active' ? '可用' : '停用'}</Tag>
    ) },
    { title: '实现', key: 'runtime', width: 100, render: () => <Tag color="orange">登记层·占位</Tag> },
    {
      title: '操作', key: 'op', width: 90,
      render: (_: unknown, r: CapItem) => (
        <Button size="small" type={r.status === 'active' ? 'default' : 'primary'} onClick={() => toggle(r)}>
          {r.status === 'active' ? '停用' : '上线'}
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: '20px 24px', background: '#F5F7FA', minHeight: '100%' }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type="info" showIcon
          message="能力插件 · 登记层 (v1.1)"
          description="能力是执行能力登记层：登记/匹配/槽位可见；执行仍走 booth_fab_operations 工序表，不建并行执行引擎。热插拔运行时为 P1 跟踪项，当前目录如实标记「登记层·占位」。"
        />

        <Card
          title={<Space><ApiOutlined style={{ color: NAVY }} />能力目录</Space>}
          extra={
            <Space>
              <Input
                allowClear prefix={<SearchOutlined />} placeholder="搜索代码/名称" style={{ width: 180 }}
                onPressEnter={fetchCatalog} onChange={(e) => setKeyword(e.target.value)}
              />
              <Radio.Group value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} size="small">
                <Radio.Button value="all">全部</Radio.Button>
                <Radio.Button value="active">可用</Radio.Button>
                <Radio.Button value="inactive">停用</Radio.Button>
              </Radio.Group>
              <Button icon={<ReloadOutlined />} onClick={fetchCatalog}>刷新</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setRegisterOpen(true)}>登记能力</Button>
            </Space>
          }
        >
          <Table
            rowKey="id" size="small" loading={loading} columns={columns} dataSource={items}
            pagination={{ pageSize: 8 }}
            locale={{ emptyText: <Empty description="尚无已登记能力" /> }}
          />
        </Card>

        <Card title="订单 → 能力匹配预览" extra={
          <Space>
            <Input
              allowClear placeholder="工单号" style={{ width: 140 }}
              value={matchOrderId} onChange={(e) => setMatchOrderId(e.target.value)}
              onPressEnter={runMatch}
            />
            <Button type="primary" loading={matchLoading} onClick={runMatch}>匹配</Button>
          </Space>
        }>
          {!matchResult && <Typography.Text type="secondary">输入工单号后按 v1.1 规则 (标准工序链 × 能力目录 code) 预览匹配/缺失</Typography.Text>}
          {matchResult && (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Space wrap>
                {matchResult.requirements.map((r) => (
                  <Tag key={r.stage} color={r.matched ? 'green' : 'red'} style={{ fontSize: 13, padding: '4px 10px' }}>
                    {r.label}: {r.matched ? `已具备 (${r.capability?.name})` : '缺失'}
                  </Tag>
                ))}
                <Tag color="blue">覆盖 {matchResult.coverage}</Tag>
              </Space>
              {matchResult.missing_labels.length > 0 && (
                <Alert
                  type="warning" showIcon
                  message={matchResult.missing_labels.join('；')}
                  description="缺失能力可通过「登记能力」补齐后再匹配。"
                />
              )}
            </Space>
          )}
        </Card>

        <Card title="Station 能力槽位">
          {stations.length === 0 && <Empty description="无 Station" />}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {stations.map((s) => {
              const mounts = items.filter((i) => i.station_id === s.id);
              const active = mounts.filter((m) => m.status === 'active' && m.mount_state !== 'inactive').length;
              const off = mounts.length - active;
              return (
                <Card
                  key={s.id} size="small" style={{ width: 260, borderTop: `3px solid ${NAVY}` }}
                  title={<span style={{ fontFamily: MONO, color: NAVY }}>{s.code || `#${s.id}`} {s.name || ''}</span>}
                >
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <span>已登记: {mounts.length} 个能力</span>
                    <Space size={4} wrap>
                      {mounts.length === 0 && <Typography.Text type="secondary">空槽位</Typography.Text>}
                      {mounts.map((m) => (
                        <Tag key={m.id} color={m.status === 'active' ? 'green' : 'default'} style={{ fontFamily: MONO }}>
                          {m.capability_code}
                        </Tag>
                      ))}
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>可用 {active} / 停用 {off}</Typography.Text>
                  </Space>
                </Card>
              );
            })}
          </div>
        </Card>
      </Space>

      <Modal
        title="登记能力" open={registerOpen} onCancel={() => setRegisterOpen(false)}
        onOk={() => form.submit()} okText="登记并挂载" destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={register} initialValues={{ inputs: '', outputs: '' }}>
          <Form.Item name="station_id" label="挂载 Station" rules={[{ required: true, message: '选择 Station' }]}>
            <Select
              placeholder="选择 Station"
              options={stations.map((s) => ({ value: s.id, label: `${s.code || s.id} ${s.name || ''}` }))}
            />
          </Form.Item>
          <Form.Item name="capability_code" label="能力代码 (建议与标准工序一致: preprocessing/production/packaging/sorting)" rules={[{ required: true, message: '输入能力代码' }]}>
            <Input placeholder="如 packaging" />
          </Form.Item>
          <Form.Item name="name" label="能力名" rules={[{ required: true, message: '输入能力名' }]}>
            <Input placeholder="如 包装" />
          </Form.Item>
          <Form.Item name="inputs" label="输入物料 (逗号分隔)"><Input placeholder="如 半成品,包装膜" /></Form.Item>
          <Form.Item name="outputs" label="输出物料 (逗号分隔)"><Input placeholder="如 成品" /></Form.Item>
          <Space size={12} style={{ width: '100%' }}>
            <Form.Item name="estimated_time" label="预计耗时 (min)"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
            <Form.Item name="rate" label="速率 (件/h)"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
