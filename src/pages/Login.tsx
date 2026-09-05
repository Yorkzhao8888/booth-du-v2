import React, { useState } from 'react';
import { Card, Form, Input, Button, Typography, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';

const { Title } = Typography;

const Login: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const onFinish = async (values: { phone: string; password: string }) => {
    setLoading(true);
    try {
      await login(values.phone, values.password);
      const user = useAuthStore.getState().user;
      if (user) {
        const home: Record<string, string> = { dm: '/dm', du: '/du', dx: '/du', dxx: '/dxx', ex: '/ex', exx: '/exx', em: '/em' };
        navigate(home[user.role] || '/login', { replace: true });
      }
    } catch (err: unknown) {
      const e = err as { error?: string };
      message.error(e.error || '登录失败，请检查手机号和密码');
    } finally {
      setLoading(false);
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
          {/* [OAS-DEV-TOKEN] 开发期临时令牌入口占位（仅 DEV 渲染，生产不输出 DOM）。
              OAS POST /api/v1/auth/dev-token 接口定型后按正式接入单实施：
              1) 调 OAS dev-token 生成后写入本地登录态/填入令牌框; 2) 或跳 OAS /login?mode=dev-token&redirect= 回跳。
              Booth 侧不自行实现签发逻辑。 */}
          {import.meta.env.DEV && (
            <Form.Item style={{ marginTop: 12, marginBottom: 0 }}>
              <Button
                type="dashed"
                block
                disabled
                title="OAS dev-token 接口定型后启用（等待正式接入单）"
              >
                生成临时令牌（DEV）
              </Button>
            </Form.Item>
          )}
        </Form>
      </Card>
    </div>
  );
};

export default Login;
