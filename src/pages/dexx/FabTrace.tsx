import React, { useState } from 'react';
import { Card, Input, Button, Tag, Timeline, Alert, Descriptions, Table, Space, Typography, Empty, Spin } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { api } from '../../api';

const { Text } = Typography;

const STATUS_COLOR: Record<string, string> = { pass: 'green', pending: 'orange', hold: 'gold', reject: 'red', fail: 'red' };

const FabTrace: React.FC = () => {
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string>('');

  const doQuery = async (kw?: string) => {
    const q = (kw ?? keyword).trim();
    if (!q) return;
    setLoading(true);
    setErr('');
    try {
      const isWoId = /^\d+$/.test(q) || /^WO\d+$/i.test(q);
      const body = isWoId ? { work_order_id: Number(q.replace(/^WO/i, '')) } : { batch_no: q };
      const res: any = await api.post('/dexx/fab/trace/query', body);
      setData(res);
    } catch (e: any) {
      setData(null);
      setErr(e.message || '查询失败');
    }
    setLoading(false);
  };

  const renderChain = () => {
    if (!data) return null;
    if (data.kind === 'not_found') {
      return <Empty description={`未找到批次 ${data.batch_no}（成品批次或原料批次均无记录）`} />;
    }
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {data.batch && (
          <Card size="small" title={
            <Space>
              <Tag color={data.batch.batch_kind === 'output' ? 'blue' : 'purple'}>
                {data.batch.batch_kind === 'output' ? '成品批次' : '原料批次'}
              </Tag>
              <Text strong>{data.batch.batch_no}</Text>
              {data.batch.quality_status && <Tag color={STATUS_COLOR[data.batch.quality_status] || 'default'}>{data.batch.quality_status}</Tag>}
            </Space>
          }>
            <Descriptions column={3} size="small">
              {data.batch.batch_kind === 'output' ? (
                <>
                  <Descriptions.Item label="产品">{data.batch.product_name}</Descriptions.Item>
                  <Descriptions.Item label="数量">{String(data.batch.qty)}</Descriptions.Item>
                  <Descriptions.Item label="工单">#{data.batch.work_order_id}</Descriptions.Item>
                </>
              ) : (
                <>
                  <Descriptions.Item label="物料">{data.batch.sku_name || data.batch.sku_id}</Descriptions.Item>
                  <Descriptions.Item label="余量">{String(data.batch.qty)}</Descriptions.Item>
                  <Descriptions.Item label="到货">{data.batch.received_at ? new Date(data.batch.received_at).toLocaleString() : '-'}</Descriptions.Item>
                </>
              )}
            </Descriptions>
          </Card>
        )}

        {data.batch?.batch_kind === 'material' && (data.downstream || []).length > 0 && (
          <Card size="small" title="正向追溯 · 该批料流入的成品">
            <Table
              size="small"
              rowKey={(r: any) => `${r.work_order_id}-${r.output_batch_no}`}
              dataSource={data.downstream}
              pagination={false}
              columns={[
                { title: '工单', dataIndex: 'work_order_id', width: 80, render: (v: number) => `#${v}` },
                { title: '产品', dataIndex: 'product_name' },
                { title: '成品批次', dataIndex: 'output_batch_no' },
                { title: '数量', dataIndex: 'qty', width: 90 },
                { title: '质量状态', dataIndex: 'quality_status', width: 100, render: (v: string) => <Tag color={STATUS_COLOR[v] || 'default'}>{v}</Tag> },
              ]}
            />
          </Card>
        )}

        {(data.gaps || []).length > 0 && (
          <Alert type="warning" showIcon message="追溯链数据缺口" description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {data.gaps.map((g: string, i: number) => <li key={i}>{g}</li>)}
            </ul>
          } />
        )}

        {(data.chain || []).map((c: any) => (
          <Card size="small" key={c.work_order.id} title={
            <Space>
              <Text strong>工单 #{c.work_order.id}</Text>
              <Text type="secondary">{c.work_order.product_name}</Text>
              <Tag>{c.work_order.status}</Tag>
              <Tag>数量 {String(c.work_order.qty)}</Tag>
            </Space>
          }>
            <Timeline
              items={[
                ...(c.consumed || []).map((cm: any, i: number) => ({
                  color: 'purple',
                  children: (
                    <Space direction="vertical" size={0}>
                      <Text strong>领料{i + 1}: {cm.batch_no || '未知批次'} × {String(cm.qty)}</Text>
                      <Text type="secondary">{cm.sku_name || ''} · {cm.created_at ? new Date(cm.created_at).toLocaleString() : '-'}</Text>
                    </Space>
                  ),
                })),
                ...(c.operations || []).map((o: any, i: number) => ({
                  color: 'blue',
                  children: (
                    <Space direction="vertical" size={0}>
                      <Text strong>报工{i + 1}: {o.name || `工序${o.seq}`} · {o.reported_qty ?? '-'}</Text>
                      <Text type="secondary">操作员 {o.operator_name || '-'} · 设备 {o.equipment_code || '无'} · {o.completed_at ? new Date(o.completed_at).toLocaleString() : '-'}</Text>
                    </Space>
                  ),
                })),
                ...(c.qc || []).map((q: any, i: number) => ({
                  color: q.result === 'pass' ? 'green' : q.result === 'hold' ? 'gold' : 'red',
                  children: (
                    <Space direction="vertical" size={0}>
                      <Space size={4}>
                        <Text strong>质检{i + 1}: {q.check_type || 'fqc'}{q.stage ? `(${q.stage})` : ''}</Text>
                        <Tag color={STATUS_COLOR[q.result] || 'default'}>{q.result}</Tag>
                      </Space>
                      <Text type="secondary">
                        {q.qty_pass ?? '-'} 合格 / {q.qty_reject ?? '-'} 不良{q.reject_reason ? ` · ${q.reject_reason}` : ''} · {q.inspector_name || '-'} · {q.checked_at ? new Date(q.checked_at).toLocaleString() : '-'}
                      </Text>
                    </Space>
                  ),
                })),
                ...(c.output_batches || []).map((ob: any) => ({
                  color: ob.quality_status === 'pass' ? 'green' : ob.quality_status === 'reject' ? 'red' : 'gold',
                  children: (
                    <Space direction="vertical" size={0}>
                      <Space size={4}>
                        <Text strong>产出批次: {ob.batch_no}</Text>
                        <Tag color={STATUS_COLOR[ob.quality_status] || 'default'}>{ob.quality_status}</Tag>
                      </Space>
                      <Text type="secondary">数量 {String(ob.qty)} · {ob.created_at ? new Date(ob.created_at).toLocaleString() : '-'}</Text>
                    </Space>
                  ),
                })),
                { color: 'gray', children: <Text type="secondary">发货 · 追溯未接入</Text> },
              ]}
            />
          </Card>
        ))}
      </Space>
    );
  };

  return (
    <Card
      title="追溯查询"
      extra={
        <Space.Compact style={{ width: 360 }}>
          <Input
            placeholder="输入批次号(如 OUT-WO1-xxx / 原料批次号)或工单号"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => doQuery()}
            allowClear
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={() => doQuery()}>追溯</Button>
        </Space.Compact>
      }
    >
      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 16 }} />}
      {loading ? <div style={{ textAlign: 'center', padding: 48 }}><Spin tip="追溯链检索中..." /></div> : data ? renderChain() : (
        <Empty description="输入批次号或工单号开始追溯：成品批次反向追溯到原料/人员/设备，原料批次正向查流入成品" />
      )}
    </Card>
  );
};

export default FabTrace;
