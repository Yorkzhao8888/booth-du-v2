import React, { useEffect, useState } from 'react';
import { Card, Steps, Form, Input, Button, Radio, Tag, Space, message, Typography, Result, Divider, Spin } from 'antd';
import { CheckCircleOutlined, ThunderboltOutlined, RocketOutlined, ShopOutlined, RightOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../../api';
import { useAuthStore } from '../../store';

const { Title, Text, Paragraph } = Typography;

// [Xfactory-ONBOARDING] 产能模板 (预置 3 行业: 工艺步骤 + 产能字段示例)
export interface CapacityTemplate {
  key: string;
  title: string;
  emoji: string;
  craftName: string;
  productName: string;
  intro: string;
  steps: Array<{ seq: number; name: string; capacity?: string }>;
}

export const CAPACITY_TEMPLATES: CapacityTemplate[] = [
  {
    key: 'food',
    title: '食品加工',
    emoji: '🍱',
    craftName: '演示·卤味工艺',
    productName: '演示·卤味礼盒',
    intro: '适合卤味/烘焙/净菜类：三段产线，产能按工序段统计。',
    steps: [
      { seq: 1, name: '腌制', capacity: '50 盒/日' },
      { seq: 2, name: '卤制', capacity: '200 盒/日' },
      { seq: 3, name: '包装', capacity: '300 盒/日' },
    ],
  },
  {
    key: 'garment',
    title: '服装定制',
    emoji: '👕',
    craftName: '演示·服装工艺',
    productName: '演示·工装套装',
    intro: '适合裁剪/缝制类：四道工序，整烫后质检出厂。',
    steps: [
      { seq: 1, name: '裁剪', capacity: '80 件/日' },
      { seq: 2, name: '缝制', capacity: '60 件/日' },
      { seq: 3, name: '整烫', capacity: '120 件/日' },
      { seq: 4, name: '质检', capacity: '150 件/日' },
    ],
  },
  {
    key: 'electronics',
    title: '电子组装',
    emoji: '🔌',
    craftName: '演示·电子组装工艺',
    productName: '演示·智能控制器',
    intro: '适合 SMT/整机组装类：含老化测试环节，良率可追溯。',
    steps: [
      { seq: 1, name: 'SMT 贴片', capacity: '500 件/日' },
      { seq: 2, name: '组装', capacity: '300 件/日' },
      { seq: 3, name: '老化测试', capacity: '260 件/日' },
      { seq: 4, name: '包装', capacity: '400 件/日' },
    ],
  },
];

export interface OnboardingStatus {
  isEdu: boolean;
  hasRealData: boolean;
  hasOrgProfile: boolean;
  demoActive: boolean;
  demoDataset: { dataset_no: string; seeded_at: string; cleared_at: string | null } | null;
}

const markOnboardingDone = (): void => {
  try {
    localStorage.setItem('booth_onboarding_done', '1');
  } catch {
    /* 隐私模式忽略 */
  }
};

const OnboardingWizard: React.FC = () => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isEdu = !!user && ['du', 'dx', 'dm'].includes(user.role);
  const [current, setCurrent] = useState(0);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('food');
  const [profileForm] = Form.useForm<{ factoryName: string; intro?: string; venue?: string }>();

  useEffect(() => {
    apiGet<OnboardingStatus>('/onboarding/status')
      .then((s) => setStatus(s))
      .catch(() => message.error('开通状态加载失败'));
  }, []);

  if (isEdu === false) {
    return (
      <div style={{ padding: 24 }}>
        <Result
          status="403"
          title="仅 EDU 经营身份可进入开通向导"
          subTitle="个人参与须经 X-Mate 人事铺派岗；想开厂请注册企业主体后以 EDU 身份登录。"
          extra={<Button type="primary" onClick={() => navigate('/quickstart')}>查看快速上手</Button>}
        />
      </div>
    );
  }

  if (!status) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin tip="加载开通状态..." />
      </div>
    );
  }

  // 第一步: 铺信息
  const onSaveProfile = async (): Promise<void> => {
    try {
      const vals = await profileForm.validateFields();
      setSaving(true);
      await apiPost('/onboarding/profile', vals);
      message.success('铺信息已保存');
      setCurrent(1);
    } catch (e: unknown) {
      const err = e as { error?: string };
      if (err?.error) message.error(err.error);
    } finally {
      setSaving(false);
    }
  };

  // 第二步: 应用产能模板
  const onApplyTemplate = async (): Promise<void> => {
    setSaving(true);
    try {
      await apiPost('/onboarding/apply-template', { templateKey: selectedTemplate });
      message.success('产能模板已应用, 可在 工艺管理 中调整');
      setCurrent(2);
    } catch (e: unknown) {
      const err = e as { error?: string };
      message.error(err?.error || '模板应用失败');
    } finally {
      setSaving(false);
    }
  };

  // 第三步: 演示数据灌入 (可选)
  const onSeedDemo = async (): Promise<void> => {
    setSaving(true);
    try {
      await apiPost('/onboarding/seed-demo', {});
      message.success('演示数据已灌入: 一张来源单全闭环 (拆单→波次→履约→回执→结算)');
      markOnboardingDone();
      setCurrent(3);
    } catch (e: unknown) {
      const err = e as { error?: string };
      message.error(err?.error || '演示数据灌入失败');
    } finally {
      setSaving(false);
    }
  };

  const onFinish = (seeded: boolean): void => {
    markOnboardingDone();
    if (seeded) {
      setCurrent(3);
      return;
    }
    message.info('已跳过演示数据, 可随时在演示数据卡中灌入');
    setCurrent(3);
  };

  const tpl = CAPACITY_TEMPLATES.find((t) => t.key === selectedTemplate) || CAPACITY_TEMPLATES[0];

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 14px 40px' }}>
      <Card style={{ borderRadius: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#fff', borderRadius: 8, padding: '4px 10px', fontWeight: 700, fontSize: 13 }}>Xfactory</span>
          <Title level={4} style={{ margin: 0 }}>企业开通向导</Title>
          <Tag color="purple" style={{ marginLeft: 'auto' }}>三步</Tag>
        </div>
        <Text type="secondary">第一次用 Xfactory? 三步把厂开起来, 每一步都可以跳过, 之后可在「演示数据」卡补完成。</Text>

        <Steps
          current={current}
          style={{ margin: '22px 0 26px' }}
          items={[
            { title: '铺信息', icon: <ShopOutlined /> },
            { title: '产能模板', icon: <RocketOutlined /> },
            { title: '演示数据', icon: <ThunderboltOutlined /> },
          ]}
        />

        {current === 0 && (
          <div>
            <Paragraph type="secondary" style={{ marginTop: 0 }}>填写厂的基本信息, 会显示在工作台与履约时间线上。</Paragraph>
            <Form form={profileForm} layout="vertical" initialValues={{ factoryName: status.hasOrgProfile ? undefined : undefined }}>
              <Form.Item name="factoryName" label="厂名" rules={[{ required: true, message: '请填写厂名' }]}>
                <Input placeholder="如: 知味食品制造厂" maxLength={40} />
              </Form.Item>
              <Form.Item name="intro" label="简介">
                <Input.TextArea placeholder="一句话介绍你的厂 (选填)" rows={3} maxLength={200} />
              </Form.Item>
              <Form.Item name="venue" label="所在场地">
                <Input placeholder="如: 知味生态园 A2 栋 (选填)" maxLength={60} />
              </Form.Item>
            </Form>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Button onClick={() => { markOnboardingDone(); navigate('/du'); }}>跳过向导</Button>
              <Button type="primary" loading={saving} onClick={() => { void onSaveProfile(); }}>
                保存并下一步 <RightOutlined />
              </Button>
            </Space>
          </div>
        )}

        {current === 1 && (
          <div>
            <Paragraph type="secondary" style={{ marginTop: 0 }}>选一个接近你行业的产能模板 (含工艺步骤与产能字段示例), 应用后可在「工艺管理」中修改; 也可以先跳过。</Paragraph>
            <Radio.Group
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value as string)}
              style={{ width: '100%' }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
                {CAPACITY_TEMPLATES.map((t) => (
                  <Card
                    key={t.key}
                    size="small"
                    hoverable
                    onClick={() => setSelectedTemplate(t.key)}
                    style={{ borderRadius: 10, border: selectedTemplate === t.key ? '2px solid #667eea' : '1px solid #eee' }}
                  >
                    <Radio value={t.key} style={{ display: 'none' }} />
                    <div style={{ fontSize: 22 }}>{t.emoji}</div>
                    <div style={{ fontWeight: 600, margin: '4px 0' }}>{t.title}</div>
                    <div style={{ fontSize: 12, color: '#888', minHeight: 32 }}>{t.intro}</div>
                    <Divider style={{ margin: '8px 0' }} />
                    {t.steps.map((s) => (
                      <div key={s.seq} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#555' }}>
                        <span>{s.seq}. {s.name}</span>
                        <span style={{ color: '#999' }}>{s.capacity}</span>
                      </div>
                    ))}
                  </Card>
                ))}
              </div>
            </Radio.Group>
            <div style={{ marginTop: 10, fontSize: 12, color: '#999' }}>
              将创建工艺: {tpl.craftName} (产品 {tpl.productName}, {tpl.steps.length} 道工序)
            </div>
            <Space style={{ width: '100%', justifyContent: 'space-between', marginTop: 14 }}>
              <Button onClick={() => setCurrent(0)}><RightOutlined rotate={180} /> 上一步</Button>
              <Space>
                <Button onClick={() => { message.info('已跳过模板, 可之后在 工艺管理 手动配置'); setCurrent(2); }}>跳过</Button>
                <Button type="primary" loading={saving} onClick={() => { void onApplyTemplate(); }}>
                  应用模板 <RightOutlined />
                </Button>
              </Space>
            </Space>
          </div>
        )}

        {current === 2 && (
          <div>
            <Paragraph type="secondary" style={{ marginTop: 0 }}>
              可选: 灌入一套业务自洽的演示数据 (1 张来源单全闭环: 拆单 → 波次 → 履约四节点 → G-005 回执 → 结算)。
              演示数据带 <Tag color="orange" style={{ margin: 0 }}>DEMO-</Tag> 前缀, 与真实账严格区分, 可一键清空。
            </Paragraph>
            {status.demoActive ? (
              <Card size="small" style={{ background: '#fffbe6', borderRadius: 10, marginBottom: 12 }}>
                <Space>
                  <CheckCircleOutlined style={{ color: '#faad14' }} />
                  <span>已有演示数据批次 <b>{status.demoDataset?.dataset_no ?? '-'}</b> (幂等保护, 不重复灌入)</span>
                </Space>
              </Card>
            ) : null}
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Button onClick={() => setCurrent(1)}><RightOutlined rotate={180} /> 上一步</Button>
              <Space>
                <Button onClick={() => onFinish(false)}>跳过</Button>
                <Button type="primary" loading={saving} disabled={status.demoActive} icon={<ThunderboltOutlined />} onClick={() => { void onSeedDemo(); }}>
                  {status.demoActive ? '已灌入' : '灌入演示数据'}
                </Button>
              </Space>
            </Space>
          </div>
        )}

        {current === 3 && (
          <Result
            status="success"
            title="开通完成!"
            subTitle="你现在可以回到工作台, 在「演示数据」卡里随时灌入/清空演示数据; 演示履约可在「订单履约」时间线查看四节点。"
            extra={
              <Space>
                <Button type="primary" onClick={() => navigate('/du')}>进入工作台</Button>
                <Button onClick={() => navigate('/quickstart')}>查看快速上手</Button>
              </Space>
            }
          />
        )}
      </Card>
    </div>
  );
};

export default OnboardingWizard;
