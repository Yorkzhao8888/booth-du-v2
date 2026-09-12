import React from 'react';
import { Card, Button, Space, Typography, Tag, Divider } from 'antd';
import {
  UserSwitchOutlined,
  ShopOutlined,
  RocketOutlined,
  ThunderboltOutlined,
  TeamOutlined,
  ArrowRightOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const { Title, Text, Paragraph } = Typography;

// [Xfactory-ONBOARDING] 快速上手帮助页: 三动线图文 (体验 / 企业三步开通 / 个人经 X-Mate 派岗)
// 免登页: RequireAuth 放行 /quickstart 前缀; 入口=登录页底部链接 + 应用内 Header 帮助图标
const QuickStart: React.FC = () => {
  const navigate = useNavigate();

  const lanes: Array<{ icon: React.ReactNode; tag: string; color: string; title: string; desc: string; points: string[]; action?: { label: string; onClick: () => void } }> = [
    {
      icon: <ExperimentOutlined />,
      tag: '先体验',
      color: '#667eea',
      title: '10 秒体验系统',
      desc: '登录页提供内测演示账号一键登录, 无需注册即可浏览全系统。',
      points: [
        '经营者 (admin / SU): 经营看板、铺子管理、履约全视角',
        '执行者 (operator / AU): 交付工作台、作业执行视角',
        '铺员 (customer / CU): FAB / WH 作业端视角',
      ],
      action: { label: '去登录页一键体验', onClick: () => navigate('/login') },
    },
    {
      icon: <ShopOutlined />,
      tag: '企业开通',
      color: '#764ba2',
      title: '企业三步开通',
      desc: '以 EDU 经营身份 (DU/店长) 登录, 铺内无业务数据时自动触发向导; 也可在工作台「演示数据」卡随时进入。',
      points: [
        '第一步 填铺信息: 厂名 / 简介 / 所在场地',
        '第二步 选产能模板: 食品 / 服装 / 电子 (工艺步骤 + 产能字段示例, 应用后可在工艺管理调整)',
        '第三步 灌入演示数据 (可选): 一张来源单全闭环——拆单 → 波次 → 履约四节点 → G-005 回执 → 结算',
      ],
      action: undefined,
    },
    {
      icon: <TeamOutlined />,
      tag: '个人参与',
      color: '#c9a227',
      title: '个人经 X-Mate 派岗',
      desc: '个人身份 (CU/GU) 不直接经营企业铺——个人参与须经 X-Mate 人事铺派岗, 派岗后进入企业铺执行端协作。',
      points: [
        '个人可先在 X-Market 集市消费体验 (个人台「逛集市」)',
        '想进企业铺干活: 联系 X-Mate 人事铺完成派岗',
        '想自己开厂: 注册企业主体, 走上方「企业三步开通」',
      ],
    },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: '24px 14px 48px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', color: '#fff', marginBottom: 22 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <span style={{ background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 10, padding: '6px 14px', fontWeight: 700, letterSpacing: 1 }}>Xfactory</span>
            <Tag color="gold" style={{ margin: 0 }}>快速上手包</Tag>
          </div>
          <Title level={3} style={{ color: '#fff', margin: '12px 0 4px' }}>三条动线, 快速把厂用起来</Title>
          <Text style={{ color: 'rgba(255,255,255,0.85)' }}>体验 → 企业开通 → 个人派岗, 每条动线都能独立走通</Text>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 14 }}>
          {lanes.map((lane, i) => (
            <Card key={i} style={{ borderRadius: 14 }} styles={{ body: { padding: 18 } }}>
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                <Space>
                  <span style={{ width: 38, height: 38, borderRadius: 10, background: `${lane.color}1a`, color: lane.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{lane.icon}</span>
                  <Tag color={i === 0 ? 'geekblue' : i === 1 ? 'purple' : 'gold'} style={{ margin: 0 }}>{lane.tag}</Tag>
                </Space>
                <Title level={5} style={{ margin: 0 }}>{lane.title}</Title>
                <Paragraph type="secondary" style={{ margin: 0, fontSize: 12.5 }}>{lane.desc}</Paragraph>
                <Divider style={{ margin: '6px 0' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {lane.points.map((p, j) => (
                    <Space key={j} size={6} align="start">
                      <span style={{ color: lane.color, fontWeight: 700, fontSize: 12 }}>{j + 1}.</span>
                      <Text style={{ fontSize: 12.5 }}>{p}</Text>
                    </Space>
                  ))}
                </div>
                {lane.action ? (
                  <Button type="primary" ghost block style={{ marginTop: 6 }} onClick={lane.action.onClick}>
                    {lane.action.label} <ArrowRightOutlined />
                  </Button>
                ) : (
                  <Button block style={{ marginTop: 6 }} icon={<UserSwitchOutlined />} onClick={() => navigate('/login')}>
                    登录后查看个人引导
                  </Button>
                )}
              </Space>
            </Card>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <Space>
            <Button ghost style={{ color: '#fff' }} onClick={() => navigate('/login')}>
              <ArrowRightOutlined rotate={180} /> 返回登录
            </Button>
            <Button ghost style={{ color: '#fff' }} icon={<ThunderboltOutlined />} onClick={() => navigate('/login')}>
              企业 EDU 登录开通
            </Button>
          </Space>
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 14 }}>
            Xfactory 制造厂 · 供给履约系统 · 演示数据与真实账严格隔离 (DEMO- 标记)
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuickStart;
