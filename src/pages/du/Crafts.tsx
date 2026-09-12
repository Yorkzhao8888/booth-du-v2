/**
 * [BOOTH-PRD-003 / RD-004/005] 研发铺工艺管理
 * - 工艺 CRUD + 有序工序表（N 工序 = N 工单）
 * - 匹配规则: product_name 精确匹配生产单 items[].name（RD-001）
 * - 匹配预览: GET /crafts/match?productName= 展示将拆出的工序链
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Drawer, Form, Input, InputNumber, Modal, Space, Table, Tag, message } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiGet, apiPost, apiPut, apiDelete } from '../../api';
import PageState from '../../components/PageState'; // [W1-E] 三态兜底

interface CraftStep {
  seq: number;
  name: string;
}

interface CraftRow {
  id: number;
  craft_code: string;
  craft_name: string;
  product_name: string;
  steps: CraftStep[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface MatchResp {
  matched: boolean;
  craft?: CraftRow;
  steps?: CraftStep[];
  fallback?: CraftStep[];
}

export default function Crafts() {
  const [rows, setRows] = useState<CraftRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false); // [W1-E]
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CraftRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [matchProductName, setMatchProductName] = useState('');
  const [matchResult, setMatchResult] = useState<MatchResp | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoadError(false); // [W1-E] 重试复位
    setLoading(true);
    try {
      const data = await apiGet<CraftRow[]>('/crafts');
      setRows(Array.isArray(data) ? data : []);
    } catch (e: unknown) { setLoadError(true);
      message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({ craftCode: '', craftName: '', productName: '', steps: [{ seq: 1, name: '' }] });
    setModalOpen(true);
  };

  const openEdit = (r: CraftRow) => {
    setEditing(r);
    form.setFieldsValue({
      craftCode: r.craft_code,
      craftName: r.craft_name,
      productName: r.product_name,
      steps: (r.steps || []).length > 0 ? r.steps : [{ seq: 1, name: '' }],
    });
    setModalOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const steps = (values.steps || [])
      .map((s: CraftStep, i: number) => ({ seq: Number(s.seq) || i + 1, name: String(s.name || '').trim() }))
      .filter((s: CraftStep) => s.name);
    if (steps.length === 0) {
      message.warning('至少填写一道工序');
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await apiPut(`/crafts/${editing.id}`, { craftName: values.craftName, productName: values.productName, steps });
        message.success('工艺已更新');
      } else {
        await apiPost('/crafts', { craftCode: values.craftCode, craftName: values.craftName, productName: values.productName, steps });
        message.success('工艺已创建');
      }
      setModalOpen(false);
      load();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const disable = async (r: CraftRow) => {
    Modal.confirm({
      title: `停用工艺 ${r.craft_name}?`,
      content: '停用后该菜品拆单回退单工序"通用研发", 历史工单不受影响。',
      onOk: async () => {
        try {
          await apiDelete(`/crafts/${r.id}`);
          message.success('已停用');
          load();
        } catch (e: unknown) {
          message.error(e instanceof Error ? e.message : '停用失败');
        }
      },
    });
  };

  const runMatch = async () => {
    if (!matchProductName.trim()) {
      message.warning('请输入菜品名');
      return;
    }
    try {
      const r = await apiGet<MatchResp>(`/crafts/match?productName=${encodeURIComponent(matchProductName.trim())}`);
      setMatchResult(r);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '匹配失败');
    }
  };

  const columns = [
    { title: '工艺编码', dataIndex: 'craft_code', width: 120 },
    { title: '工艺名称', dataIndex: 'craft_name', width: 160 },
    { title: '匹配菜品', dataIndex: 'product_name', width: 160 },
    {
      title: '工序链（N 工序 = N 工单）',
      dataIndex: 'steps',
      render: (steps: CraftStep[] | null) =>
        (steps || []).slice().sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0)).map((s, i) => (
          <Tag key={i} color="geekblue" style={{ marginBottom: 4 }}>
            {s.seq}. {s.name}
          </Tag>
        )),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 90,
      render: (v: boolean) => (v ? <Tag color="success">启用</Tag> : <Tag>已停用</Tag>),
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_: unknown, r: CraftRow) => (
        <Space>
          <Button size="small" type="link" onClick={() => openEdit(r)} disabled={!r.enabled}>编辑</Button>
          <Button size="small" type="link" danger onClick={() => disable(r)} disabled={!r.enabled}>停用</Button>
        </Space>
      ),
    },
  ];

  // [W1-E] 错误兜底: 断网/服务异常 → PageState error + 重试（避免静默白页）
  if (loadError) return <PageState error onRetry={() => void load()} skeletonRows={6} />;

  return (
    <div>
      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        showIcon
        message="研发铺工艺管理：菜品匹配工艺后按工序拆单（RD-001: N 工序 = N 工单）"
        description="生产单下发到研发铺时, 按菜品名精确匹配工艺, 每道工序生成一张工单; 未匹配工艺的菜品回退单工序「通用研发」。"
      />
      <Space style={{ marginBottom: 12 }} wrap>
        <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建工艺</Button>
      </Space>
      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns as never[]}
        dataSource={rows}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
      />
      <Modal
        title={editing ? `编辑工艺 — ${editing.craft_name}` : '新建工艺'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        width={640}
      >
        <Form form={form} layout="vertical">
          <Space style={{ display: 'flex' }} size={12}>
            <Form.Item name="craftCode" label="工艺编码" rules={[{ required: true, message: '必填' }]} style={{ width: 180 }}>
              <Input placeholder="如 CRAFT-001" disabled={!!editing} />
            </Form.Item>
            <Form.Item name="craftName" label="工艺名称" rules={[{ required: true, message: '必填' }]} style={{ width: 200 }}>
              <Input placeholder="如 标准研发工艺" />
            </Form.Item>
            <Form.Item name="productName" label="匹配菜品" rules={[{ required: true, message: '必填' }]} style={{ width: 200 }}>
              <Input placeholder="精确匹配生产单品项名" />
            </Form.Item>
          </Space>
          <Form.List name="steps">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} style={{ display: 'flex' }} align="baseline">
                    <Form.Item name={[field.name, 'seq']} label="序号" style={{ width: 90 }}>
                      <InputNumber min={1} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'name']} label="工序名" rules={[{ required: true, message: '工序名必填' }]} style={{ width: 300 }}>
                      <Input placeholder="如 需求分析 / 原型研发 / 测试验收" />
                    </Form.Item>
                    <Button type="link" danger onClick={() => remove(field.name)} disabled={fields.length <= 1}>
                      删除
                    </Button>
                  </Space>
                ))}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ seq: fields.length + 1, name: '' })}>
                  添加工序
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
      <Drawer
        title="工艺匹配预览（RD-001 拆单依据）"
        width={480}
        open={matchOpen}
        onClose={() => setMatchOpen(false)}
      >
        <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
          <Input placeholder="输入菜品名" value={matchProductName} onChange={(e) => setMatchProductName(e.target.value)} onPressEnter={runMatch} />
          <Button type="primary" onClick={runMatch}>匹配</Button>
        </Space.Compact>
        {matchResult && (
          <div>
            {matchResult.matched ? (
              <>
                <Alert type="success" showIcon message={`已匹配工艺: ${matchResult.craft?.craft_name}（${matchResult.craft?.craft_code}）`} style={{ marginBottom: 12 }} />
                <div>拆单工序链（{matchResult.steps?.length || 0} 工序 → {matchResult.steps?.length || 0} 工单）:</div>
                <div style={{ marginTop: 8 }}>
                  {(matchResult.steps || []).map((s, i) => (
                    <Tag key={i} color="geekblue" style={{ marginBottom: 6 }}>{s.seq}. {s.name}</Tag>
                  ))}
                </div>
              </>
            ) : (
              <Alert type="warning" showIcon message="未匹配到工艺, 拆单回退单工序:" description={(matchResult.fallback || []).map((s) => s.name).join(' → ')} />
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
