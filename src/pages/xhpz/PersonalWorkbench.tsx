import React from 'react';
import { Card, Col, Row, Tag, Typography, message } from 'antd';
import {
  ArrowRightOutlined,
  ShoppingOutlined,
  ShopOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import { PortalShell } from '../../components/PortalShell';

/**
 * [DUAL-PORTAL-P0 工单三] booth 个人台框架 (#xhpz)
 * 三模块骨架: 我的消费(Mall/Market 订单占位) / 我的接单(服务接单占位) / 我的小铺(个人轻量铺位入口占位)
 * 帽切换复用工单一角色层 (PortalShell 切换角色)
 */

const MODULES = [
  {
    key: 'consume',
    title: '我的消费',
    desc: 'Mall / Market 订单 · 售后进度',
    icon: <ShoppingOutlined />,
    color: '#667eea',
    bg: 'rgba(102,126,234,0.1)',
    extra: 'P1 接订单中心',
  },
  {
    key: 'orders',
    title: '我的接单',
    desc: '服务接单 · 履约进度跟踪',
    icon: <UserSwitchOutlined />,
    color: '#722ed1',
    bg: 'rgba(114,46,209,0.1)',
    extra: 'P1 接接单中心',
  },
  {
    key: 'shop',
    title: '我的小铺',
    desc: '个人轻量铺位 · 一键开店',
    icon: <ShopOutlined />,
    color: '#13c2c2',
    bg: 'rgba(19,194,194,0.1)',
    extra: 'P1 开放入驻',
  },
];

const PersonalWorkbench: React.FC = () => {
  return (
    <PortalShell container="xhpz">
      <Typography.Title level={5} style={{ color: '#fff', margin: '0 0 10px' }}>
        个人工作台
      </Typography.Title>
      <Row gutter={[12, 12]}>
        {MODULES.map((mod) => (
          <Col xs={24} sm={12} key={mod.key}>
            <Card
              hoverable
              style={{ borderRadius: 14 }}
              onClick={() => message.info(`${mod.title} ${mod.extra}, 敬请期待`)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ ...modIconStyle, color: mod.color, background: mod.bg }}>
                  {mod.icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{mod.title}</span>
                    <Tag style={{ marginRight: 0 }} color="default">
                      占位
                    </Tag>
                  </div>
                  <div style={{ fontSize: 12, color: '#999', marginTop: 3 }}>{mod.desc}</div>
                </div>
                <ArrowRightOutlined style={{ color: '#bbb' }} />
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    </PortalShell>
  );
};

const modIconStyle: React.CSSProperties = {
  fontSize: 22,
  borderRadius: 10,
  padding: '8px 10px',
};

export default PersonalWorkbench;
