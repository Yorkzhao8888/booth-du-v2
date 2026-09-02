/**
 * FAB-MES-01 单设备 OEE 明细页（/exx/fab/equipment/:id）
 * 三率分开展示：可用率 × 性能率 × 良品率 = OEE；状态流水；可切换时间窗
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Col, DatePicker, Empty, Progress, Row, Segmented, Space, Table, Tag, message } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../../api';
import { BOOTH, MonoNum } from '../../styles/booth';

const EQ_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  running: { label: '运行中', color: '#16A37B', bg: '#E8F7F1' },
  idle: { label: '待机', color: '#8c8c8c', bg: '#F2F3F5' },
  down: { label: '停机', color: '#C63A3A', bg: '#FBEDED' },
  maintenance: { label: '保养中', color: '#2F6BFF', bg: '#EAF1FF' },
};

function RateCard({ title, value, hint, color }: { title: string; value: number | null; hint: string; color: string }) {
  const pct = value === null ? null : Math.round(value * 100);
  return (
    <Card size="small" style={{ borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 12, color: BOOTH.textSub, marginBottom: 4 }}>{title}</div>
      {pct === null ? (
        <div style={{ fontFamily: BOOTH.mono, fontSize: 24, fontWeight: 700, color: BOOTH.textSub }}>N/A</div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontFamily: BOOTH.mono, fontSize: 26, fontWeight: 700, color }}>{pct}</span>
          <span style={{ fontSize: 13, color: BOOTH.textSub }}>%</span>
        </div>
      )}
      <Progress percent={pct ?? 0} showInfo={false} size="small" strokeColor={color} style={{ marginTop: 4 }} />
      <div style={{ fontSize: 11, color: BOOTH.textSub, marginTop: 6 }}>{hint}</div>
    </Card>
  );
}

export default function FabEquipmentOee() {
  const { id } = useParams();
  const nav = useNavigate();
  const [eq, setEq] = useState<any>(null);
  const [oee, setOee] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [range, setRange] = useState<string>('7d');
  const [custom, setCustom] = useState<[any, any] | null>(null);
  const [loading, setLoading] = useState(false);

  const windowParams = useCallback(() => {
    const to = dayjs().format('YYYY-MM-DDTHH:mm:ss');
    let from: string;
    if (range === '24h') from = dayjs().subtract(1, 'day').format('YYYY-MM-DDTHH:mm:ss');
    else if (range === '7d') from = dayjs().subtract(7, 'day').format('YYYY-MM-DDTHH:mm:ss');
    else if (range === '30d') from = dayjs().subtract(30, 'day').format('YYYY-MM-DDTHH:mm:ss');
    else if (range === 'custom' && custom) from = custom[0].format('YYYY-MM-DDTHH:mm:ss');
    else from = dayjs().subtract(7, 'day').format('YYYY-MM-DDTHH:mm:ss');
    const toFinal = range === 'custom' && custom ? custom[1].format('YYYY-MM-DDTHH:mm:ss') : to;
    return `from=${from}&to=${toFinal}`;
  }, [range, custom]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [eqRes, oeeRes] = await Promise.all([
        api.get(`/exx/fab/equipment/${id}`).catch(() => ({ data: { data: null } })),
        api.get(`/exx/fab/equipment/${id}/oee?${windowParams()}`),
      ]);
      setEq(eqRes.data?.data || null);
      setOee(oeeRes.data?.data || null);
      setLogs(eqRes.data?.data?.status_log || []);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载 OEE 失败');
    } finally {
      setLoading(false);
    }
  }, [id, windowParams]);

  useEffect(() => { load(); }, [load]);

  const rate = (v: any) => (v === null || v === undefined ? null : Number(v));

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: '0 auto' }}>
      <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => nav('/exx/fab/equipment')} style={{ marginBottom: 8, paddingLeft: 0 }}>
        返回设备台账
      </Button>

      {/* 设备头 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 21, fontWeight: 700, color: BOOTH.primary }}>{eq?.name || '...'}</span>
            {eq?.status && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 10px', borderRadius: 4, background: EQ_STATUS[eq.status]?.bg }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: EQ_STATUS[eq.status]?.color }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: EQ_STATUS[eq.status]?.color }}>{EQ_STATUS[eq.status]?.label}</span>
              </span>
            )}
          </div>
          <div style={{ fontFamily: BOOTH.mono, fontSize: 12, color: BOOTH.textSub, marginTop: 4 }}>
            {eq?.code} · {eq?.type} · 额定 <MonoNum value={eq?.rated_capacity} unit="件/日" />
          </div>
        </div>
        <Space>
          <Segmented
            value={range}
            onChange={(v) => setRange(v as string)}
            options={[
              { label: '24h', value: '24h' },
              { label: '7天', value: '7d' },
              { label: '30天', value: '30d' },
              { label: '自定义', value: 'custom' },
            ]}
          />
          {range === 'custom' && (
            <DatePicker.RangePicker size="small" value={custom} onChange={(v) => setCustom(v as any)} />
          )}
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
        </Space>
      </div>

      {/* OEE 总卡 */}
      <Card size="small" style={{ marginBottom: 16, background: `linear-gradient(135deg, ${BOOTH.primary} 0%, ${BOOTH.primaryLight} 100%)` }} styles={{ body: { padding: 18 } }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>OEE（设备综合效率）</div>
            <div style={{ fontFamily: BOOTH.mono, fontSize: 38, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
              {oee?.oee === null || oee?.oee === undefined ? 'N/A' : `${Math.round(Number(oee.oee) * 100)}`}
              {oee?.oee !== null && oee?.oee !== undefined && <span style={{ fontSize: 16 }}>%</span>}
            </div>
            {oee?.oee === null && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>数据不足（无状态流水或无报工产出）</div>}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', lineHeight: 1.9 }}>
            <div>窗口: <span style={{ fontFamily: BOOTH.mono }}>{oee?.from ? dayjs(oee.from).format('MM-DD HH:mm') : '—'} ~ {oee?.to ? dayjs(oee.to).format('MM-DD HH:mm') : '—'}</span></div>
            <div>运行时长: <span style={{ fontFamily: BOOTH.mono }}>{oee?.running_minutes != null ? Math.round(oee.running_minutes) : '—'}</span> min / 计划 <span style={{ fontFamily: BOOTH.mono }}>{oee?.planned_minutes != null ? Math.round(oee.planned_minutes) : '—'}</span> min</div>
            <div>实际产出: <span style={{ fontFamily: BOOTH.mono }}>{oee?.output_qty ?? '—'}</span> 件 · 理论产出: <span style={{ fontFamily: BOOTH.mono }}>{oee?.expected_output != null ? Math.round(oee.expected_output) : '—'}</span> 件</div>
          </div>
        </div>
      </Card>

      {/* 三率 */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <RateCard title="可用率 Availability" value={rate(oee?.availability)} color={BOOTH.success} hint="实际运行时间 / 计划运行时间（来自状态流水）" />
        </Col>
        <Col xs={24} sm={8}>
          <RateCard title="性能率 Performance" value={rate(oee?.performance)} color={BOOTH.amber} hint="实际产出 / (额定产能 × 运行时间)（来自报工）" />
        </Col>
        <Col xs={24} sm={8}>
          <RateCard title="良品率 Quality" value={rate(oee?.quality)} color={BOOTH.action} hint="质检 pass 数 / 总产出（来自质检记录）" />
        </Col>
      </Row>

      {/* 状态流水 */}
      <Card size="small" title={<span style={{ fontSize: 15, fontWeight: 600 }}>状态流水</span>}>
        {logs.length === 0 ? (
          <Empty description={<span>暂无状态流水。变更设备状态后将在此记录（含停机原因与操作人）。</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table
            size="small"
            rowKey="id"
            dataSource={logs}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            columns={[
              {
                title: '变更', width: 150,
                render: (_: any, r: any) => (
                  <Space size={4}>
                    <Tag style={{ fontSize: 11 }}>{EQ_STATUS[r.from_status]?.label || r.from_status || '初始'}</Tag>
                    <span style={{ color: BOOTH.textSub }}>→</span>
                    <Tag color={r.to_status === 'down' ? 'red' : r.to_status === 'running' ? 'green' : r.to_status === 'maintenance' ? 'blue' : 'default'} style={{ fontSize: 11 }}>
                      {EQ_STATUS[r.to_status]?.label || r.to_status}
                    </Tag>
                  </Space>
                ),
              },
              { title: '原因', dataIndex: 'reason', ellipsis: true, render: (v: string) => v || '—' },
              {
                title: '开始', dataIndex: 'started_at', width: 130,
                render: (v: string) => <span style={{ fontFamily: BOOTH.mono, fontSize: 12 }}>{v ? dayjs(v).format('MM-DD HH:mm') : '—'}</span>,
              },
              {
                title: '结束', dataIndex: 'ended_at', width: 130,
                render: (v: string) => <span style={{ fontFamily: BOOTH.mono, fontSize: 12 }}>{v ? dayjs(v).format('MM-DD HH:mm') : <Tag color="processing" style={{ fontSize: 11 }}>进行中</Tag>}</span>,
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
