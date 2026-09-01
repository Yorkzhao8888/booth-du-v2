import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Col, Empty, Form, Input, Modal, Row, Segmented, Select, Statistic, Tag, message } from 'antd';
import { BellOutlined, CheckCircleOutlined, ClockCircleOutlined, FireOutlined, SoundOutlined } from '@ant-design/icons';
import { api } from '../../api';
import { useAuthStore } from '../../store';
const MONO = { fontFamily: "SFMono-Regular, 'JetBrains Mono', Menlo, Consolas, monospace", fontVariantNumeric: 'tabular-nums' as const };

const SEVERITY: Record<string, { label: string; color: string; bg: string }> = {
  low: { label: '低', color: '#8c8c8c', bg: '#f5f5f5' },
  medium: { label: '中', color: '#d97b1f', bg: '#fdf3e7' },
  high: { label: '高', color: '#c63a3a', bg: '#fdecec' },
  critical: { label: '危急', color: '#ffffff', bg: '#c63a3a' },
};

const TYPE_LABELS: Record<string, string> = {
  shortage: '缺料',
  equipment: '设备',
  quality: '品质',
  overdue: '超时',
  other: '其他',
};

const STATUS_TABS = [
  { value: 'open', label: '待处理' },
  { value: 'processing', label: '处理中' },
  { value: 'resolved', label: '已解决' },
] as const;

const fmtMin = (sec?: number | null) => {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60}m` : `${m}m`;
};

const fmtTime = (t?: string | null) => (t ? new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

const AndonBoard = () => {
  const { user } = useAuthStore();
  const isReadOnly = user?.role !== 'dexx';
  const [tab, setTab] = useState<string>('open');
  const [items, setItems] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [resolveModal, setResolveModal] = useState<any>(null);
  const [resolveForm] = Form.useForm();
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const fetchBoard = useCallback(async () => {
    try {
      const res = await api.get('/dexx/fab/andon/board');
      setItems(res.items || []);
      setStats(res.stats || {});
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchBoard();
    timerRef.current = setInterval(fetchBoard, 30000); // 轮询兜底 ≤30s
    const onRefresh = () => fetchBoard();
    window.addEventListener('booth:refresh', onRefresh);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      window.removeEventListener('booth:refresh', onRefresh);
    };
  }, [fetchBoard]);

  const doAssign = async (ev: any) => {
    try {
      await api.post(`/dexx/fab/andon/${ev.id}/assign`, {});
      message.success(`安灯 #${ev.event_no} 已指派给你`);
      fetchBoard();
    } catch (e: any) { message.error(e.message || '指派失败'); }
  };

  const doResolve = async () => {
    const v = await resolveForm.validateFields();
    try {
      await api.post(`/dexx/fab/andon/${resolveModal.id}/resolve`, { solution: v.solution });
      message.success(`安灯 #${resolveModal.event_no} 已解决`);
      setResolveModal(null);
      resolveForm.resetFields();
      fetchBoard();
    } catch (e: any) { message.error(e.message || '解决失败'); }
  };

  const filtered = items.filter((it) => it.status === tab);
  const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  filtered.sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));

  return (
    <div>
      {/* 响应时效统计卡 */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="待处理" value={stats.open_count ?? 0} valueStyle={{ fontFamily: 'SFMono-Regular, JetBrains Mono, Menlo, Consolas, monospace', color: '#c63a3a' }} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="处理中" value={stats.processing_count ?? 0} valueStyle={{ fontFamily: 'SFMono-Regular, JetBrains Mono, Menlo, Consolas, monospace', color: '#d97b1f' }} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="平均响应" value={fmtMin(stats.avg_response_sec)} suffix={stats.avg_response_sec != null ? 'min' : ''} valueStyle={{ fontFamily: 'SFMono-Regular, JetBrains Mono, Menlo, Consolas, monospace' }} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="平均解决" value={fmtMin(stats.avg_resolve_sec)} suffix={stats.avg_resolve_sec != null ? 'min' : ''} valueStyle={{ fontFamily: 'SFMono-Regular, JetBrains Mono, Menlo, Consolas, monospace' }} /></Card>
        </Col>
      </Row>

      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Segmented options={STATUS_TABS.map((t) => ({ label: t.label, value: t.value }))} value={tab} onChange={(v) => setTab(v as string)} />
        <span style={{ fontSize: 12, color: '#8c8c8c' }}><ClockCircleOutlined /> 每 30 秒自动刷新</span>
      </div>

      {filtered.length === 0 ? (
        <Card><Empty description={tab === 'open' ? '当前无待处理异常' : tab === 'processing' ? '无处理中异常' : '暂无已解决记录'} image={Empty.PRESENTED_IMAGE_SIMPLE} /></Card>
      ) : (
        <Row gutter={[12, 12]}>
          {filtered.map((ev) => {
            const sev = SEVERITY[ev.severity] || SEVERITY.low;
            const isDark = ev.severity === 'critical';
            return (
              <Col xs={24} md={12} key={ev.id}>
                <Card
                  size="small"
                  style={{ borderLeft: `4px solid ${sev.color}`, background: isDark ? sev.bg : undefined }}
                  title={
                    <span style={{ color: isDark ? '#fff' : undefined }}>
                      <BellOutlined style={{ color: isDark ? '#ffd666' : sev.color, marginRight: 8 }} />
                      <span style={{ ...MONO, marginRight: 8, color: isDark ? "#ffd666" : "#1f3a5f" }}>#{ev.event_no}</span>
                      <Tag color={isDark ? 'gold' : undefined} style={isDark ? { background: '#ffd666', color: '#1f3a5f', border: 'none' } : undefined}>{TYPE_LABELS[ev.type] || ev.type}</Tag>
                      <Tag color={isDark ? 'gold' : undefined} style={isDark ? { background: '#ffd666', color: '#1f3a5f', border: 'none' } : { color: sev.color, borderColor: sev.color, background: isDark ? undefined : sev.bg }}>{sev.label}</Tag>
                    </span>
                  }
                  extra={<span style={{ fontSize: 12, color: isDark ? '#c9d4e3' : '#8c8c8c' }}>{fmtTime(ev.created_at)}</span>}
                >
                  <div style={{ marginBottom: 8, color: isDark ? '#fff' : undefined }}>{ev.message}</div>
                  <div style={{ fontSize: 12, color: isDark ? '#c9d4e3' : '#8c8c8c', marginBottom: 10 }}>
                    {ev.work_order_no && <span>工单 <span style={MONO}>{ev.work_order_no}</span> · </span>}
                    {ev.station_code && <span>工位 <span style={MONO}>{ev.station_code}</span> · </span>}
                    {ev.equipment_code && <span>设备 <span style={MONO}>{ev.equipment_code}</span> · </span>}
                    {ev.caller_name && <span>呼叫 {ev.caller_name}</span>}
                    {ev.assignee_name && <span> · 处理 {ev.assignee_name}</span>}
                  </div>
                  {ev.status === 'resolved' && (
                    <div style={{ fontSize: 12, color: '#16a37b', marginBottom: 8 }}>
                      <CheckCircleOutlined /> {ev.solution || '已解决'}
                    </div>
                  )}
                  <div style={{ textAlign: 'right' }}>
                    {ev.status === 'open' && <Button size="small" type="primary" icon={<SoundOutlined />} disabled={isReadOnly} onClick={() => doAssign(ev)}>响应处理</Button>}
                    {ev.status === 'processing' && <Button size="small" icon={<CheckCircleOutlined />} disabled={isReadOnly} onClick={() => setResolveModal(ev)}>标记解决</Button>}
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      <Modal
        title={resolveModal ? `解决安灯 #${resolveModal.event_no}` : ''}
        open={!!resolveModal}
        onOk={doResolve}
        onCancel={() => { setResolveModal(null); resolveForm.resetFields(); }}
        okText="确认解决"
      >
        <Form form={resolveForm} layout="vertical">
          <Form.Item name="solution" label="解决记录（将写入知识库候选）" rules={[{ required: true, message: '请填写解决方案' }]}>
            <Input.TextArea rows={3} placeholder="描述异常原因与处理方式, 沉淀为知识库候选" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default AndonBoard;
