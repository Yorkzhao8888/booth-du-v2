import React, { useEffect, useState, useCallback } from 'react';
import { Card, Table, Tag, Progress, Statistic, Row, Col, Alert } from 'antd';
import { DashboardOutlined } from '@ant-design/icons';
import { api } from '../../api';

const resourceTypeMap: Record<string, string> = {
  line: '产线',
  station: '工位',
  labor: '人力',
};

const DexCapacityQuery: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/dex/capacity/overview');
      setData(res);
    } catch (e) { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const items = data?.items || [];
  const summary = data?.summary || {};

  const columns = [
    { title: '资源编码', dataIndex: 'resource_code', width: 120 },
    { title: '资源名称', dataIndex: 'resource_name', width: 140 },
    { title: '类型', dataIndex: 'resource_type', width: 80, render: (v: string) => resourceTypeMap[v] || v },
    { title: '日产能', dataIndex: 'daily_capacity', width: 90 },
    { title: '7日负荷', dataIndex: 'total_load_7d', width: 90 },
    {
      title: '负荷率(7日)', dataIndex: 'load_rate_7d', width: 180,
      render: (v: number) => (
        <Progress percent={v} size="small" status={v >= 90 ? 'exception' : v >= 70 ? 'active' : 'success'} />
      ),
    },
    { title: '剩余(7日)', dataIndex: 'remaining_7d', width: 90 },
  ];

  return (
    <Card title={<span><DashboardOutlined /> 产能负荷概览</span>}>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Statistic title="活跃资源数" value={summary.total_resources || 0} />
        </Col>
        <Col span={6}>
          <Statistic title="7日总产能" value={summary.total_capacity_7d || 0} />
        </Col>
        <Col span={6}>
          <Statistic title="7日已占用" value={summary.total_load_7d || 0} />
        </Col>
        <Col span={6}>
          <Statistic title="综合负荷率" value={summary.overall_load_rate || 0} suffix="%" valueStyle={{ color: (summary.overall_load_rate || 0) >= 80 ? '#cf1322' : '#3f8600' }} />
        </Col>
      </Row>

      {items.length === 0 ? (
        <Alert message="暂无产能资源数据" description="EM 尚未配置产能资源，请联系供给运营长。" type="info" showIcon />
      ) : (
        <Table dataSource={items} columns={columns} rowKey="id" loading={loading} pagination={false} scroll={{ x: 900 }} />
      )}
    </Card>
  );
};

export default DexCapacityQuery;
