/**
 * 采集看板 (BOOTH-PK-03 IoT/边缘自动采集·通道契约先行)
 * Tab1 采集状态: health 设备卡(在线/离线/N/A/暂停) + 断连告警 + 采集配置(登记/启停/删除) + 模拟心跳(仅联调)
 * Tab2 遥测曲线: 设备遥测时序(source/demo_source 打标) + OEE 联动(数据不足 N/A)
 * 红线: 真实硬件未接入时以占位接入点存在(meta 如实标注); 模拟通道 demo_source=true 与生产隔离, 不冒充真实设备
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, Empty, Form, Input, InputNumber, message, Modal, Popconfirm,
  Radio, Row, Select, Space, Spin, Statistic, Switch, Table, Tabs, Tag, Tooltip, Typography,
} from 'antd';
import { ApiOutlined, PlusOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../../api';
import { useAuthStore } from '../../store';

interface TelemetryPoint {
  id: number;
  metric: string;
  value: number;
  collected_at: string;
  received_at: string;
  source: string;
  demo_source: boolean;
}

interface TelemetrySummary {
  metric: string;
  count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  latest_value: number | null;
  latest_at: string | null;
}

interface HealthDevice {
  equipment_id: number;
  equipment_code: string | null;
  equipment_name: string | null;
  station_name: string | null;
  metrics: { metric: string; interval_sec: number; enabled: boolean; demo_source: boolean }[];
  min_interval_sec: number | null;
  threshold_sec: number | null;
  last_received_at: string | null;
  age_sec: number | null;
  delay_sec: number | null;
  total_points: number;
  demo_points: number;
  status: string;
}

interface HealthAlert {
  equipment_id: number;
  equipment_name: string;
  age_sec: number | null;
  threshold_sec: number | null;
  message: string;
}

interface TelemetryConfig {
  id: number;
  equipment_id: number;
  equipment_code: string | null;
  equipment_name: string | null;
  station_name: string | null;
  metric: string;
  interval_sec: number;
  enabled: boolean;
  demo_source: boolean;
}

interface EquipmentRow {
  id: number;
  code: string;
  name: string;
  status: string;
  station_name?: string | null;
}

const STATUS_META: Record<string, { color: string; label: string }> = {
  online: { color: 'green', label: '在线' },
  offline: { color: 'red', label: '离线' },
  na: { color: 'default', label: 'N/A' },
  paused: { color: 'default', label: '已暂停' },
};

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? 'N/A' : `${(Number(v) * 100).toFixed(1)}%`;

const timeFmt = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '-' : d.toLocaleTimeString('zh-CN', { hour12: false });
};

export default function FabTelemetry() {
  const role = useAuthStore((s) => s.user?.role || '');
  // 写操作(登记配置/模拟心跳)走后端 requireHat('FAB'): 仅 FAB 帽(exx); du/dx/dex/em 只读
  const canWrite = role === 'exx';

  // --- health / configs ---
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<{
    summary: { total: number; online: number; offline: number; na: number; paused: number };
    devices: HealthDevice[];
    alerts: HealthAlert[];
    meta: any;
  } | null>(null);
  const [configs, setConfigs] = useState<TelemetryConfig[]>([]);
  const [equipments, setEquipments] = useState<EquipmentRow[]>([]);
  const [configOpen, setConfigOpen] = useState(false);
  const [beatLoading, setBeatLoading] = useState(false);
  const [form] = Form.useForm();

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [h, c, e] = await Promise.all([
        api.get<any>('/exx/fab/telemetry/health'),
        api.get<any>('/exx/fab/telemetry/configs'),
        api.get<any>('/exx/fab/equipment'),
      ]);
      setHealth(h);
      setConfigs(c?.configs || []);
      setEquipments(e?.equipment || []);
    } catch (err: any) {
      message.error(err?.message || '采集状态加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const saveConfig = async (values: any) => {
    try {
      await api.post('/exx/fab/telemetry/configs', {
        equipment_id: values.equipment_id,
        metric: String(values.metric || '').trim(),
        interval_sec: values.interval_sec ?? 60,
        enabled: true,
        demo_source: !!values.demo_source,
      });
      message.success(values.demo_source ? '已登记模拟采集配置(demo_source=true, 与生产隔离)' : '采集配置已登记');
      setConfigOpen(false);
      form.resetFields();
      fetchAll();
    } catch (err: any) {
      message.error(err?.message || '登记失败');
    }
  };

  const toggleConfig = async (row: TelemetryConfig) => {
    try {
      await api.post(`/exx/fab/telemetry/configs/${row.id}/toggle`, {});
      message.success(row.enabled ? '已停用采集配置' : '已启用采集配置');
      fetchAll();
    } catch (err: any) {
      message.error(err?.message || '操作失败');
    }
  };

  const removeConfig = async (row: TelemetryConfig) => {
    try {
      await api.delete(`/exx/fab/telemetry/configs/${row.id}`);
      message.success('采集配置已删除(遥测历史数据保留)');
      fetchAll();
    } catch (err: any) {
      message.error(err?.message || '删除失败');
    }
  };

  const demoBeat = async () => {
    setBeatLoading(true);
    try {
      const res = await api.post<any>('/exx/fab/telemetry/demo/beat', {});
      message.success(`模拟心跳完成: ${res?.beaten ?? 0} 个采集点(demo_source=true)`);
      fetchAll();
    } catch (err: any) {
      message.error(err?.message || '模拟心跳失败');
    } finally {
      setBeatLoading(false);
    }
  };

  // --- 遥测曲线 + OEE 联动 ---
  const [chartEqId, setChartEqId] = useState<number | null>(null);
  const [chartDemo, setChartDemo] = useState('all');
  const [chartLoading, setChartLoading] = useState(false);
  const [chartData, setChartData] = useState<{ points: TelemetryPoint[]; summary: TelemetrySummary[] } | null>(null);
  const [oee, setOee] = useState<any>(null);

  const fetchChart = useCallback(async () => {
    if (!chartEqId) return;
    setChartLoading(true);
    try {
      const [t, o] = await Promise.all([
        api.get<any>(`/exx/fab/equipment/${chartEqId}/telemetry?demo_source=${chartDemo}`),
        api.get<any>(`/exx/fab/equipment/${chartEqId}/oee`).catch(() => null),
      ]);
      setChartData({ points: t?.points || [], summary: t?.summary || [] });
      setOee(o || null);
    } catch (err: any) {
      message.error(err?.message || '遥测查询失败');
    } finally {
      setChartLoading(false);
    }
  }, [chartEqId, chartDemo]);

  useEffect(() => { fetchChart(); }, [fetchChart]);

  const chartRows = useMemo(() => {
    if (!chartData) return [];
    const map = new Map<string, any>();
    for (const p of chartData.points) {
      const row = map.get(p.collected_at) || { t: p.collected_at };
      row[p.metric] = p.value;
      map.set(p.collected_at, row);
    }
    return Array.from(map.values()).sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
  }, [chartData]);

  const chartMetrics = useMemo(() => (chartData?.summary || []).map((s) => s.metric), [chartData]);

  const deviceColumns = [
    {
      title: '设备', key: 'eq', render: (_: any, r: HealthDevice) =>
        `${r.equipment_code || `#${r.equipment_id}`} ${r.equipment_name || ''}`,
    },
    { title: '工位', dataIndex: 'station_name', key: 'station', render: (v: string | null) => v || '-' },
    {
      title: '采集项', key: 'metrics', render: (_: any, r: HealthDevice) => (
        <Space size={4} wrap>
          {r.metrics.map((m, i) => (
            <Tag key={i} color={!m.enabled ? 'default' : m.demo_source ? 'purple' : 'blue'}>
              {m.metric} / {m.interval_sec}s{m.demo_source ? ' · 模拟' : ''}{!m.enabled ? ' · 停用' : ''}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (v: string) => <Tag color={STATUS_META[v]?.color || 'default'}>{STATUS_META[v]?.label || v}</Tag>,
    },
    {
      title: '最近心跳', key: 'last',
      render: (_: any, r: HealthDevice) =>
        r.age_sec === null ? <Typography.Text type="secondary">N/A</Typography.Text> : `${r.age_sec}s 前`,
    },
    {
      title: '采集延迟', key: 'delay',
      render: (_: any, r: HealthDevice) =>
        r.delay_sec === null
          ? <Typography.Text type="secondary">N/A</Typography.Text>
          : <Tooltip title={`离线阈值 ${r.threshold_sec ?? '-'}s`}>{r.delay_sec}s</Tooltip>,
    },
    {
      title: '累计采集点', key: 'pts',
      render: (_: any, r: HealthDevice) => (
        <span>
          {r.total_points}
          {r.demo_points > 0 && <Typography.Text type="secondary"> (模拟 {r.demo_points})</Typography.Text>}
        </span>
      ),
    },
  ];

  const configColumns = [
    {
      title: '设备', key: 'eq', render: (_: any, r: TelemetryConfig) =>
        `${r.equipment_code || `#${r.equipment_id}`} ${r.equipment_name || ''}`,
    },
    { title: '工位', dataIndex: 'station_name', key: 'station', render: (v: string | null) => v || '-' },
    { title: '指标', dataIndex: 'metric', key: 'metric' },
    { title: '采样间隔', dataIndex: 'interval_sec', key: 'interval', render: (v: number) => `${v}s` },
    {
      title: '通道', dataIndex: 'demo_source', key: 'demo', width: 100,
      render: (v: boolean) => (v ? <Tag color="purple">模拟(联调)</Tag> : <Tag color="blue">生产</Tag>),
    },
    {
      title: '启用', dataIndex: 'enabled', key: 'enabled', width: 80,
      render: (v: boolean, r: TelemetryConfig) => <Switch size="small" checked={v} disabled={!canWrite} onChange={() => toggleConfig(r)} />,
    },
    ...(canWrite
      ? [{
          title: '操作', key: 'op', width: 80,
          render: (_: any, r: TelemetryConfig) => (
            <Popconfirm title="删除该采集配置?" description="遥测历史数据保留" onConfirm={() => removeConfig(r)}>
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          ),
        }]
      : []),
  ];

  const statusTab = (
    <Spin spinning={loading}>
      <Alert
        type="info" showIcon icon={<ApiOutlined />} style={{ marginBottom: 16 }}
        message="占位接入点(通道契约先行)"
        description={
          <span>
            {health?.meta?.note || '真实硬件未接入: 本通道为契约占位接入点, 设备接入后自动生效'}
            {health?.meta?.auth ? ` · 上报鉴权: ${health.meta.auth}` : ''}
            {health?.meta?.demo_channel?.note ? ` · ${health.meta.demo_channel.note}` : ''}
          </span>
        }
      />
      {health?.alerts?.length ? (
        <Alert
          type="warning" showIcon style={{ marginBottom: 16 }}
          message={`采集离线告警(${health.alerts.length})`}
          description={health.alerts.map((a) => a.message).join('；')}
        />
      ) : null}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={4}><Statistic title="在线" value={health?.summary?.online ?? 0} valueStyle={{ color: '#52c41a' }} /></Col>
        <Col span={4}><Statistic title="离线" value={health?.summary?.offline ?? 0} valueStyle={{ color: '#ff4d4f' }} /></Col>
        <Col span={4}><Statistic title="数据不足 N/A" value={health?.summary?.na ?? 0} /></Col>
        <Col span={4}><Statistic title="已暂停" value={health?.summary?.paused ?? 0} /></Col>
        <Col span={8} style={{ textAlign: 'right' }}>
          <Space>
            {canWrite && (
              <>
                <Button icon={<ThunderboltOutlined />} loading={beatLoading} onClick={demoBeat}>模拟心跳(联调)</Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setConfigOpen(true)}>登记采集配置</Button>
              </>
            )}
            <Button icon={<ReloadOutlined />} onClick={fetchAll}>刷新</Button>
          </Space>
        </Col>
      </Row>
      <Table
        rowKey="equipment_id" size="small" columns={deviceColumns as any}
        dataSource={health?.devices || []} pagination={false}
        locale={{ emptyText: <Empty description="暂无采集配置: 请先登记采集配置(无硬件可用模拟通道联调)" /> }}
        style={{ marginBottom: 24 }}
      />
      <Typography.Title level={5}>采集配置</Typography.Title>
      <Table rowKey="id" size="small" columns={configColumns as any} dataSource={configs} pagination={false} />
    </Spin>
  );

  const chartTab = (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          placeholder="选择设备" style={{ width: 280 }} value={chartEqId ?? undefined}
          onChange={(v: number) => setChartEqId(v)}
          options={equipments.map((e) => ({ value: e.id, label: `${e.code || `#${e.id}`} ${e.name}` }))}
          showSearch optionFilterProp="label"
        />
        <Radio.Group
          value={chartDemo} optionType="button"
          onChange={(e) => setChartDemo(e.target.value)}
          options={[
            { label: '全部', value: 'all' },
            { label: '仅生产', value: 'exclude' },
            { label: '仅模拟', value: 'only' },
          ]}
        />
        <Button type="primary" onClick={fetchChart} disabled={!chartEqId}>查询</Button>
        <Typography.Text type="secondary">source=auto 自动采集; demo_source=true 为模拟通道(与生产隔离)</Typography.Text>
      </Space>
      <Spin spinning={chartLoading}>
        {(chartData?.summary || []).length ? (
          <Row gutter={16} style={{ marginBottom: 16 }}>
            {chartData!.summary.map((s) => (
              <Col span={6} key={s.metric}>
                <Card size="small" title={s.metric}>
                  <Statistic title="采集点" value={s.count} />
                  <div style={{ marginTop: 8 }}>
                    <Typography.Text type="secondary">
                      均值 {s.avg ?? 'N/A'} · 最新 {s.latest_value ?? 'N/A'}{s.latest_at ? `(${timeFmt(s.latest_at)})` : ''}
                    </Typography.Text>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        ) : null}
        {chartEqId && chartRows.length ? (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartRows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="t" tickFormatter={timeFmt} minTickGap={40} />
              <YAxis />
              <RTooltip labelFormatter={(v: any) => timeFmt(String(v))} />
              <Legend />
              {chartMetrics.map((m) => (
                <Line key={m} type="monotone" dataKey={m} dot={false} connectNulls strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <Empty description={chartEqId ? 'N/A: 该设备在窗口内无遥测数据' : '请先选择设备'} />
        )}
        {oee ? (
          <Card size="small" title="OEE 联动(近 7 天)" style={{ marginTop: 16 }}>
            <Row gutter={16}>
              <Col span={4}><Statistic title="时间开动率" value={pct(oee?.availability)} /></Col>
              <Col span={4}><Statistic title="性能开动率" value={pct(oee?.performance)} /></Col>
              <Col span={4}><Statistic title="良品率" value={pct(oee?.quality)} /></Col>
              <Col span={4}><Statistic title="OEE" value={pct(oee?.oee)} /></Col>
              <Col span={8}>
                <Typography.Text type={oee?.telemetry_link?.available ? undefined : 'secondary'}>
                  {oee?.telemetry_link?.note || 'N/A'}
                </Typography.Text>
                {oee?.telemetry_link?.available ? (
                  <div style={{ marginTop: 4 }}>
                    <Typography.Text type="secondary">
                      自动采集 {oee.telemetry_link.auto_points_24h} 点(模拟 {oee.telemetry_link.demo_points_24h})
                      {oee.telemetry_link.latest_status ? ` · 最新状态 ${oee.telemetry_link.latest_status.value}` : ''}
                      {oee.telemetry_link.auto_output_24h !== null && oee.telemetry_link.auto_output_24h !== undefined
                        ? ` · 自动产量 ${oee.telemetry_link.auto_output_24h}` : ' · 自动产量 N/A'}
                    </Typography.Text>
                  </div>
                ) : null}
              </Col>
            </Row>
          </Card>
        ) : null}
      </Spin>
    </div>
  );

  return (
    <Card
      title="采集看板 · 设备遥测"
      extra={<Typography.Text type="secondary">BOOTH-PK-03 通道契约: ingest 幂等 / source=auto 打标 / 模拟通道隔离</Typography.Text>}
    >
      <Tabs
        defaultActiveKey="status"
        items={[
          { key: 'status', label: '采集状态', children: statusTab },
          { key: 'chart', label: '遥测曲线', children: chartTab },
        ]}
      />
      <Modal
        title="登记采集配置"
        open={configOpen}
        onCancel={() => setConfigOpen(false)}
        onOk={() => form.submit()}
        okText="保存"
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={saveConfig} initialValues={{ interval_sec: 10, demo_source: true }}>
          <Form.Item name="equipment_id" label="设备" rules={[{ required: true, message: '请选择设备' }]}>
            <Select
              placeholder="选择设备" showSearch optionFilterProp="label"
              options={equipments.map((e) => ({ value: e.id, label: `${e.code || `#${e.id}`} ${e.name}` }))}
            />
          </Form.Item>
          <Form.Item
            name="metric" label="指标 metric" rules={[{ required: true, message: '请输入指标名' }]}
            extra="如 status(设备状态 1 运行/0 待机)、output(产量增量)、temperature 等"
          >
            <Input placeholder="status" maxLength={50} />
          </Form.Item>
          <Form.Item name="interval_sec" label="采样间隔(秒)" rules={[{ required: true, message: '请输入采样间隔' }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="demo_source" label="模拟通道" valuePropName="checked"
            extra="开启后数据打标 demo_source=true, 仅用于无硬件链路联调, 与生产数据隔离"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
