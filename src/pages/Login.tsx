import React, { useEffect, useState } from 'react';
import { Card, Form, Input, Button, Typography, message, Select, InputNumber, Space, Divider } from 'antd';
import { UserOutlined, LockOutlined, ThunderboltOutlined, LoginOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, type AuthUser } from '../store';
import { apiGet, apiPost } from '../api';

const { Title } = Typography;

/** [AUTH-02] OAS dev-token 参考角色 (OAS 侧角色名, claims 与正式登录一致) */
const DEV_TOKEN_ROLES = ['admin', 'operator', 'customer', 'viewer', 'em', 'OFM', 'OVM', 'OGM', 'OAM', '13U'] as const;

/** [Xfactory-B5] 演示账号一键登录 (内测规则: admin=SU / operator=AU / customer=CU, 密码统一 test123, 走真实 OAS 登录链) */
const DEMO_ACCOUNTS = [
  { username: 'admin', label: '经营者演示', role: 'SU · 经营侧', desc: '经营看板 / 铺子与履约全量' },
  { username: 'operator', label: '执行者演示', role: 'AU · 执行侧', desc: '交付工作台 / 作业执行' },
  { username: 'customer', label: '铺员演示', role: 'CU · 铺员', desc: 'FAB / WH 作业端' },
] as const;

/** [Xfactory-C9] EMBED 免登 origin 白名单 (联调期 * 放行, 联调完成后收紧为 ZiwayDS 域) */
const EMBED_ORIGIN_WHITELIST: string[] = ['*'];
const isEmbedOriginAllowed = (origin: string): boolean =>
  EMBED_ORIGIN_WHITELIST.includes('*') || EMBED_ORIGIN_WHITELIST.includes(origin);

interface DevTokenResp {
  token: string;
  expires_at?: string | null;
  oas?: { username?: string | null; role?: string | null };
  user: AuthUser & { roleKey?: string; identityId?: string };
}

const Login: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [devLoading, setDevLoading] = useState(false);
  const [devRole, setDevRole] = useState<string>('admin');
  const [devMinutes, setDevMinutes] = useState<number>(30);
  const [devUsername, setDevUsername] = useState<string>('');
  const [lockSeconds, setLockSeconds] = useState<number>(0);
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const applySession = useAuthStore((s) => s.applySession);

  // [Xfactory-B4] 锁定剩余秒数倒计时 (固定展示, 不再叠加"越试越锁顺延"语义)
  useEffect(() => {
    if (lockSeconds <= 0) return;
    const timer = setInterval(() => setLockSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [lockSeconds]);

  // [DUAL-PORTAL-P0] 登录成功统一进容器分流页 (#xhpz 个人 / #xepz 企业), 由用户选择端
  const goHome = (_role: string) => {
    navigate('/containers', { replace: true });
  };

  const handleLoginError = (err: unknown, fallback: string) => {
    const e = err as { error?: string; lockSeconds?: number };
    if (e.lockSeconds && e.lockSeconds > 0) {
      setLockSeconds(e.lockSeconds);
      message.warning(e.error || `账号已临时锁定，${e.lockSeconds} 秒后自动解锁`);
    } else {
      message.error(e.error || fallback);
    }
  };

  const onFinish = async (values: { phone: string; password: string }) => {
    if (lockSeconds > 0) return;
    setLoading(true);
    try {
      await login(values.phone, values.password);
      const user = useAuthStore.getState().user;
      if (user) goHome(user.role);
    } catch (err: unknown) {
      handleLoginError(err, '账号或密码不正确');
    } finally {
      setLoading(false);
    }
  };

  // [Xfactory-B5] 演示账号一键登录: 卡片点击即以该账号走真实 OAS 登录链 (admin/operator/customer + test123)
  const onDemoLogin = async (username: string) => {
    if (lockSeconds > 0) return;
    setLoading(true);
    try {
      await login(username, 'test123');
      const user = useAuthStore.getState().user;
      message.success(`演示登录成功（${username}）`);
      if (user) goHome(user.role);
    } catch (err: unknown) {
      handleLoginError(err, '账号或密码不正确');
    } finally {
      setLoading(false);
    }
  };

  // [Xfactory-C9] EMBED 免登钩子预留: 监听 ZiwayDS 嵌入方 postMessage 注入 OAS token,
  // token 经 GET /auth/me 走现有 requireAuth RS256 验签链取回身份后落地, 回执 embed:ready。
  useEffect(() => {
    const handler = async (ev: MessageEvent) => {
      try {
        const data = ev.data as { source?: string; type?: string; token?: string } | null;
        if (!data || data.source !== 'ziway-ds-embed' || data.type !== 'auth:token') return;
        if (typeof data.token !== 'string' || data.token.length < 10) return;
        if (!isEmbedOriginAllowed(ev.origin)) return;
        const me = await apiGet<{ success: boolean; data: { user: AuthUser } }>('/auth/me');
        if (!me?.data?.user) throw new Error('token 校验失败');
        applySession(data.token, me.data.user);
        message.success('嵌入登录成功');
        navigate('/containers', { replace: true });
        (ev.source as Window | null)?.postMessage?.({ source: 'booth', type: 'embed:ready', ok: true }, { targetOrigin: '*' });
      } catch {
        (ev.source as Window | null)?.postMessage?.({ source: 'booth', type: 'embed:ready', ok: false }, { targetOrigin: '*' });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [navigate, applySession]);

  // [DUAL-PORTAL-P0] 一键测试登录: 默认 admin 角色直接生成 dev-token 并进分流页 (开发版验收要求)
  const onQuickLogin = async () => {
    setDevLoading(true);
    try {
      const res = await apiPost<DevTokenResp>('/auth/dev-token', { role: 'admin', expires_minutes: devMinutes });
      applySession(res.token, res.user);
      message.success('一键测试登录成功，进入容器分流');
      navigate('/containers', { replace: true });
    } catch (err: unknown) {
      const e = err as { error?: string };
      message.error(e.error || '一键测试登录失败');
    } finally {
      setDevLoading(false);
    }
  };

  // [AUTH-02] 开发期临时令牌: 代理 OAS POST /api/v1/auth/dev-token (Booth 不自行签发)
  const onGenDevToken = async () => {
    setDevLoading(true);
    try {
      const res = await apiPost<DevTokenResp>('/auth/dev-token', {
        role: devRole,
        expires_minutes: devMinutes,
        ...(devUsername.trim() ? { username: devUsername.trim() } : {}),
      });
      applySession(res.token, res.user);
      message.success(`临时令牌已生成${res.oas?.role ? ` (${res.oas.role})` : ''}${res.expires_at ? `，${new Date(res.expires_at).toLocaleTimeString()} 过期` : ''}`);
      goHome(res.user.role);
    } catch (err: unknown) {
      const e = err as { error?: string; code?: string };
      message.error(e.error || '临时令牌生成失败');
    } finally {
      setDevLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: 16,
      }}
    >
      <Card style={{ width: '100%', maxWidth: 400, borderRadius: 12 }} variant="borderless">
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={3} style={{ marginBottom: 4 }}>
            Xfactory
          </Title>
          <span style={{ color: '#999' }}>制造厂 · 请登录您的账号</span>
        </div>
        <Form name="login" onFinish={onFinish} size="large" autoComplete="off">
          <Form.Item name="phone" rules={[{ required: true, message: '请输入手机号' }]}>
            <Input prefix={<UserOutlined />} placeholder="手机号" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              disabled={lockSeconds > 0}
            >
              {lockSeconds > 0 ? `已锁定，${lockSeconds} 秒后重试` : '登录'}
            </Button>
          </Form.Item>
        </Form>
        {/* [Xfactory-B5] 演示账号一键登录 (内测规则, 卡片式对齐 ZiwayOS 门户账号卡) */}
        <Divider style={{ margin: '16px 0 10px' }}>
          <span style={{ color: '#bbb', fontSize: 12 }}>演示账号 · 内测</span>
        </Divider>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {DEMO_ACCOUNTS.map((a) => (
            <div
              key={a.username}
              onClick={() => !loading && onDemoLogin(a.username)}
              style={{
                border: '1px solid #eee', borderRadius: 10, padding: '8px 12px',
                display: 'flex', alignItems: 'center', gap: 10, cursor: loading ? 'wait' : 'pointer', background: '#fafafa',
              }}
            >
              <span
                style={{
                  width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                  background: 'linear-gradient(135deg, #667eea, #764ba2)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13,
                }}
              >
                {a.label.slice(0, 1)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {a.label}
                  <span style={{ color: '#999', fontWeight: 400, marginLeft: 6, fontSize: 12 }}>{a.role}</span>
                </div>
                <div style={{ fontSize: 12, color: '#999' }}>{a.desc} · {a.username} / test123</div>
              </div>
              <LoginOutlined style={{ color: '#999' }} />
            </div>
          ))}
        </div>
        {/* [AUTH-02] 开发期临时令牌入口 —— 仅 DEV 构建渲染 (生产 tree-shake 移除, 不输出 DOM)。
            流程: 代理 OAS POST /api/v1/auth/dev-token → Xfactory 本地 RS256 验签+角色映射 → 写入本地登录态免复制。
            Xfactory 侧不自行实现签发逻辑。 */}
        {import.meta.env.DEV && (
          <>
            <Divider style={{ margin: '16px 0 12px' }}>
              <span style={{ color: '#bbb', fontSize: 12 }}>开发联调</span>
            </Divider>
            <Space.Compact style={{ width: '100%' }} size="middle">
              <Select
                value={devRole}
                onChange={(v: string) => setDevRole(v)}
                style={{ width: '38%' }}
                options={DEV_TOKEN_ROLES.map((r) => ({ value: r, label: r }))}
                placeholder="OAS 角色"
              />
              <InputNumber
                min={1}
                max={60}
                value={devMinutes}
                onChange={(v) => setDevMinutes(Number(v) || 30)}
                style={{ width: '24%' }}
                addonAfter="min"
              />
              <Input
                value={devUsername}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDevUsername(e.target.value)}
                placeholder="用户名(可选)"
                style={{ width: '38%' }}
              />
            </Space.Compact>
            <Button
              type="primary"
              ghost
              icon={<ThunderboltOutlined />}
              block
              style={{ marginTop: 10 }}
              loading={devLoading}
              onClick={onQuickLogin}
            >
              一键测试登录（DEV）
            </Button>
            <Button
              type="dashed"
              block
              style={{ marginTop: 10 }}
              loading={devLoading}
              onClick={onGenDevToken}
            >
              生成临时令牌并登录（DEV）
            </Button>
          </>
        )}
        {/* [Xfactory-ONBOARDING] 快速上手入口: 三动线帮助页 (免登) */}
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <Button type="link" size="small" icon={<QuestionCircleOutlined />} onClick={() => navigate('/quickstart')}>
            快速上手 · 三条动线指南
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default Login;
