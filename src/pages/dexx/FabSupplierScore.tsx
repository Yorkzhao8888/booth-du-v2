/**
 * 供给信用看板 (BOOTH-PK-04 供给数据资产化 + 履约评分)
 * Tab1 本铺信用看板: 履约率/准时率/良品率/响应时效/追溯完整度卡片 + 趋势 + 样本量(不足如实提示) + 口径配置(EM/du)
 * Tab2 对外检索(Market 视角): 按 boothId 检索履约信用, 可下钻明细, 口径透明
 * 红线: 评分只基于真实业务数据; 不暴露采购价/售价/毛利; 数据不足不强行给分
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Descriptions, Empty, Form, Input, InputNumber, message, Modal,
  Row, Space, Spin, Statistic, Table, Tabs, Tag, Typography,
} from 'antd';
import { GlobalOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../../api';
import { useAuthStore } from '../../store';

const { Text } = Typography;

const METRIC_LABELS: Record<string, string> = {
  fulfillment: '履约率',
  on_time: '准时率',
  quality: '良品率',
  response: '响应时效',
  trace: '追溯完整度',
};

const METRIC_RULES: Record<string, string> = {
  fulfillment: '分子=Delivered/Settled 履约单, 分母=确认履约责任后的单(Created/Quoted 不计, Cancelled 计未履约)',
  on_time: 'Delivered/Settled 且有承诺交付时间的单中, 实际交付时间(milestones) ≤ required_at 的占比',
  quality: '完检( pass/reject )质检记录中 result=pass 的占比',
  response: '安灯事件已响应耗时均值分档: ≤30min=100 / ≤60min=80 / ≤120min=60 / ≤240min=40 / >240min=20',
  trace: '近窗口完成工单中, 同时具备产出批次与领料追溯链的占比',
};

function statusTag(status: string) {
  if (status === 'ok') return <Tag color="green">正常</Tag>;
  return <Tag color="orange">样本不足</Tag>;
}

interface MetricView {
  rate?: number | null;
  score?: number | null;
  avg_minutes?: number | null;
  sample: number;
  status: string;
  detail: Record<string, number>;
}

export default function DexxFabSupplierScore() {
  const role = useAuthStore((s: any) => s.user?.role || '');
  const canConfig = role === 'em' || role === 'du';

  const [loading, setLoading] = useState(false);
  const [dash, setDash] = useState<any>(null);
  const [drill, setDrill] = useState<{ key: string; view: MetricView } | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgForm] = Form.useForm();
  const [outBoothId, setOutBoothId] = useState<string>('');
  const [outCard, setOutCard] = useState<any>(null);
  const [outErr, setOutErr] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/dexx/fab/score/dashboard');
      setDash(res || null);
    } catch (e: any) {
      message.error(e?.message || '信用看板加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openConfig = () => {
    if (!dash) return;
    const w = dash.config?.weights || {};
    cfgForm.setFieldsValue({
      fulfillment: w.fulfillment, on_time: w.on_time, quality: w.quality,
      response: w.response, trace: w.trace,
      min_samples: dash.config?.min_samples, window_days: dash.config?.window_days,
    });
    setCfgOpen(true);
  };

  const saveConfig = async () => {
    try {
      const v = await cfgForm.validateFields();
      const weights = { fulfillment: v.fulfillment, on_time: v.on_time, quality: v.quality, response: v.response, trace: v.trace };
      await api.post('/dexx/fab/score/config', { weights, min_samples: v.min_samples, window_days: v.window_days });
      message.success('口径已更新, 评分将按新口径重算');
      setCfgOpen(false);
      load();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '口径保存失败');
    }
  };

  const refresh = async () => {
    try {
      await api.post('/dexx/fab/score/refresh');
      message.success('已重算当日评分');
      load();
    } catch (e: any) {
      message.error(e?.message || '重算失败(需 EM/du/dx)');
    }
  };

  const searchOut = async () => {
    const id = outBoothId.trim();
    setOutErr('');
    setOutCard(null);
    if (!id) return;
    try {
      const res = await api.get(`/dexx/fab/score/${id}`);
      setOutCard(res || null);
    } catch (e: any) {
      setOutErr(e?.message || '该 Booth 暂无可披露的供给信用档案');
    }
  };

  const trendData = (dash?.trend || []).slice().reverse().map((r: any) => ({
    date: String(r.score_date).slice(5),
    overall: r.overall_score === null ? null : Number(r.overall_score),
    fulfillment: r.fulfillment_rate === null ? null : Number(r.fulfillment_rate),
    on_time: r.on_time_rate === null ? null : Number(r.on_time_rate),
    quality: r.quality_rate === null ? null : Number(r.quality_rate),
  }));

  const metricCards: Array<{ key: string; view: MetricView; main: string; suffix?: string }> = dash ? [
    { key: 'fulfillment', view: dash.metrics.fulfillment, main: dash.metrics.fulfillment.rate === null || dash.metrics.fulfillment.rate === undefined ? 'N/A' : `${Number(dash.metrics.fulfillment.rate).toFixed(1)}%` },
    { key: 'on_time', view: dash.metrics.on_time, main: dash.metrics.on_time.rate === null || dash.metrics.on_time.rate === undefined ? 'N/A' : `${Number(dash.metrics.on_time.rate).toFixed(1)}%` },
    { key: 'quality', view: dash.metrics.quality, main: dash.metrics.quality.rate === null || dash.metrics.quality.rate === undefined ? 'N/A' : `${Number(dash.metrics.quality.rate).toFixed(1)}%` },
    { key: 'response', view: dash.metrics.response, main: dash.metrics.response.avg_minutes === null || dash.metrics.response.avg_minutes === undefined ? 'N/A' : `${Number(dash.metrics.response.avg_minutes).toFixed(0)} min`, suffix: `时效分 ${dash.metrics.response.score === null || dash.metrics.response.score === undefined ? 'N/A' : dash.metrics.response.score}` },
    { key: 'trace', view: dash.metrics.trace, main: dash.metrics.trace.rate === null || dash.metrics.trace.rate === undefined ? 'N/A' : `${Number(dash.metrics.trace.rate).toFixed(1)}%` },
  ] : [];

  const renderOutCard = (card: any) => (
    <Card title={`Booth #${card.booth_id} 履约信用`} extra={card.status === 'scored' ? <Tag color="gold">综合 {Number(card.overall_score).toFixed(1)}</Tag> : <Tag color="orange">样本不足</Tag>}>
      <Row gutter={[12, 12]}>
        {Object.entries(card.metrics || {}).map(([k, v]: [string, any]) => (
          <Col span={8} key={k}>
            <Statistic title={METRIC_LABELS[k] || k}
              value={k === 'response' ? (v.avg_minutes === null || v.avg_minutes === undefined ? 'N/A' : `${Number(v.avg_minutes).toFixed(0)} min`) : (v.rate === null || v.rate === undefined ? 'N/A' : `${Number(v.rate).toFixed(1)}%`)}
              suffix={<Text type="secondary" style={{ fontSize: 12 }}>样本 {v.sample}</Text>} />
          </Col>
        ))}
      </Row>
      <Alert style={{ marginTop: 12 }} type="info" showIcon
        message="口径透明(可复算)" description={<div>权重: {Object.entries(card.config?.weights || {}).map(([k, w]: [string, any]) => `${METRIC_LABELS[k]} ${(Number(w) * 100).toFixed(0)}%`).join(' / ')}; 窗口 {card.config?.window_days} 天; 样本阈值 {card.config?.min_samples}</div>} />
      <Alert style={{ marginTop: 8 }} type="success" showIcon message="该视图不含任何价格信息(履约/质量/时效维度)" />
    </Card>
  );

  return (
    <div style={{ padding: 16 }}>
      <Tabs defaultActiveKey="board"
        items={[
          {
            key: 'board', label: '本铺信用看板',
            children: loading ? <Spin /> : !dash ? <Empty description="暂无数据" /> : (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                {dash.status === 'insufficient' && (
                  <Alert type="warning" showIcon
                    message="样本不足, 不强行给分"
                    description={`以下指标样本量低于阈值(${dash.config?.min_samples}): ${dash.insufficient_metrics.map((k: string) => METRIC_LABELS[k] || k).join('、')}。总分暂不输出, 待数据积累后自动恢复。`} />
                )}
                <Row gutter={[12, 12]}>
                  <Col span={6}>
                    <Card>
                      <Statistic title="综合履约信用分"
                        value={dash.overall_score === null || dash.overall_score === undefined ? 'N/A' : Number(dash.overall_score).toFixed(1)}
                        suffix={dash.status === 'scored' ? <Tag color="gold">scored</Tag> : <Tag color="orange">insufficient</Tag>} />
                      <Text type="secondary" style={{ fontSize: 12 }}>统计日 {dash.score_date} · Booth #{dash.booth_id}</Text>
                      <div style={{ marginTop: 8 }}>
                        <Space>
                          <Button size="small" icon={<ReloadOutlined />} onClick={refresh}>重算</Button>
                          {canConfig && <Button size="small" icon={<SettingOutlined />} onClick={openConfig}>口径配置</Button>}
                        </Space>
                      </div>
                    </Card>
                  </Col>
                  {metricCards.map((m) => (
                    <Col span={3} key={m.key}>
                      <Card hoverable size="small" onClick={() => setDrill({ key: m.key, view: m.view })}>
                        <Statistic title={METRIC_LABELS[m.key]} value={m.main} suffix={m.suffix ? <Text type="secondary" style={{ fontSize: 12 }}>{m.suffix}</Text> : undefined} />
                        <div style={{ marginTop: 4 }}>{statusTag(m.view.status)}<Text type="secondary" style={{ fontSize: 12 }}>样本 {m.view.sample}</Text></div>
                      </Card>
                    </Col>
                  ))}
                </Row>
                {trendData.length > 0 && (
                  <Card title="信用趋势(近 30 个评分日)" size="small">
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis domain={[0, 100]} />
                        <RTooltip />
                        <Legend />
                        <Line type="monotone" dataKey="overall" name="综合分" stroke="#faad14" dot={false} connectNulls />
                        <Line type="monotone" dataKey="fulfillment" name="履约率" stroke="#1677ff" dot={false} connectNulls />
                        <Line type="monotone" dataKey="on_time" name="准时率" stroke="#52c41a" dot={false} connectNulls />
                        <Line type="monotone" dataKey="quality" name="良品率" stroke="#722ed1" dot={false} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>
                )}
                <Card title="评分口径(透明)" size="small">
                  <Descriptions size="small" column={1}>
                    {Object.entries(dash.config?.weights || {}).map(([k, w]: [string, any]) => (
                      <Descriptions.Item key={k} label={`${METRIC_LABELS[k] || k} 权重`}>{`${(Number(w) * 100).toFixed(0)}%`}</Descriptions.Item>
                    ))}
                    <Descriptions.Item label="样本阈值">{dash.config?.min_samples}</Descriptions.Item>
                    <Descriptions.Item label="统计窗口">{dash.config?.window_days} 天</Descriptions.Item>
                  </Descriptions>
                </Card>
              </Space>
            ),
          },
          {
            key: 'market', label: <span><GlobalOutlined /> 对外检索(Market 视角)</span>,
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Card size="small">
                  <Space>
                    <Input style={{ width: 200 }} placeholder="输入 Booth ID(如 1)" value={outBoothId} onChange={(e: any) => setOutBoothId(e.target.value)} onPressEnter={searchOut} />
                    <Button type="primary" onClick={searchOut}>检索信用</Button>
                  </Space>
                </Card>
                {outErr && <Alert type="info" showIcon message="无可披露档案" description={outErr} />}
                {outCard && renderOutCard(outCard)}
                {!outCard && !outErr && <Empty description="输入 Booth ID 检索其履约信用(与 Market 撮合同口径)" />}
              </Space>
            ),
          },
        ]}
      />
      <Modal title={`下钻明细 · ${drill ? METRIC_LABELS[drill.key] || drill.key : ''}`} open={!!drill} onCancel={() => setDrill(null)} footer={null}>
        {drill && (
          <>
            <Table size="small" pagination={false}
              dataSource={Object.entries(drill.view.detail).map(([k, v]) => ({ key: k, item: k, count: v }))}
              columns={[{ title: '明细项', dataIndex: 'item' }, { title: '计数', dataIndex: 'count' }]} />
            <Alert style={{ marginTop: 12 }} type="info" showIcon message="口径" description={METRIC_RULES[drill.key]} />
            <Text type="secondary">样本量 {drill.view.sample} · 阈值 {dash?.config?.min_samples} · 该明细不含任何价格字段</Text>
          </>
        )}
      </Modal>
      <Modal title="评分口径配置(EM/EU)" open={cfgOpen} onOk={saveConfig} onCancel={() => setCfgOpen(false)} okText="保存" cancelText="取消">
        <Form form={cfgForm} layout="vertical">
          {['fulfillment', 'on_time', 'quality', 'response', 'trace'].map((k) => (
            <Form.Item key={k} name={k} label={`${METRIC_LABELS[k]} 权重(0-1)`} rules={[{ required: true, message: '必填' }]}>
              <InputNumber min={0} max={1} step={0.05} style={{ width: 160 }} />
            </Form.Item>
          ))}
          <Form.Item name="min_samples" label="样本量阈值(不足则不出总分)" rules={[{ required: true, message: '必填' }]}>
            <InputNumber min={1} step={1} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="window_days" label="统计窗口(天)" rules={[{ required: true, message: '必填' }]}>
            <InputNumber min={7} max={365} step={1} style={{ width: 160 }} />
          </Form.Item>
          <Text type="secondary">五项权重之和必须为 1; 对外视图与 Market 撮合只读, 口径变更实时生效。</Text>
        </Form>
      </Modal>
    </div>
  );
}
