import React from 'react';
import { Card, Typography, Steps, Tag, Alert, Space } from 'antd';
import { UserOutlined, CrownOutlined, ShopOutlined, TeamOutlined, ToolOutlined, CarryOutOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../store';

const { Title, Text, Paragraph } = Typography;

interface RoleInfo {
  key: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}

const roleHierarchy: RoleInfo[] = [
  { key: 'dm', title: 'DM 运营', description: '运营总览，全域只读穿透', icon: <CrownOutlined />, color: '#722ed1' },
  { key: 'du', title: 'DU 店主', description: '全价决策层，经营决策', icon: <ShopOutlined />, color: '#1890ff' },
  { key: 'dx', title: 'DX 店长', description: '全价管理层，日常运营', icon: <TeamOutlined />, color: '#13c2c2' },
  { key: 'dxx', title: 'DXX 店员', description: '一线经营，售价可见', icon: <UserOutlined />, color: '#52c41a' },
  { key: 'ex', title: 'EX 铺长', description: 'MKT-DU 操作者，零价', icon: <ToolOutlined />, color: '#fa8c16' },
  { key: 'dexx', title: 'DEXX 铺员', description: 'WH/FAB/DL/SVC 执行，零价', icon: <CarryOutOutlined />, color: '#eb2f96' },
];

const OrgChart: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const currentRole = user?.role || '';

  const currentIndex = roleHierarchy.findIndex((r) => r.key === currentRole);

  return (
    <div>
      <Title level={4}>组织架构</Title>
      <Paragraph type="secondary">
        六层组织链：DM 运营 → DU 店主 → DX 店长 → DXX 店员 → EX 铺长 → DEXX 铺员
      </Paragraph>

      <Card style={{ marginBottom: 24 }}>
        <Title level={5}>组织层级</Title>
        <Steps
          direction="vertical"
          current={currentIndex}
          items={roleHierarchy.map((role, index) => ({
            title: (
              <Space>
                {role.icon}
                <Text strong={role.key === currentRole}>{role.title}</Text>
                {role.key === currentRole && <Tag color={role.color}>当前角色</Tag>}
              </Space>
            ),
            description: (
              <div>
                <Text type="secondary">{role.description}</Text>
                {index < currentIndex && <Tag color="green" style={{ marginLeft: 8 }}>上级</Tag>}
                {index > currentIndex && <Tag color="default" style={{ marginLeft: 8 }}>下级</Tag>}
              </div>
            ),
            status: index <= currentIndex ? 'finish' : 'wait',
          }))}
        />
      </Card>

      <Card>
        <Title level={5}>价格可见性矩阵</Title>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
              <th style={{ padding: '12px 8px', textAlign: 'left' }}>角色</th>
              <th style={{ padding: '12px 8px', textAlign: 'center' }}>售价</th>
              <th style={{ padding: '12px 8px', textAlign: 'center' }}>采购价</th>
              <th style={{ padding: '12px 8px', textAlign: 'center' }}>毛利</th>
              <th style={{ padding: '12px 8px', textAlign: 'center' }}>写权限</th>
            </tr>
          </thead>
          <tbody>
            {roleHierarchy.map((role) => (
              <tr key={role.key} style={{ borderBottom: '1px solid #f0f0f0', background: role.key === currentRole ? '#f6ffed' : undefined }}>
                <td style={{ padding: '12px 8px' }}>
                  <Space>
                    {role.icon}
                    <Text strong={role.key === currentRole}>{role.title}</Text>
                  </Space>
                </td>
                <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                  {['dm', 'du', 'dx', 'dxx'].includes(role.key) ? <Tag color="green">可见</Tag> : <Tag color="red">不可见</Tag>}
                </td>
                <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                  {['dm', 'du', 'dx'].includes(role.key) ? <Tag color="green">可见</Tag> : <Tag color="red">不可见</Tag>}
                </td>
                <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                  {['dm', 'du', 'dx'].includes(role.key) ? <Tag color="green">可见</Tag> : <Tag color="red">不可见</Tag>}
                </td>
                <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                  {role.key === 'dm' ? <Tag color="orange">只读</Tag> : <Tag color="green">读写</Tag>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
};

export default OrgChart;
