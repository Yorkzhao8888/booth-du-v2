/**
 * FAB-MES-01 OEE 看板（/exx/fab/oee）
 * 全厂 OEE 汇总卡 + 每设备三率进度条 + 停机原因 TOP 排行；可下钻单设备
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Col, Empty, Progress, Row, Segmented, Space, Statistic, Tag, message } from 'antd';
import { ReloadOutlined, RightOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../../api';
import { BOOTH, MonoNum } from '../../styles/booth';

function rateColor(v: number | null): string {
  if (v === null) return BOOTH.textSub;
  if (v <= 0.8) return BOOTH.success;
  if (v <= 1) return BOOTH.warning;
  return BOOTH.danger;
}

function pct(v: number | null): number | null {
  return v === null ? null : Math.round(v * 100);
}

function RateBar({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  const p = pct(value);
  const color = rateColor(value);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: BOOTH.textSub }}>
        <span>{label}</span>
        <span style={{ fontFamily: BOOTH.mono, fontWeight: 600, color: value === null ? BOOTH.textSub : color, fontSize: 12 }}>
          {p === null ? 'N/A' : `${p}%`}
        </span>
      </div>
      <Progress percent={p ?? 0} showInfo={false} size="small" strokeColor={color} style={{ margin: 0 }} />
      <div style={{ fontSize: 10, color: BOOTH.textSub, marginTop: 1 }}>{hint}</div>
    </div>
  );
}

export default function FabOeeDashboard() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [range, setRange] = useState('7d');

  const windowParams = useMemo(() => {
    const to = dayjs().format('YYYY-MM-DDTHH:mm:ss');
    let from: string;
    if (range === '24h') from = dayjs().subtract(1, 'day').format('YYYY-MM-DDTHH:mm:ss');
    else if (range === '7d') from = dayjs().subtract(7, 'day').format('YYYY-MM-DDTHH:mm:ss');
    else from = dayjs().subtract(30, 'day').format('YYYY-MM-DDTHH:mm:ss');
    return `from=${from}&to=${to}`;
  }, [range]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/exx/fab/equipment/oee/dashboard?${windowParams}`);
      setData(res.data?.data || null);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载 OEE 看板失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [load, windowParams]);

  const summary = data?.summary || {};
  const equipment = (data?.equipment || []) as any[];
  const downtimeTop = (data?.downtime_top || []) as any[];

  const avg = (v: any) => (v === null || v === undefined ? null : Number(v));

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 21, fontWeight: 700, color: BOOTH.primary }}>OEE 看板</div>
          <div style={{ fontSize: 12, color: BOOTH.textSub, marginTop: 4 }}>
            OEE = 可用率 × 性能率 × 良品率 —— 「产能负荷 82%」缺真因时，先看这里
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
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
        </Space>
      </div>

      {/* 全厂汇总 */}
      <Card size="small" style={{ marginBottom: 16, background: `linear-gradient(135deg, ${BOOTH.primary} 0%, ${BOOTH.primaryLight} 100%)` }} styles={{ body: { padding: 18 } }}>
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} sm={6}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>全厂 OEE</div>
            <div style={{ fontFamily: BOOTH.mono, fontSize: 36, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
              {avg(summary.oee) === null ? 'N/A' : Math.round(avg(summary.oee)! * 100)}
              {avg(summary.oee) !== null && <span style={{ fontSize: 15 }}>%</span>}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
              {summary.equipment_count ? `覆盖 ${summary.equipment_count} 台设备` : '暂无设备'}
            </div>
          </Col>
          <Col xs={24} sm={18}>
            <Row gutter={12}>
              <Col span={8}>
                <Statistic
                  title={<span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>可用率</span>}
                  value={avg(summary.availability) === null ? 'N/A' : Math.round(avg(summary.availability)! * 100)}
                  suffix={avg(summary.availability) === null ? '' : '%'}
                  valueStyle={{ fontFamily: BOOTH.mono, fontSize: 22, color: '#fff' }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title={<span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>性能率</span>}
                  value={avg(summary.performance) === null ? 'N/A' : Math.round(avg(summary.performance)! * 100)}
                  suffix={avg(summary.performance) === null ? '' : '%'}
                  valueStyle={{ fontFamily: BOOTH.mono, fontSize: 22, color: '#fff' }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title={<span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>良品率</span>}
                  value={avg(summary.quality) === null ? 'N/A' : Math.round(avg(summary.quality)! * 100)}
                  suffix={avg(summary.quality) === null ? '' : '%'}
                  valueStyle={{ fontFamily: BOOTH.mono, fontSize: 22, color: '#fff' }}
                />
              </Col>
            </Row>
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        {/* 每设备三率 */}
        <Col xs={24} lg={14}>
          <Card size="small" title={<span style={{ fontSize: 15, fontWeight: 600 }}>设备稼动明细（点击下钻）</span>}>
            {equipment.length === 0 ? (
              <Empty description={<span>暂无设备。请先在设备台账中建档。</span>} style={{ padding: 40 }} />
            ) : (
              equipment.map((e: any) => {
                const o = pct(avg(e.oee));
                return (
                  <div
                    key={e.id}
                    onClick={() => nav(`/exx/fab/equipment/${e.id}`)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px', borderBottom: `1px solid ${BOOTH.border}55`, cursor: 'pointer', borderRadius: 6 }}
                    onMouseEnter={(ev) => (ev.currentTarget.style.background = '#F7F9FC')}
                    onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ width: 148, flexShrink: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{e.name}</div>
                      <div style={{ fontFamily: BOOTH.mono, fontSize: 11, color: BOOTH.textSub }}>{e.code}</div>
                    </div>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 78, flexShrink: 0 }}>
                        <div style={{ fontSize: 11, color: BOOTH.textSub }}>OEE</div>
                        <div style={{ fontFamily: BOOTH.mono, fontSize: 18, fontWeight: 700, color: rateColor(e.oee) }}>
                          {o === null ? 'N/A' : `${o}%`}
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <RateBar label="可用率" value={avg(e.availability)} hint="运行/计划" />
                        <RateBar label="性能率" value={avg(e.performance)} hint="产出/理论" />
                        <RateBar label="良品率" value={avg(e.quality)} hint="质检pass" />
                      </div>
                    </div>
                    <RightOutlined style={{ color: BOOTH.textSub, fontSize: 11 }} />
                  </div>
                );
              })
            )}
          </Card>
        </Col>

        {/* 停机原因 TOP */}
        <Col xs={24} lg={10}>
          <Card size="small" title={<span style={{ fontSize: 15, fontWeight: 600 }}>停机原因 TOP</span>} extra={<Tag style={{ fontSize: 11 }}>{range === '24h' ? '近24h' : range === '7d' ? '近7天' : '近30天'}</Tag>}>
            {downtimeTop.length === 0 ? (
              <Empty description={<span>该时间窗内无停机记录。设备停机上报后，按原因自动聚合排行。</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 30 }} />
            ) : (
              downtimeTop.map((d: any, i: number) => {
                const max = downtimeTop[0].total_minutes || 1;
                const w = Math.max(8, Math.round((d.total_minutes / max) * 100));
                return (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ fontWeight: 500 }}>
                        <span style={{ display: 'inline-block', width: 18, height: 18, borderRadius: '50%', background: i === 0 ? BOOTH.danger : i === 1 ? BOOTH.warning : BOOTH.primaryLight, color: '#fff', fontSize: 11, textAlign: 'center', lineHeight: '18px', marginRight: 6 }}>{i + 1}</span>
                        {d.reason}
                      </span>
                      <span style={{ fontFamily: BOOTH.mono, color: BOOTH.danger, fontWeight: 600 }}>
                        <MonoNum value={Math.round(d.total_minutes)} unit="min" style={{ fontSize: 12 }} /> · <MonoNum value={d.times} unit="次" style={{ fontSize: 12 }} />
                      </span>
                    </div>
                    <Progress percent={w} showInfo={false} size="small" strokeColor={i === 0 ? BOOTH.danger : i === 1 ? BOOTH.warning : BOOTH.primaryLight} style={{ margin: 0 }} />
                  </div>
                );
              })
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
