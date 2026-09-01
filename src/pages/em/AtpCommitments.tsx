import React, { useEffect, useState, useCallback } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, InputNumber, DatePicker, message, Descriptions, Alert, Row, Col, Statistic, Tooltip, Divider } from 'antd';
import { CheckOutlined, CloseOutlined, SearchOutlined, CalendarOutlined, ClockCircleOutlined, WarningOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { api } from '../../api';

const statusMap: Record<string, { color: string; label: string }> = {
  pending: { color: 'processing', label: '待确认' },
  confirmed: { color: 'success', label: '已确认' },
  rejected: { color: 'error', label: '已拒绝' },
  expired: { color: 'default', label: '已过期' },
};

// Booth 色板
const BOOTH_COLORS = {
  primary: '#1F3A5F',
  action: '#2F6BFF',
  amber: '#C9A227',
  success: '#16A37B',
  warning: '#D97B1F',
  error: '#C63A3A',
  bgLight: '#F5F7FA',
  textSecondary: '#6B7A8D',
};

// 格式化日期为 MM-DD
const formatDateShort = (dateStr: string): string => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const EmAtpCommitments: React.FC = () => {
  const [commitments, setCommitments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkVisible, setCheckVisible] = useState(false);
  const [checkResult, setCheckResult] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [form] = Form.useForm();

  const fetchCommitments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/em/atp/commitments');
      setCommitments(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchCommitments(); }, [fetchCommitments]);

  const handleCheck = async (values: any) => {
    setChecking(true);
    try {
      const res = await api.post('/em/atp/check', {
        requestedQty: values.requestedQty,
        product: values.product,
        startDate: values.startDate?.format('YYYY-MM-DD'),
      });
      setCheckResult(res);
    } catch (e: any) { message.error(e.message || '校验失败'); }
    setChecking(false);
  };

  const handleCommit = async () => {
    if (!checkResult) return;
    try {
      await api.post('/em/atp/commit', {
        requestedQty: checkResult.requested_qty,
        requestedProduct: checkResult.requested_product,
        atpQty: checkResult.atp_qty,
        earliestDate: checkResult.earliest_date,
        queuePosition: checkResult.queue_position,
      });
      message.success('承诺已记录');
      setCheckVisible(false);
      setCheckResult(null);
      form.resetFields();
      fetchCommitments();
    } catch (e: any) { message.error(e.message || '操作失败'); }
  };

  const handleConfirm = async (id: number) => {
    try {
      await api.post(`/em/atp/commitments/${id}/confirm`);
      message.success('已确认');
      fetchCommitments();
    } catch (e: any) { message.error(e.message || '操作失败'); }
  };

  const handleReject = async (id: number) => {
    try {
      await api.post(`/em/atp/commitments/${id}/reject`, { reason: '产能不足' });
      message.success('已拒绝');
      fetchCommitments();
    } catch (e: any) { message.error(e.message || '操作失败'); }
  };

  // 统计
  const stats = {
    total: commitments.length,
    pending: commitments.filter(c => c.status === 'pending').length,
    confirmed: commitments.filter(c => c.status === 'confirmed').length,
    rejected: commitments.filter(c => c.status === 'rejected').length,
  };

  // 核心列: 可承诺日期 + 队列位置
  const columns = [
    { title: '承诺号', dataIndex: 'commitment_no', width: 150, render: (v: string) => <span className="booth-mono">{v}</span> },
    {
      title: '可承诺交付',
      key: 'promise',
      width: 180,
      render: (_: any, r: any) => {
        const date = r.earliest_date;
        const queuePos = r.queue_position;
        const canFulfill = r.atp_qty >= r.requested_qty;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tooltip title={date ? new Date(date).toLocaleDateString() : '待定'}>
              <Tag
                color={canFulfill ? BOOTH_COLORS.success : BOOTH_COLORS.warning}
                icon={<CalendarOutlined />}
                style={{ margin: 0, fontFamily: 'SFMono-Regular, JetBrains Mono, monospace' }}
              >
                {date ? formatDateShort(date) : '待定'}
              </Tag>
            </Tooltip>
            {queuePos && queuePos > 0 && (
              <Tooltip title={`排队位置 #${queuePos}`}>
                <span style={{ color: BOOTH_COLORS.amber, fontFamily: 'SFMono-Regular, JetBrains Mono, monospace', fontSize: 12 }}>
                  #{queuePos}
                </span>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      title: '需求/可承诺',
      key: 'qty',
      width: 120,
      render: (_: any, r: any) => (
        <span className="booth-mono">
          <span>{r.requested_qty}</span>
          <span style={{ color: BOOTH_COLORS.textSecondary }}> / </span>
          <span style={{ color: r.atp_qty >= r.requested_qty ? BOOTH_COLORS.success : BOOTH_COLORS.warning }}>{r.atp_qty}</span>
        </span>
      ),
    },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={statusMap[v]?.color}>{statusMap[v]?.label || v}</Tag> },
    { title: '创建时间', dataIndex: 'created_at', width: 140, render: (v: string) => <span className="booth-mono" style={{ fontSize: 12 }}>{new Date(v).toLocaleString()}</span> },
    {
      title: '操作', key: 'action', width: 140,
      render: (_: any, r: any) => r.status === 'pending' ? (
        <Space>
          <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => handleConfirm(r.id)}>确认</Button>
          <Button size="small" danger icon={<CloseOutlined />} onClick={() => handleReject(r.id)}>拒绝</Button>
        </Space>
      ) : null,
    },
  ];

  return (
    <div>
      {/* 顶部统计 */}
      <Card style={{ marginBottom: 16, background: `linear-gradient(135deg, ${BOOTH_COLORS.primary} 0%, #2D4A7A 100%)`, border: 'none' }}>
        <Row gutter={24}>
          <Col span={6}>
            <Statistic
              title={<span style={{ color: 'rgba(255,255,255,0.7)' }}>承诺总数</span>}
              value={stats.total}
              valueStyle={{ color: '#fff', fontFamily: 'SFMono-Regular, JetBrains Mono, monospace' }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title={<span style={{ color: 'rgba(255,255,255,0.7)' }}>待确认</span>}
              value={stats.pending}
              valueStyle={{ color: BOOTH_COLORS.action, fontFamily: 'SFMono-Regular, JetBrains Mono, monospace' }}
              prefix={<ClockCircleOutlined />}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title={<span style={{ color: 'rgba(255,255,255,0.7)' }}>已确认</span>}
              value={stats.confirmed}
              valueStyle={{ color: BOOTH_COLORS.success, fontFamily: 'SFMono-Regular, JetBrains Mono, monospace' }}
              prefix={<CheckCircleOutlined />}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title={<span style={{ color: 'rgba(255,255,255,0.7)' }}>已拒绝</span>}
              value={stats.rejected}
              valueStyle={{ color: BOOTH_COLORS.error, fontFamily: 'SFMono-Regular, JetBrains Mono, monospace' }}
              prefix={<CloseCircleOutlined />}
            />
          </Col>
        </Row>
      </Card>

      <Card
        title="ATP 交期承诺"
        extra={<Button type="primary" icon={<SearchOutlined />} onClick={() => setCheckVisible(true)}>产能校验</Button>}
      >
        <Table
          dataSource={commitments}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 15 }}
          scroll={{ x: 900 }}
        />
      </Card>

      <Modal
        title="ATP 产能校验"
        open={checkVisible}
        onCancel={() => { setCheckVisible(false); setCheckResult(null); }}
        footer={null}
        width={640}
      >
        <Form form={form} layout="vertical" onFinish={handleCheck}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="requestedQty" label="需求数量" rules={[{ required: true }]}>
                <InputNumber min={1} style={{ width: '100%' }} placeholder="输入需求数量" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="product" label="产品">
                <Input placeholder="产品名称/SKU" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="startDate" label="期望交付日期">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={checking} block>校验产能</Button>
          </Form.Item>
        </Form>

        {checkResult && (
          <div style={{ marginTop: 16 }}>
            <Divider style={{ margin: '16px 0' }} />
            
            {/* 精确反馈: 可承诺日期 + 排队位置 */}
            <div style={{
              padding: 16,
              background: checkResult.can_fulfill ? '#F6FFED' : '#FFFBE6',
              border: `1px solid ${checkResult.can_fulfill ? BOOTH_COLORS.success : BOOTH_COLORS.warning}`,
              borderRadius: 8,
              marginBottom: 16,
            }}>
              <Row gutter={16} align="middle">
                <Col flex="auto">
                  <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
                    {checkResult.can_fulfill ? (
                      <CheckCircleOutlined style={{ color: BOOTH_COLORS.success, marginRight: 8 }} />
                    ) : (
                      <WarningOutlined style={{ color: BOOTH_COLORS.warning, marginRight: 8 }} />
                    )}
                    {checkResult.can_fulfill ? '产能充足，可承诺交付' : '产能不足，需排队等待'}
                  </div>
                  <div style={{ display: 'flex', gap: 24, fontSize: 13 }}>
                    <div>
                      <span style={{ color: BOOTH_COLORS.textSecondary }}>最早可交付: </span>
                      <span className="booth-mono" style={{ fontWeight: 600, color: checkResult.can_fulfill ? BOOTH_COLORS.success : BOOTH_COLORS.warning }}>
                        {checkResult.earliest_date ? new Date(checkResult.earliest_date).toLocaleDateString() : '待定'}
                      </span>
                    </div>
                    {checkResult.queue_position && checkResult.queue_position > 0 && (
                      <div>
                        <span style={{ color: BOOTH_COLORS.textSecondary }}>排队位置: </span>
                        <span className="booth-mono" style={{ fontWeight: 600, color: BOOTH_COLORS.amber }}>
                          #{checkResult.queue_position}
                        </span>
                      </div>
                    )}
                  </div>
                </Col>
              </Row>
            </div>

            {/* 详细数据 */}
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="需求量">
                <span className="booth-mono">{checkResult.requested_qty}</span>
              </Descriptions.Item>
              <Descriptions.Item label="可承诺量(ATP)">
                <span className="booth-mono" style={{ color: checkResult.atp_qty >= checkResult.requested_qty ? BOOTH_COLORS.success : BOOTH_COLORS.warning }}>
                  {checkResult.atp_qty}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="日产能">
                <span className="booth-mono">{checkResult.total_daily_capacity}</span>
              </Descriptions.Item>
              <Descriptions.Item label="当前负荷">
                <span className="booth-mono">{checkResult.total_current_load}</span>
                <span style={{ color: BOOTH_COLORS.textSecondary, marginLeft: 4 }}>({checkResult.overall_load_rate}%)</span>
              </Descriptions.Item>
            </Descriptions>

            {checkResult.can_fulfill && (
              <div style={{ marginTop: 16, textAlign: 'right' }}>
                <Button type="primary" onClick={handleCommit}>记录承诺</Button>
              </div>
            )}
            {!checkResult.can_fulfill && (
              <Alert
                type="warning"
                showIcon
                message={`当前产能不足，建议排队等待或调配产能。最早可交付日期: ${checkResult.earliest_date ? new Date(checkResult.earliest_date).toLocaleDateString() : '待定'}，排队位置: #${checkResult.queue_position || '-'}`}
                style={{ marginTop: 12 }}
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default EmAtpCommitments;
