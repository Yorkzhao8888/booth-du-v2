import React from 'react';
import { Card, Col, Row, Tag, Typography, message } from 'antd';
import {
  DeploymentUnitOutlined,
  ArrowRightOutlined,
  CarOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  GlobalOutlined,
  ProfileOutlined,
  ShoppingOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { PortalShell } from '../../components/PortalShell';
import { FulfillmentTimeline } from '../../components/FulfillmentTimeline';

/**
 * [DUAL-PORTAL-P0 工单二] booth 企业台框架 (#xepz)
 * 我的铺子聚合骨架 + 经营系统入口区(ERP/Space/Station) + 采购供给入口区(X-Supply)
 * P0 为骨架占位: 铺子数据接口预留 P1 接 Booth 六版本实例; 经营入口 P1 接实链
 */

interface ShopCard {
  key: string;
  name: string;
  hat: string;
  hatColor: string;
  icon: React.ReactNode;
  today: string;
}

/** P0 骨架示意数据 (P1 由 GET 铺子聚合接口替换) */
const SHOPS: ShopCard[] = [
  { key: 'rd', name: '研发铺', hat: 'FAB', hatColor: 'purple', icon: <ExperimentOutlined />, today: '今日 — 单 · — 进行中' },
  { key: 'manufacture', name: '制造铺', hat: 'FAB', hatColor: 'purple', icon: <ToolOutlined />, today: '今日 — 单 · — 进行中' },
  { key: 'delivery', name: '配送铺', hat: 'DL', hatColor: 'geekblue', icon: <CarOutlined />, today: '今日 — 单 · — 进行中' },
  { key: 'supply', name: '供给铺', hat: 'WH', hatColor: 'cyan', icon: <ShoppingOutlined />, today: '今日 — 单 · — 待出库' },
];

const OPS_ENTRIES = [
  { key: 'erp', name: 'ERP', desc: '进销存 · 财务联动', icon: <DatabaseOutlined /> },
  { key: 'space', name: 'Space', desc: '协同空间 · 文档资产', icon: <CloudServerOutlined /> },
  { key: 'station', name: 'Station', desc: '工位 · 设备管理', icon: <DeploymentUnitOutlined /> },
];

const DU_ENTRIES = [
  { key: 'supply-shops', name: '供给铺管理', desc: '四铺档案 · 能力目录', icon: <ShoppingOutlined />, to: '/du/supply-shops' },
  { key: 'fulfillment', name: '订单履约', desc: '生产单 · 拆单 · 工单执行', icon: <ProfileOutlined />, to: '/du/production-orders' },
  { key: 'market-watch', name: 'Market 观察窗', desc: '集市首页 · 订单列表只读观察', icon: <GlobalOutlined />, to: '/xepz/market-watch' },
];

const EnterpriseWorkbench: React.FC = () => {
  const navigate = useNavigate();
  const placeholder = (name: string) => message.info(`${name} 入口 P1 接入, 敬请期待`);

  return (
    <PortalShell container="xepz">
      {/* 我的铺子聚合骨架 */}
      <Typography.Title level={5} style={{ color: '#fff', margin: '0 0 10px' }}>
        我的铺子
      </Typography.Title>
      <Row gutter={[12, 12]}>
        {SHOPS.map((shop) => (
          <Col xs={24} sm={12} key={shop.key}>
            <Card
              hoverable
              style={{ borderRadius: 14 }}
              onClick={() => message.info('铺子详情 P1 接 Booth 六版本实例')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={shopIconStyle}>{shop.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{shop.name}</span>
                    <Tag color={shop.hatColor} style={{ marginRight: 0 }}>
                      {shop.hat}
                    </Tag>
                  </div>
                  <div style={{ fontSize: 12, color: '#999', marginTop: 3 }}>{shop.today}</div>
                </div>
                <ArrowRightOutlined style={{ color: '#bbb' }} />
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* 经营系统入口区 */}
      <Typography.Title level={5} style={{ color: '#fff', margin: '20px 0 10px' }}>
        经营系统
      </Typography.Title>
      <Row gutter={[12, 12]}>
        {OPS_ENTRIES.map((entry) => (
          <Col xs={8} key={entry.key}>
            <Card
              hoverable
              style={{ borderRadius: 14, textAlign: 'center' }}
              onClick={() => placeholder(entry.name)}
            >
              <div style={{ fontSize: 24, color: '#667eea' }}>{entry.icon}</div>
              <div style={{ fontWeight: 700, marginTop: 6 }}>{entry.name}</div>
              <div style={{ fontSize: 11.5, color: '#999', marginTop: 2 }}>{entry.desc}</div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* [BOOTH-CONN-01] DU 经营视角入口 (供给铺管理/订单履约/Market 观察窗) */}
      <Typography.Title level={5} style={{ color: '#fff', margin: '20px 0 10px' }}>
        经营视角 · DU 履约
      </Typography.Title>
      <Row gutter={[12, 12]}>
        {DU_ENTRIES.map((entry) => (
          <Col xs={24} sm={8} key={entry.key}>
            <Card hoverable style={{ borderRadius: 14 }} onClick={() => navigate(entry.to)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ ...shopIconStyle, color: '#764ba2', background: 'rgba(118,75,162,0.1)' }}>
                  {entry.icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{entry.name}</div>
                  <div style={{ fontSize: 11.5, color: '#999', marginTop: 2 }}>{entry.desc}</div>
                </div>
                <ArrowRightOutlined style={{ color: '#bbb' }} />
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* [BOOTH-CONN-01] 全链路履约时间线 (SSE 实时) */}
      <Typography.Title level={5} style={{ color: '#fff', margin: '20px 0 10px' }}>
        全链路履约时间线
      </Typography.Title>
      <Card style={{ borderRadius: 14 }} styles={{ body: { padding: '14px 16px' } }}>
        <FulfillmentTimeline variant="enterprise" />
      </Card>

      {/* 采购供给入口区 */}
      <Typography.Title level={5} style={{ color: '#fff', margin: '20px 0 10px' }}>
        采购供给
      </Typography.Title>
      <Card
        hoverable
        style={{ borderRadius: 14 }}
        onClick={() => message.info('X-Supply 采购单入口 P1 接入')}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ ...shopIconStyle, color: '#13c2c2', background: 'rgba(19,194,194,0.1)' }}>
            <ProfileOutlined />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>X-Supply 采购单</div>
            <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
              供给采购确认 · 采购单号 ↔ waveNo 透传
            </div>
          </div>
          <ArrowRightOutlined style={{ color: '#bbb' }} />
        </div>
      </Card>
    </PortalShell>
  );
};

const shopIconStyle: React.CSSProperties = {
  fontSize: 22,
  color: '#667eea',
  background: 'rgba(102,126,234,0.1)',
  borderRadius: 10,
  padding: '8px 10px',
};

export default EnterpriseWorkbench;
