import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Tag, Progress, Button, Input, Select, Space, Empty, Spin, Tooltip, Badge, Statistic, message, Dropdown } from 'antd';
import {
  ReloadOutlined,
  ClusterOutlined,
  ThunderboltOutlined,
  WarningOutlined,
  PauseCircleOutlined,
  ToolOutlined,
  StopOutlined,
  CheckCircleOutlined,
  SyncOutlined,
  ClockCircleOutlined,
  MinusCircleOutlined,
  SendOutlined,
  DownOutlined,
} from '@ant-design/icons';

const MONO = "'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace";
const NAVY = '#1F3A5F';
const INDIGO = '#2F6BFF';
const AMBER = '#C9A227';

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
}

const STATE_CONFIG: Record<string, { label: string; color: string; icon: JSX.Element }> = {
  provisioning: { label: '初始化', color: 'default', icon: <ClockCircleOutlined /> },
  idle: { label: '空闲', color: 'green', icon: <CheckCircleOutlined /> },
  busy: { label: '作业中', color: 'blue', icon: <SyncOutlined spin /> },
  paused: { label: '已暂停', color: 'orange', icon: <PauseCircleOutlined /> },
  down: { label: '宕机', color: 'red', icon: <StopOutlined /> },
  maintenance: { label: '维护中', color: 'purple', icon: <ToolOutlined /> },
  decommissioned: { label: '已退役', color: 'default', icon: <MinusCircleOutlined /> },
};

const ZONE_COLORS: Record<string, string> = { FAB: 'geekblue', WH: 'cyan', SVC: 'purple', DL: 'orange' };
const TYPE_LABELS: Record<string, string> = { line: '产线', device: '设备站', manual: '人工站', hybrid: '混合站' };

// 后端 report-status 可上报枚举: run/idle/paused/down/maintenance（provisioning/decommissioned 不可上报）
const REPORTABLE_STATES: { uiState: string; apiState: string; label: string }[] = [
  { uiState: 'idle', apiState: 'idle', label: '空闲' },
  { uiState: 'busy', apiState: 'run', label: '作业中' },
  { uiState: 'paused', apiState: 'paused', label: '已暂停' },
  { uiState: 'down', apiState: 'down', label: '宕机' },
  { uiState: 'maintenance', apiState: 'maintenance', label: '维护中' },
];

const FAULT_LABELS: Record<string, string> = { stop_all: '全停', bypass: '旁路', continue: '继续' };

function loadColor(pct: number): string {
  if (pct <= 80) return '#16A37B';
  if (pct <= 100) return '#D97B1F';
  return '#C63A3A';
}

export default function FabStations() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [stations, setStations] = useState<Station[]>([]);
  const [zone, setZone] = useState<string | undefined>();
  const [state, setState] = useState<string | undefined>();
  const [keyword, setKeyword] = useState('');

  const fetchStations = useCallback(async () => {
    setLoading(true);
    try {
      const params: string[] = [];
      if (zone) params.push(`zone_type=${zone}`);
      if (state) params.push(`state=${state}`);
      const res = await api.get(`/dexx/fab/stations${params.length ? '?' + params.join('&') : ''}`);
      if (res?.success) setStations(res.data?.items || res.items || []);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [zone, state]);

  useEffect(() => {
    fetchStations();
  }, [fetchStations]);

  // UI 状态 → 后端 report-status 枚举映射（busy→run，其余直传）
  const REPORT_STATE_MAP: Record<string, string> = {
    busy: 'run',
    idle: 'idle',
    paused: 'paused',
    down: 'down',
    maintenance: 'maintenance',
  };

  const reportStatus = async (station: Station, newState: string) => {
    try {
      await api.post(`/dexx/fab/station/${station.id}/report-status`, {
        state: REPORT_STATE_MAP[newState] || newState,
        reason: `Manual switch to ${newState}`,
      });
      message.success(`Station ${station.code} -> ${newState}`);
      fetchStations();
    } catch (e: any) {
      message.error(e?.response?.data?.error || e?.message || 'Status update failed');
    }
  };

  const triggerFault = async (station: Station) => {
    try {
      const res = await api.post(`/dexx/fab/station/${station.id}/fault`, {
        reason: `Manual fault test on ${station.code}`,
        strategy: station.fault_strategy || 'bypass',
      });
      if (res?.success) {
        message.success(`Fault propagated (${res.data?.strategy}): ${res.data?.affected_orders || 0} orders affected, traffic_cap=${res.data?.new_traffic_cap}`);
        fetchStations();
      }
    } catch (e: any) {
      message.error(e?.message || 'Fault report failed');
    }
  };

  const filtered = stations.filter((s) => !keyword || s.code?.toLowerCase().includes(keyword.toLowerCase()));

  const stats = {
    total: stations.length,
    busy: stations.filter((s) => s.state === 'busy').length,
    idle: stations.filter((s) => s.state === 'idle').length,
    abnormal: stations.filter((s) => ['down', 'paused'].includes(s.state)).length,
  };

  return (
    <div style={{ padding: '20px 24px', background: '#F5F7FA', minHeight: '100%' }}>
      {/* 顶部执行状态条 */}
      <div style={{ background: `linear-gradient(135deg, ${NAVY} 0%, #16293f 100%)`, borderRadius: 12, padding: '16px 24px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 32, flexWrap: 'wrap' }}>
        <div style={{ color: '#C9D4E3', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          <ClusterOutlined style={{ color: AMBER }} />
          <span>Station 作业站/产线</span>
        </div>
        <div style={{ display: 'flex', gap: 32, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {[
            { label: '总数', value: stats.total, color: '#C9D4E3' },
            { label: '作业中', value: stats.busy, color: '#5B8DEF' },
            { label: '空闲', value: stats.idle, color: '#16A37B' },
            { label: '异常', value: stats.abnormal, color: stats.abnormal > 0 ? '#C63A3A' : '#C9D4E3' },
          ].map((s) => (
            <div key={s.label}>
              <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: '#8FA3BD' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 筛选区 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input.Search placeholder="搜索站点编码" allowClear style={{ width: 220 }} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Select placeholder="所属 Zone" allowClear style={{ width: 140 }} value={zone} onChange={setZone}
            options={[{ value: 'FAB', label: 'FAB 车间' }, { value: 'WH', label: 'WH 仓储' }, { value: 'SVC', label: 'SVC 服务' }, { value: 'DL', label: 'DL 配送' }]} />
          <Select placeholder="状态" allowClear style={{ width: 140 }} value={state} onChange={setState}
            options={Object.entries(STATE_CONFIG).map(([v, c]) => ({ value: v, label: c.label }))} />
          <Button icon={<ReloadOutlined />} onClick={fetchStations}>刷新</Button>
        </Space>
      </Card>

      {/* Station 卡片列表 */}
      <Spin spinning={loading}>
        {filtered.length === 0 ? (
          <Card>
            <Empty description="暂无 Station — 产能资源尚未创建站点，请联系供给运营长（EM）在产能资源中创建">
              <Button icon={<ReloadOutlined />} onClick={fetchStations}>刷新</Button>
            </Empty>
          </Card>
        ) : (
          <Row gutter={[16, 16]}>
            {filtered.map((s) => {
              const cfg = STATE_CONFIG[s.state] || STATE_CONFIG.provisioning;
              const cap = Number(s.traffic_cap ?? s.capacity ?? 0);
              const load = Number(s.current_load ?? s.active_orders ?? 0);
              const pct = cap > 0 ? Math.round((load / cap) * 100) : 0;
              const agents = s.metadata?.agent_ids || [];
              return (
                <Col xs={24} sm={12} lg={8} xl={6} key={s.id}>
                  <Card
                    hoverable
                    size="small"
                    onClick={() => navigate(`/dexx/fab/station/${s.id}`)}
                    title={
                      <span style={{ fontFamily: MONO, fontSize: 13, color: NAVY }}>{s.code || `#${s.id}`}</span>
                    }
                    extra={<Tag color={cfg.color} icon={cfg.icon}>{cfg.label}</Tag>}
                  >
                    <Space size={4} wrap style={{ marginBottom: 8 }}>
                      <Tag color={ZONE_COLORS[s.zone_type] || 'default'}>{s.zone_type || '-'}</Tag>
                      <Tag>{TYPE_LABELS[s.station_type] || s.station_type || '工位'}</Tag>
                      {s.offline_mode && <Tag color="warning" icon={<ThunderboltOutlined />}>离线模式</Tag>}
                    </Space>
                    <div style={{ marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontSize: 12, color: '#8c8c8c' }}>traffic_cap</span>
                      <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 600 }}>
                        {load} <span style={{ color: '#8c8c8c', fontSize: 11 }}>/ {cap}</span>
                      </span>
                    </div>
                    <Progress percent={pct} strokeColor={loadColor(pct)} showInfo={false} size="small" />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#8c8c8c', marginTop: -2, marginBottom: 8 }}>
                      <span>负荷率 <span style={{ fontFamily: MONO, color: loadColor(pct), fontWeight: 600 }}>{pct}%</span></span>
                      <span>在单 <span style={{ fontFamily: MONO }}>{s.active_orders}</span></span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
                      <Space size={4}>
                        <Badge status={agents.length > 0 ? 'success' : 'default'} />
                        <span style={{ fontSize: 11, color: agents.length > 0 ? '#16A37B' : '#8c8c8c' }}>
                          Agent {agents.length > 0 ? `${agents.length}` : '未部署'}
                        </span>
                        {s.bottleneck_rate != null && (
                          <Tooltip title="瓶颈节拍产能">
                            <span style={{ fontSize: 11, color: '#8c8c8c' }}>节拍 <span style={{ fontFamily: MONO }}>{s.bottleneck_rate}</span></span>
                          </Tooltip>
                        )}
                      </Space>
                      <Space size={4} onClick={(e) => e.stopPropagation()}>
                        <Dropdown
                          menu={{
                            items: REPORTABLE_STATES.map((st) => ({
                              key: st.value,
                              label: st.label,
                              disabled: s.state === st.value,
                            })),
                            onClick: ({ key }) => reportStatus(s, key),
                          }}
                        >
                          <Button size="small" type="text" style={{ fontSize: 11, padding: '0 4px', color: '#2F6BFF' }}>
                            上报状态
                          </Button>
                        </Dropdown>
                        <Tooltip title={`故障策略: ${FAULT_LABELS[s.fault_strategy] || s.fault_strategy || 'bypass'}`}>
                          <Tag style={{ fontSize: 10, marginInlineEnd: 0 }}>{FAULT_LABELS[s.fault_strategy] || s.fault_strategy || 'bypass'}</Tag>
                        </Tooltip>
                      </Space>
                    </div>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </Spin>

      {/* 快捷操作说明 */}
      <Card size="small" style={{ marginTop: 16, background: '#FAFBFD' }}>
        <div style={{ fontSize: 12, color: '#8c8c8c' }}>
          点击卡片进入 Station 详情（当前作业 / 设备 / 安灯 / Agent 部署位）。故障传播策略：stop_all 全停该站作业 · bypass 停受影响作业并下调 traffic_cap · continue 不阻断。
          离线模式下已接收作业不中断，但不授予新权限——「门」的权威始终在 LoRA。
        </div>
      </Card>
    </div>
  );
}
