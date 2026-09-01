import React, { useEffect, useState, useCallback } from 'react';
import { Card, Table, Row, Col, DatePicker, Space, Statistic, Empty, Spin } from 'antd';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from 'recharts';
import { api } from '../../api';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

interface TopRow { reject_reason: string; cnt: number; reject_qty: number }
interface TrendRow { d: string; cnt: number; reject_qty: number }
interface DistRow { key: string; cnt: number }

const FabDefects: React.FC = () => {
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().subtract(29, 'day'), dayjs()]);
  const [top, setTop] = useState<TopRow[]>([]);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [byEquip, setByEquip] = useState<DistRow[]>([]);
  const [byPerson, setByPerson] = useState<DistRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const qs = `from=${range[0].format('YYYY-MM-DD')}&to=${range[1].format('YYYY-MM-DD')}`;
      const res: any = await api.get(`/dexx/fab/trace/defect/top?${qs}`);
      setTop(res.top || []);
      setTrend(res.trend || []);
      setByEquip(res.by_equipment || []);
      setByPerson(res.by_inspector || []);
      setTotal(res.total_defects || 0);
    } catch (e) { /* ignore */ }
    setLoading(false);
  }, [range]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const topColumns = [
    { title: '排名', key: 'rank', width: 60, render: (_: any, __: any, i: number) => i + 1 },
    { title: '不良原因', dataIndex: 'reject_reason' },
    { title: '次数', dataIndex: 'cnt', width: 90, sorter: (a: TopRow, b: TopRow) => a.cnt - b.cnt },
    { title: '不良数量', dataIndex: 'reject_qty', width: 100, render: (v: any) => v ?? 0, sorter: (a: TopRow, b: TopRow) => (a.reject_qty || 0) - (b.reject_qty || 0) },
  ];

  return (
    <Card
      title="不良分析 (SPC 简版)"
      extra={
        <Space>
          <RangePicker value={range} onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])} allowClear={false} />
        </Space>
      }
    >
      <Spin spinning={loading}>
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}><Card size="small"><Statistic title="区间不良总数" value={total} suffix="次" /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title="缺陷类型数" value={top.length} suffix="类" /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title="涉及设备" value={byEquip.length} suffix="台" /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title="涉及检验员" value={byPerson.length} suffix="人" /></Card></Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Card size="small" title="缺陷类型 TOP10">
              {top.length ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={top} layout="vertical" margin={{ left: 40 }}>
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="reject_reason" width={90} />
                    <RTooltip />
                    <Bar dataKey="cnt" name="不良次数" fill="#cf1322" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <Empty description="区间内无不良记录" />}
            </Card>
          </Col>
          <Col span={12}>
            <Card size="small" title="不良趋势(按日)">
              {trend.length ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trend} margin={{ left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="d" fontSize={11} />
                    <YAxis allowDecimals={false} />
                    <RTooltip />
                    <Legend />
                    <Line type="monotone" dataKey="cnt" name="不良次数" stroke="#cf1322" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="reject_qty" name="不良数量" stroke="#fa8c16" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <Empty description="区间内无不良记录" />}
            </Card>
          </Col>
        </Row>

        <Row gutter={16} style={{ marginTop: 16 }}>
          <Col span={12}>
            <Card size="small" title="按设备分布">
              {byEquip.length ? (
                <Table
                  size="small" rowKey="key" dataSource={byEquip} pagination={false}
                  columns={[{ title: '设备', dataIndex: 'key' }, { title: '关联不良次数', dataIndex: 'cnt', width: 120 }]}
                />
              ) : <Empty description="无数据(设备追溯依赖报工记录)" />}
            </Card>
          </Col>
          <Col span={12}>
            <Card size="small" title="按检验员分布">
              {byPerson.length ? (
                <Table
                  size="small" rowKey="key" dataSource={byPerson} pagination={false}
                  columns={[{ title: '检验员', dataIndex: 'key' }, { title: '判定不良次数', dataIndex: 'cnt', width: 120 }]}
                />
              ) : <Empty description="无数据" />}
            </Card>
          </Col>
        </Row>

        <Card size="small" title="明细 TOP 表格" style={{ marginTop: 16 }}>
          <Table size="small" rowKey="reject_reason" dataSource={top} columns={topColumns} pagination={false} />
        </Card>
      </Spin>
    </Card>
  );
};

export default FabDefects;
