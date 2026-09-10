import React, { useMemo, useState } from 'react';
import { Alert, Card, Space, Spin, Tabs, Typography } from 'antd';
import { PortalShell } from '../../components/PortalShell';
import { MarketNewWindowButton } from '../../components/FulfillmentTimeline';

/**
 * [BOOTH-CONN-01 工单 2] Market 观察窗 ("观察 market" 落点)
 * iframe 拉取 X-Market 线上 (集市首页 / 订单列表两视图), 只读观察不改 Market;
 * 附 oas_token 免登参数 (Market 侧未消费时无害); 嵌入被拒时提供新窗口打开兜底。
 */

const MARKET_BASE = 'https://fhrrxb4t8g.coze.site';

const MarketWatch: React.FC = () => {
  const [tab, setTab] = useState<string>('home');
  const [loading, setLoading] = useState(true);

  const token = useMemo(() => localStorage.getItem('booth_token') || '', []);
  const viewUrl = useMemo(() => {
    const base = tab === 'orders' ? `${MARKET_BASE}/orders` : `${MARKET_BASE}/`;
    const withToken = token && token !== 'dev-open' ? `${base}${base.includes('?') ? '&' : '?'}oas_token=${encodeURIComponent(token)}` : base;
    return withToken;
  }, [tab]);

  const items = [
    { key: 'home', label: '集市首页' },
    { key: 'orders', label: '订单列表' },
  ];

  return (
    <PortalShell container="xepz">
      <Card
        size="small"
        style={{ borderRadius: 14 }}
        title={
          <Space size={8}>
            <span style={{ fontWeight: 700 }}>Market 观察窗</span>
            <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
              只读观察 · 不改 Market · 协议=契约单 v1.1
            </Typography.Text>
          </Space>
        }
        extra={<MarketNewWindowButton url={viewUrl} />}
      >
        <Tabs
          activeKey={tab}
          onChange={(k) => {
            setTab(k);
            setLoading(true);
          }}
          items={items.map((i) => ({ key: i.key, label: i.label }))}
          size="small"
          style={{ marginBottom: 8 }}
        />
        {loading ? (
          <div style={{ textAlign: 'center', padding: 18 }}>
            <Spin tip="正在连接 X-Market ..." />
          </div>
        ) : null}
        <iframe
          key={viewUrl}
          src={viewUrl}
          title="Market 观察窗"
          onLoad={() => setLoading(false)}
          style={{
            width: '100%',
            height: '68vh',
            minHeight: 420,
            border: '1px solid #f0f0f0',
            borderRadius: 10,
            background: '#fff',
          }}
        />
        <Alert
          style={{ marginTop: 10 }}
          type="info"
          showIcon
          message="若 Market 侧未开放页面嵌入, 请点右上角「新窗口打开」直访"
          description={null}
        />
      </Card>
    </PortalShell>
  );
};

export default MarketWatch;
