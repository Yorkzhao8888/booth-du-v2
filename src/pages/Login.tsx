import React, { useState } from 'react';
import { Card, Form, Input, Button, Typography, message, Select, InputNumber, Space, Divider } from 'antd';
import { UserOutlined, LockOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, type AuthUser } from '../store';
import { apiPost } from '../api';

const { Title } = Typography;

/** [AUTH-02] OAS dev-token 参考角色 (OAS 侧角色名, claims 与正式登录一致) */
const DEV_TOKEN_ROLES = ['admin', 'operator', 'customer', 'viewer', 'em', 'OFM', 'OVM', 'OGM', 'OAM', '13U'] as const;

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
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const applySession = useAuthStore((s) => s.applySession);

  const goHome = (role: string) => {
    const home: Record<string, string> = { dm: '/dm', du: '/du', dx: '/du', dxx: '/dxx', ex: '/ex', exx: '/exx', em: '/em' };
    navigate(home[role] || '/login', { replace: true });
  };

  const onFinish = async (values: { phone: string; password: string }) => {
    setLoading(true);
    try {
      await login(values.phone, values.password);
      const user = useAuthStore.getState().user;
      if (user) goHome(user.role);
    } catch (err: unknown) {
      const e = err as { error?: string };
      message.error(e.error || '登录失败，请检查手机号和密码');
    } finally {
      setLoading(false);
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
            Booth 铺子系统
          </Title>
          <span style={{ color: '#999' }}>请登录您的账号</span>
        </div>
        <Form name="login" onFinish={onFinish} size="large" autoComplete="off">
          <Form.Item name="phone" rules={[{ required: true, message: '请输入手机号' }]}>
            <Input prefix={<UserOutlined />} placeholder="手机号" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" loading={loading} block>
              登录
            </Button>
          </Form.Item>
        </Form>
        {/* [AUTH-02] 开发期临时令牌入口 —— 仅 DEV 构建渲染 (生产 tree-shake 移除, 不输出 DOM)。
            流程: 代理 OAS POST /api/v1/auth/dev-token → Booth 本地 RS256 验签+角色映射 → 写入本地登录态免复制。
            Booth 侧不自行实现签发逻辑。 */}
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
              type="dashed"
              icon={<ThunderboltOutlined />}
              block
              style={{ marginTop: 10 }}
              loading={devLoading}
              onClick={onGenDevToken}
            >
              生成临时令牌并登录（DEV）
            </Button>
          </>
        )}
      </Card>
    </div>
  );
};

export default Login;
