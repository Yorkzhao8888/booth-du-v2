/**
 * FAB-MES-01 设备台账页（/dexx/fab/equipment）
 * 设备列表 · 状态徽标（色+文案）· OEE 进度条 · 新建设备 · 状态变更
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Col, DatePicker, Drawer, Empty, Form, Input, InputNumber, Modal, Progress, Row, Segmented, Select, Space, Statistic, Tag, Tooltip, message } from 'antd';
import { PlusOutlined, ReloadOutlined, ToolOutlined, ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../../api';
import { useAuthStore } from '../../store';
import { BOOTH, MonoNum } from '../../styles/booth';

const EQ_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  running: { label: '运行中', color: '#16A37B', bg: '#E8F7F1' },
  idle: { label: '待机', color: '#8c8c8c', bg: '#F2F3F5' },
  down: { label: '停机', color: '#C63A3A', bg: '#FBEDED' },
  maintenance: { label: '保养中', color: '#2F6BFF', bg: '#EAF1FF' },
};

const EQ_TYPES = ['烤箱', '压面机', '包装机', '分拣线', '搅拌机', '冷藏柜', '其他'];

function StatusBadge({ status }: { status: string }) {
  const s = EQ_STATUS[status] || { label: status, color: '#8c8c8c', bg: '#F2F3F5' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 10px', borderRadius: 4, background: s.bg }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
      <span style={{ fontSize: 12, color: s.color, fontWeight: 600 }}>{s.label}</span>
    </span>
  );
}

function OeeBar({ oee }: { oee: number | null }) {
  if (oee === null || oee === undefined) {
    return <span style={{ fontSize: 12, color: BOOTH.textSub }}>OEE N/A（数据不足）</span>;
  }
  const pct = Math.round(oee * 100);
  const color = pct >= 85 ? BOOTH.success : pct >= 60 ? BOOTH.amber : BOOTH.danger;
  return (
    <Tooltip title={`OEE ${pct}%`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Progress percent={pct} size="small" strokeColor={color} style={{ flex: 1, margin: 0 }} showInfo={false} />
        <MonoNum value={pct} unit="%" style={{ fontSize: 13, fontWeight: 600, color, width: 44, textAlign: 'right' }} />
      </div>
    </Tooltip>
  );
}

export default function FabEquipment() {
  const { user } = useAuthStore();
  const isReadOnly = user?.role !== 'dexx';
  const nav = useNavigate();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [stations, setStations] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<any>(null);
  const [form] = Form.useForm();
  const [statusForm] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const [eqRes, stRes] = await Promise.all([
        api.get('/dexx/fab/equipment'),
        api.get('/dexx/fab/stations').catch(() => ({ data: { data: [] } })),
      ]);
      setItems(eqRes.data?.data || []);
      setStations(stRes.data?.data || []);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载设备台账失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.status === filter)),
    [items, filter]
  );

  const stats = useMemo(() => {
    const running = items.filter((i) => i.status === 'running').length;
    const down = items.filter((i) => i.status === 'down').length;
    const maint = items.filter((i) => i.status === 'maintenance').length;
    const oees = items.map((i) => i.oee).filter((v: number | null) => v !== null && v !== undefined) as number[];
    const avgOee = oees.length ? Math.round((oees.reduce((a, b) => a + b, 0) / oees.length) * 100) : null;
    return { total: items.length, running, down, maint, avgOee };
  }, [items]);

  const onCreate = async (values: any) => {
    try {
      await api.post('/dexx/fab/equipment', {
        stationId: values.stationId,
        code: values.code,
        name: values.name,
        type: values.type,
        ratedCapacity: values.ratedCapacity,
        purchaseDate: values.purchaseDate ? values.purchaseDate.format('YYYY-MM-DD') : undefined,
        maintenanceCycleDays: values.maintenanceCycleDays,
      });
      message.success('设备已建档');
      setCreateOpen(false);
      form.resetFields();
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '建档失败');
    }
  };

  const onStatusChange = async (values: any) => {
    if (!statusTarget) return;
    try {
      await api.post(`/dexx/fab/equipment/${statusTarget.id}/status`, {
        status: values.status,
        reason: values.reason,
      });
      message.success(`「${statusTarget.name}」状态已变更为 ${EQ_STATUS[values.status]?.label || values.status}`);
      setStatusTarget(null);
      statusForm.resetFields();
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '状态变更失败');
    }
  };

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto' }}>
      {/* 页头 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 21, fontWeight: 700, color: BOOTH.primary }}>设备台账</div>
          <div style={{ fontSize: 12, color: BOOTH.textSub, marginTop: 4 }}>设备维度定位产能真因 — 是哪台设备拖累了稼动率</div>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} disabled={isReadOnly} onClick={() => setCreateOpen(true)}>新建设备</Button>
        </Space>
      </div>

      {/* 汇总卡 */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col span={5}><Card size="small"><Statistic title={<span style={{ fontSize: 12 }}>设备总数</span>} value={stats.total} valueStyle={{ fontFamily: BOOTH.mono, fontSize: 22, color: BOOTH.primary }} /></Card></Col>
        <Col span={5}><Card size="small"><Statistic title={<span style={{ fontSize: 12 }}>运行中</span>} value={stats.running} valueStyle={{ fontFamily: BOOTH.mono, fontSize: 22, color: BOOTH.success }} suffix={<span style={{ fontSize: 11 }}>/ {stats.total}</span>} /></Card></Col>
        <Col span={5}><Card size="small"><Statistic title={<span style={{ fontSize: 12 }}>停机</span>} value={stats.down} valueStyle={{ fontFamily: BOOTH.mono, fontSize: 22, color: stats.down > 0 ? BOOTH.danger : BOOTH.textMain }} /></Card></Col>
        <Col span={5}><Card size="small"><Statistic title={<span style={{ fontSize: 12 }}>保养中</span>} value={stats.maint} valueStyle={{ fontFamily: BOOTH.mono, fontSize: 22, color: BOOTH.action }} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title={<span style={{ fontSize: 12 }}>平均 OEE</span>} value={stats.avgOee ?? 'N/A'} valueStyle={{ fontFamily: BOOTH.mono, fontSize: 22, color: stats.avgOee !== null ? (stats.avgOee >= 85 ? BOOTH.success : stats.avgOee >= 60 ? BOOTH.amber : BOOTH.danger) : BOOTH.textSub }} suffix={stats.avgOee !== null ? '%' : undefined} /></Card></Col>
      </Row>

      {/* 过滤 */}
      <div style={{ marginBottom: 12 }}>
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as string)}
          options={[
            { label: '全部', value: 'all' },
            { label: '运行中', value: 'running' },
            { label: '待机', value: 'idle' },
            { label: '停机', value: 'down' },
            { label: '保养中', value: 'maintenance' },
          ]}
        />
      </div>

      {/* 设备列表 */}
      {filtered.length === 0 && !loading ? (
        <Empty description={<span>暂无设备档案。产线已建档（Station）后即可挂载设备，设备数据是 OEE 稼动率的数据基础。</span>} style={{ padding: 60 }}>
          <Button type="primary" icon={<PlusOutlined />} disabled={isReadOnly} onClick={() => setCreateOpen(true)}>+ 新建设备</Button>
        </Empty>
      ) : (
        <Row gutter={[12, 12]}>
          {filtered.map((eq: any) => {
            const station = stations.find((s: any) => s.id === eq.station_id);
            return (
              <Col xs={24} sm={12} lg={8} key={eq.id}>
                <Card
                  size="small"
                  hoverable
                  onClick={() => nav(`/dexx/fab/equipment/${eq.id}`)}
                  title={
                    <Space size={6}>
                      <ToolOutlined style={{ color: BOOTH.primary }} />
                      <span style={{ fontWeight: 600 }}>{eq.name}</span>
                      <span style={{ fontFamily: BOOTH.mono, fontSize: 11, color: BOOTH.textSub }}>{eq.code}</span>
                    </Space>
                  }
                  extra={<StatusBadge status={eq.status} />}
                  styles={{ body: { padding: 14 } }}
                >
                  <div style={{ fontSize: 12, color: BOOTH.textSub, marginBottom: 10, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <span><ThunderboltOutlined style={{ marginRight: 4 }} />{eq.type}</span>
                    <span>工位: {station?.name || station?.code || '-'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 11, color: BOOTH.textSub }}>额定产能</div>
                      <MonoNum value={eq.rated_capacity} unit="件/日" style={{ fontSize: 15, fontWeight: 600 }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: BOOTH.textSub }}>上次保养</div>
                      <MonoNum value={eq.last_maintenance_at ? dayjs(eq.last_maintenance_at).format('MM-DD') : '—'} style={{ fontSize: 15, fontWeight: 600 }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: BOOTH.textSub }}>保养周期</div>
                      <MonoNum value={eq.maintenance_cycle_days ?? '—'} unit="天" style={{ fontSize: 15, fontWeight: 600 }} />
                    </div>
                  </div>
                  <OeeBar oee={eq.oee ?? null} />
                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Button
                      size="small"
                      onClick={(e) => { e.stopPropagation(); setStatusTarget(eq); }}
                    >
                      变更状态
                    </Button>
                    <span style={{ fontSize: 11, color: BOOTH.action }}>查看 OEE 明细 →</span>
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      {/* 新建设备 */}
      <Drawer title="新建设备" width={420} open={createOpen} onClose={() => setCreateOpen(false)} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={onCreate} initialValues={{ maintenanceCycleDays: 30 }}>
          <Form.Item name="name" label="设备名称" rules={[{ required: true, message: '请输入设备名称' }]}>
            <Input placeholder="如：1号烤箱" />
          </Form.Item>
          <Form.Item name="code" label="设备编号" rules={[{ required: true, message: '请输入设备编号' }]}>
            <Input placeholder="如 EQ-OVEN-001" />
          </Form.Item>
          <Form.Item name="type" label="设备类型" rules={[{ required: true, message: '请选择设备类型' }]}>
            <Select options={EQ_TYPES.map((t) => ({ label: t, value: t }))} placeholder="选择类型" />
          </Form.Item>
          <Form.Item name="stationId" label="挂载工位（Station）" rules={[{ required: true, message: '请选择工位' }]}>
            <Select
              placeholder="选择挂载的工位"
              options={stations.map((s: any) => ({ label: `${s.name || s.code}（${s.code || ''}）`, value: s.id }))}
              notFoundContent={<span style={{ fontSize: 12, color: BOOTH.textSub }}>暂无工位，请先在 Station 管理中建档</span>}
            />
          </Form.Item>
          <Form.Item name="ratedCapacity" label="额定产能（件/日）" rules={[{ required: true, message: '请输入额定产能' }]}>
            <InputNumber min={1} style={{ width: '100%' }} placeholder="如 500" />
          </Form.Item>
          <Form.Item name="maintenanceCycleDays" label="保养周期（天）">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="purchaseDate" label="购置日期">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>建档</Button>
        </Form>
      </Drawer>

      {/* 变更状态 */}
      <Modal
        title={statusTarget ? `变更状态 — ${statusTarget.name}` : ''}
        open={!!statusTarget}
        onCancel={() => { setStatusTarget(null); statusForm.resetFields(); }}
        footer={null}
        width={400}
      >
        <Form form={statusForm} layout="vertical" onFinish={onStatusChange}>
          <Form.Item name="status" label="目标状态" rules={[{ required: true, message: '请选择状态' }]}>
            <Select
              placeholder="选择状态"
              options={Object.entries(EQ_STATUS).map(([k, v]) => ({ label: v.label, value: k }))}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(p, c) => p.status !== c.status}>
            {({ getFieldValue }) =>
              ['down', 'maintenance'].includes(getFieldValue('status')) ? (
                <Form.Item name="reason" label="原因（停机/保养）" rules={[{ required: true, message: '请填写原因' }]}>
                  <Input.TextArea rows={2} placeholder="如：加热管故障 / 月度保养" />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Button type="primary" htmlType="submit" block>确认变更</Button>
        </Form>
      </Modal>
    </div>
  );
}
