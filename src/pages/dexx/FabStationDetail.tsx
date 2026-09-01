import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Tag, Progress, Button, Descriptions, Tabs, Table, Space, Modal, Select, Input, Statistic, Row, Col, message, Spin, Badge, Alert, Timeline, Empty } from 'antd';
import {
  ArrowLeftOutlined,
  ReloadOutlined,
  ApiOutlined,
  ThunderboltOutlined,
  WarningOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ToolOutlined,
  BellOutlined,
  RobotOutlined,
} from '@ant-design/icons';

import { useAuthStore } from '../../store';

const MONO = "'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace";
const NAVY = '#1F3A5F';
const AMBER = '#C9A227';
const INDIGO = '#2F6BFF';

interface Station {
  id: number;
  code: string;
  zone_type: string;
  station_type: string;
  state: string;
  fault_strategy: string;
  traffic_cap: number | null;
  capacity: number | null;
  current_load: number | null;
  bottleneck_rate: number | null;
  offline_mode: boolean;
  metadata: { agent_ids?: string[]; stage?: string } | null;
  active_orders: number;
  current_work_order: { id: number; job_id: string; product_name: string; qty: number; qty_completed: number; status: string } | null;
  devices: unknown[];
  alerts: unknown[];
}

const STATE_CONFIG: Record<string, { label: string; color: string }> = {
  provisioning: { label: '初始化', color: 'default' },
  idle: { label: '空闲', color: 'green' },
  busy: { label: '作业中', color: 'blue' },
  paused: { label: '已暂停', color: 'orange' },
  down: { label: '宕机', color: 'red' },
  maintenance: { label: '维护中', color: 'purple' },
  decommissioned: { label: '已退役', color: 'default' },
};

const ZONE_COLORS: Record<string, string> = { FAB: 'geekblue', WH: 'cyan', SVC: 'purple', DL: 'orange' };
const TYPE_LABELS: Record<string, string> = { line: '产线', device: '设备站', manual: '人工站', hybrid: '混合站' };
const FAULT_LABELS: Record<string, string> = { stop_all: '全停', bypass: '旁路', continue: '继续' };

const STATUS_OPTIONS = [
  { value: 'idle', label: '空闲 (idle)' },
  { value: 'busy', label: '作业中 (busy)' },
  { value: 'paused', label: '已暂停 (paused)' },
  { value: 'down', label: '宕机 (down)' },
  { value: 'maintenance', label: '维护中 (maintenance)' },
];

function loadColor(pct: number): string {
  if (pct <= 80) return '#16A37B';
  if (pct <= 100) return '#D97B1F';
  return '#C63A3A';
}

export default function FabStationDetail() {
  const { user } = useAuthStore();
  const isReadOnly = user?.role !== 'dexx';
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [station, setStation] = useState<Station | null>(null);
  const [statusModal, setStatusModal] = useState(false);
  const [faultModal, setFaultModal] = useState(false);
  const [newStatus, setNewStatus] = useState<string>();
  const [faultReason, setFaultReason] = useState('');
  const [faultStrategy, setFaultStrategy] = useState<string>('bypass');

  const fetchStation = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.get(`/dexx/fab/stations/${id}`);
      if (res?.success) {
        setStation(res.data?.station || res.data || res.station || null);
      }
    } catch {
      // ignore
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchStation();
  }, [fetchStation]);

  // 后端 report-status 合法枚举: run/idle/paused/down/maintenance (run→busy 映射)
  // 页面状态机值 busy → 提交 run; provisioning/decommissioned 不可上报
  const toApiState = (s: string): string => (s === 'busy' ? 'run' : s);

  const submitStatus = async () => {
    if (!newStatus || !id) return;
    try {
      await api.post(`/dexx/fab/station/${id}/report-status`, { state: toApiState(newStatus), reason: 'Manual report from detail page' });
      message.success(`状态已上报: ${STATUS_LABELS[newStatus] || newStatus}`);
      setStatusModal(false);
      fetchStation();
    } catch (e: any) {
      message.error(e?.message || '上报失败');
    }
  };

  const submitFault = async () => {
    if (!id || !faultReason) {
      message.warning('请填写故障原因');
      return;
    }
    try {
      const res = await api.post(`/dexx/fab/station/${id}/fault`, { reason: faultReason, strategy: faultStrategy });
      if (res?.success) {
        const d = res.data || {};
        message.success(`故障已传播(${d.strategy}): 影响 ${d.affected_orders || 0} 单, traffic_cap=${d.new_traffic_cap}`);
        setFaultModal(false);
        setFaultReason('');
        fetchStation();
      }
    } catch (e: any) {
      message.error(e?.message || '故障上报失败');
    }
  };

  const deployAgent = async () => {
    if (!id) return;
    try {
      const agentId = `agent-${id}-${Date.now()}`;
      await api.post(`/dexx/fab/station/${id}/deploy-agent`, { agent_id: agentId, note: 'Placeholder registration (LoRA pending)' });
      message.success(`Agent 已登记: ${agentId} (占位, 待 LoRA 接入)`);
      fetchStation();
    } catch (e: any) {
      message.error(e?.message || '登记失败');
    }
  };

  if (loading && !station) return <div style={{ padding: 48, textAlign: 'center' }}><Spin size="large" /></div>;
  if (!station) {
    return (
      <div style={{ padding: 48 }}>
        <Empty description="Station 不存在">
          <Button onClick={() => navigate('/dexx/fab/stations')}>返回 Station 列表</Button>
        </Empty>
      </div>
    );
  }

  const cfg = STATE_CONFIG[station.state] || STATE_CONFIG.provisioning;
  const cap = Number(station.traffic_cap ?? station.capacity ?? 0);
  const load = Number(station.current_load ?? station.active_orders ?? 0);
  const pct = cap > 0 ? Math.round((load / cap) * 100) : 0;
  const agents = station.metadata?.agent_ids || [];

  const woColumns = [
    { title: '工单', dataIndex: 'job_id', key: 'job_id', render: (v: string) => <span style={{ fontFamily: MONO, color: INDIGO }}>{v || '-'}</span> },
    { title: '商品', dataIndex: 'product_name', key: 'product_name' },
    { title: '进度', key: 'progress', width: 180, render: (_: unknown, r: any) => {
      const p = r.qty ? Math.round(((r.qty_completed || 0) / r.qty) * 100) : 0;
      return <Progress percent={p} size="small" strokeColor={loadColor(p)} />;
    } },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <Tag>{v}</Tag> },
  ];

  return (
    <div style={{ padding: '20px 24px', background: '#F5F7FA', minHeight: '100%' }}>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/dexx/fab/stations')}>返回列表</Button>
        <Button icon={<ReloadOutlined />} onClick={fetchStation}>刷新</Button>
      </Space>

      <Card
        title={
          <Space size={8}>
            <span style={{ fontFamily: MONO, fontSize: 15, color: NAVY }}>{station.code || `#${station.id}`}</span>
            <Tag color={cfg.color}>{cfg.label}</Tag>
            <Tag color={ZONE_COLORS[station.zone_type] || 'default'}>{station.zone_type || '-'}</Tag>
            <Tag>{TYPE_LABELS[station.station_type] || station.station_type || '工位'}</Tag>
            {station.offline_mode && <Tag color="warning" icon={<ThunderboltOutlined />}>离线模式</Tag>}
          </Space>
        }
        extra={
          <Space>
            <Button size="small" icon={<PlayCircleOutlined />} disabled={isReadOnly} onClick={() => { setNewStatus(station.state === 'busy' ? 'idle' : 'busy'); setStatusModal(true); }}>上报状态</Button>
            <Button size="small" danger icon={<WarningOutlined />} disabled={isReadOnly} onClick={() => setFaultModal(true)}>发起故障</Button>
            <Button size="small" icon={<ApiOutlined />} disabled={isReadOnly} onClick={deployAgent}>部署 Agent</Button>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Row gutter={24}>
          <Col xs={24} md={8}>
            <Statistic title="traffic_cap（当前可用产能）" value={cap} precision={0} styles={{ content: { fontFamily: MONO, color: NAVY } }} suffix={station.bottleneck_rate != null ? `/ 节拍 ${station.bottleneck_rate}` : ''} />
            <div style={{ marginTop: 12 }}>
              <Progress percent={pct} strokeColor={loadColor(pct)} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8c8c8c' }}>
                <span>占用 {load}</span>
                <span style={{ fontFamily: MONO, color: loadColor(pct), fontWeight: 600 }}>{pct}%</span>
              </div>
            </div>
          </Col>
          <Col xs={24} md={16}>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="故障策略"><Tag>{FAULT_LABELS[station.fault_strategy] || station.fault_strategy || 'bypass'}</Tag></Descriptions.Item>
              <Descriptions.Item label="Agent 部署位"><Badge status={agents.length > 0 ? 'success' : 'default'} text={agents.length > 0 ? `${agents.length} 个已登记` : '未部署'} /></Descriptions.Item>
              <Descriptions.Item label="所属 Zone"><Tag color={ZONE_COLORS[station.zone_type] || 'default'}>{station.zone_type || '-'}</Tag></Descriptions.Item>
              <Descriptions.Item label="站类型">{TYPE_LABELS[station.station_type] || station.station_type || '工位'}</Descriptions.Item>
              <Descriptions.Item label="当前在单"><span style={{ fontFamily: MONO, fontWeight: 600 }}>{station.active_orders}</span> 单</Descriptions.Item>
              <Descriptions.Item label="离线模式">{station.offline_mode ? <Tag color="warning">已启用（不授新权）</Tag> : <Tag>未启用</Tag>}</Descriptions.Item>
            </Descriptions>
            {station.offline_mode && (
              <Alert style={{ marginTop: 12 }} type="warning" showIcon message="离线模式生效中" description="已接收作业不中断（本地队列+WAL），但不授予新权限——「门」的权威始终在 LoRA。" />
            )}
          </Col>
        </Row>
      </Card>

      <Card size="small">
        <Tabs
          items={[
            {
              key: 'orders',
              label: <span><BellOutlined /> 当前作业队列</span>,
              children: station.current_work_order ? (
                <Table rowKey="id" size="small" columns={woColumns} dataSource={[station.current_work_order]} pagination={false} />
              ) : (
                <Empty description="当前无作业" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ),
            },
            {
              key: 'devices',
              label: '挂载设备',
              children: <Empty description="设备挂站（FAB-MES-01 预留）— station_id 已可关联" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
            },
            {
              key: 'alerts',
              label: '安灯事件',
              children: <Empty description="安灯按站呼叫（FAB-MES-03 预留）— station_id 已可关联" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
            },
            {
              key: 'agents',
              label: <span><RobotOutlined /> Agent 部署位</span>,
              children: agents.length === 0 ? (
                <Empty description="暂无 Agent — 点击右上角「部署 Agent」登记占位" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <Timeline
                  items={agents.map((a: string, i: number) => ({
                    color: 'green',
                    children: <span style={{ fontFamily: MONO, fontSize: 12 }}>{a} <Tag style={{ fontSize: 10 }}>占位登记</Tag></span>,
                  }))}
                />
              ),
            },
          ]}
        />
      </Card>

      {/* 上报状态弹窗 */}
      <Modal title={`上报状态 — ${station.code}`} open={statusModal} onOk={submitStatus} onCancel={() => setStatusModal(false)} okText="上报" cancelText="取消">
        <Select style={{ width: '100%' }} placeholder="选择新状态" value={newStatus} onChange={setNewStatus} options={STATUS_OPTIONS} />
      </Modal>

      {/* 故障弹窗 */}
      <Modal title={`发起故障 — ${station.code}`} open={faultModal} onOk={submitFault} onCancel={() => setFaultModal(false)} okText="上报故障" okButtonProps={{ danger: true }} cancelText="取消">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert type="info" showIcon message={`传播策略: ${FAULT_LABELS[faultStrategy]} — ${faultStrategy === 'stop_all' ? '停该站全部作业' : faultStrategy === 'bypass' ? '停受影响作业 + 下调 traffic_cap' : '继续，不阻断'}`} />
          <Input.TextArea rows={2} placeholder="故障原因（必填）" value={faultReason} onChange={(e) => setFaultReason(e.target.value)} />
          <Select style={{ width: '100%' }} value={faultStrategy} onChange={setFaultStrategy}
            options={[{ value: 'stop_all', label: 'stop_all 全停' }, { value: 'bypass', label: 'bypass 旁路（下调产能）' }, { value: 'continue', label: 'continue 继续' }]} />
        </Space>
      </Modal>
    </div>
  );
}
