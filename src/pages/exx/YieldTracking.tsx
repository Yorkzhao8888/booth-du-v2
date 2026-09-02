import { useEffect, useState } from 'react';
import { Card, Table, Tag, Button, Modal, Form, Input, InputNumber, Select, message, Row, Col, Statistic, Progress } from 'antd';
import { PlusOutlined, BarChartOutlined } from '@ant-design/icons';
import { api } from '../../api';

interface YieldRecord {
  id: number;
  work_order_id: number;
  production_stage: string;
  input_qty: number;
  good_qty: number;
  defect_qty: number;
  scrap_qty: number;
  yield_rate: number;
  defect_reason: string;
  operator_name: string;
  created_at: string;
}

interface StageStats {
  production_stage: string;
  record_count: number;
  total_input: number;
  total_good: number;
  total_defect: number;
  total_scrap: number;
  avg_yield_rate: number;
}

const STAGE_LABELS: Record<string, string> = {
  preprocessing: '前置工序',
  production: '制作',
  packaging: '包装',
  sorting: '分拣',
};

const STAGE_COLORS: Record<string, string> = {
  preprocessing: 'blue',
  production: 'purple',
  packaging: 'orange',
  sorting: 'green',
};

export default function YieldTracking() {
  const [records, setRecords] = useState<YieldRecord[]>([]);
  const [stats, setStats] = useState<{ byStage: StageStats[]; overall: any }>({ byStage: [], overall: {} });
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [workOrders, setWorkOrders] = useState<any[]>([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes] = await Promise.all([
        api.get<any>('/exx/fab/yield/stats?days=7'),
      ]);
      if (statsRes?.success) {
        setStats(statsRes);
      }

      // Fetch all yield records
      const recordsRes = await api.get<any>('/exx/fab/yield/all');
      if (recordsRes?.success) {
        setRecords(recordsRes.records || []);
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const fetchWorkOrders = async () => {
    try {
      const res = await api.get<any>('/exx/fab/queue?status=in_progress');
      if (res) { // api.ts 解包后 res 即业务数据
        setWorkOrders(res.items || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAdd = async () => {
    try {
      const values = await form.validateFields();
      const res = await api.post<any>('/exx/fab/yield/record', values);
      if (res) { // api.ts 解包后 res 即业务数据
        message.success('记录成功');
        setModalVisible(false);
        form.resetFields();
        fetchData();
      } else {
        message.error(res?.error || '记录失败');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const openModal = () => {
    fetchWorkOrders();
    setModalVisible(true);
  };

  const columns = [
    {
      title: '工单ID',
      dataIndex: 'work_order_id',
      key: 'work_order_id',
      width: 80,
    },
    {
      title: '产线阶段',
      dataIndex: 'production_stage',
      key: 'production_stage',
      render: (stage: string) => <Tag color={STAGE_COLORS[stage]}>{STAGE_LABELS[stage] || stage}</Tag>,
    },
    {
      title: '投入数量',
      dataIndex: 'input_qty',
      key: 'input_qty',
    },
    {
      title: '良品数量',
      dataIndex: 'good_qty',
      key: 'good_qty',
      render: (val: number) => <span style={{ color: '#52c41a' }}>{val}</span>,
    },
    {
      title: '不良品',
      dataIndex: 'defect_qty',
      key: 'defect_qty',
      render: (val: number) => val > 0 ? <span style={{ color: '#faad14' }}>{val}</span> : val,
    },
    {
      title: '报废',
      dataIndex: 'scrap_qty',
      key: 'scrap_qty',
      render: (val: number) => val > 0 ? <span style={{ color: '#ff4d4f' }}>{val}</span> : val,
    },
    {
      title: '良品率',
      dataIndex: 'yield_rate',
      key: 'yield_rate',
      render: (val: number) => {
        const color = val >= 95 ? '#52c41a' : val >= 85 ? '#faad14' : '#ff4d4f';
        return <span style={{ color, fontWeight: 600 }}>{val}%</span>;
      },
    },
    {
      title: '不良原因',
      dataIndex: 'defect_reason',
      key: 'defect_reason',
      ellipsis: true,
    },
    {
      title: '操作员',
      dataIndex: 'operator_name',
      key: 'operator_name',
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val: string) => new Date(val).toLocaleString('zh-CN'),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>良品率追踪</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={openModal}>
          记录良品率
        </Button>
      </div>

      {/* Stats Overview */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="综合良品率"
              value={stats.overall?.yieldRate || 0}
              suffix="%"
              valueStyle={{ color: Number(stats.overall?.yieldRate) >= 95 ? '#52c41a' : '#faad14' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="总投入" value={stats.overall?.totalInput || 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="总良品" value={stats.overall?.totalGood || 0} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="总不良/报废" value={(stats.overall?.totalDefect || 0) + (stats.overall?.totalScrap || 0)} valueStyle={{ color: '#ff4d4f' }} />
          </Card>
        </Col>
      </Row>

      {/* Stage Stats */}
      <Card title="各阶段良品率" style={{ marginBottom: 24 }}>
        <Row gutter={16}>
          {stats.byStage.map((stage) => (
            <Col span={6} key={stage.production_stage}>
              <div style={{ textAlign: 'center', padding: 16 }}>
                <Tag color={STAGE_COLORS[stage.production_stage]} style={{ marginBottom: 8 }}>
                  {STAGE_LABELS[stage.production_stage]}
                </Tag>
                <Progress
                  type="circle"
                  percent={Number(stage.avg_yield_rate)}
                  size={80}
                  strokeColor={Number(stage.avg_yield_rate) >= 95 ? '#52c41a' : Number(stage.avg_yield_rate) >= 85 ? '#faad14' : '#ff4d4f'}
                />
                <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
                  记录 {stage.record_count} 次
                </div>
              </div>
            </Col>
          ))}
          {stats.byStage.length === 0 && (
            <Col span={24}>
              <div style={{ textAlign: 'center', color: '#999', padding: 24 }}>暂无数据</div>
            </Col>
          )}
        </Row>
      </Card>

      {/* Records Table */}
      <Card title="记录明细">
        <Table
          dataSource={records}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          size="small"
        />
      </Card>

      {/* Add Record Modal */}
      <Modal
        title="记录良品率"
        open={modalVisible}
        onOk={handleAdd}
        onCancel={() => { setModalVisible(false); form.resetFields(); }}
        okText="提交"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="workOrderId" label="工单" rules={[{ required: true, message: '请选择工单' }]}>
            <Select placeholder="选择工单">
              {workOrders.map((wo) => (
                <Select.Option key={wo.id} value={wo.id}>
                  {wo.wo_no} - {wo.product_name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="productionStage" label="产线阶段" rules={[{ required: true, message: '请选择阶段' }]}>
            <Select placeholder="选择阶段">
              {Object.entries(STAGE_LABELS).map(([key, label]) => (
                <Select.Option key={key} value={key}>{label}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="inputQty" label="投入数量" rules={[{ required: true, message: '请输入投入数量' }]}>
            <InputNumber min={1} style={{ width: '100%' }} placeholder="投入数量" />
          </Form.Item>
          <Form.Item name="goodQty" label="良品数量" rules={[{ required: true, message: '请输入良品数量' }]}>
            <InputNumber min={0} style={{ width: '100%' }} placeholder="良品数量" />
          </Form.Item>
          <Form.Item name="defectQty" label="不良品数量" initialValue={0}>
            <InputNumber min={0} style={{ width: '100%' }} placeholder="不良品数量" />
          </Form.Item>
          <Form.Item name="scrapQty" label="报废数量" initialValue={0}>
            <InputNumber min={0} style={{ width: '100%' }} placeholder="报废数量" />
          </Form.Item>
          <Form.Item name="defectReason" label="不良原因">
            <Input.TextArea rows={3} placeholder="不良原因说明（可选）" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
