import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Empty, Space, Spin, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { apiGet, unwrapData } from '../../api';

/**
 * [XDP-ECO] 经营户工作台 (#xdpz) — 铺位管理动线
 * 我的生态铺位列表(直营/加盟标+状态+协议费率) + 待审申请跟踪
 * 红线: 费率=协议参数非售价, 仅显示; 执行层 0 价格不受影响
 */

interface EcoShop {
  id: number;
  shopName: string;
  ecoType: 'direct' | 'franchise';
  category: string;
  status: 'active' | 'suspended';
  rateBps: number;
  isDemo: boolean;
  createdAt: string;
}

interface EcoApp {
  id: number;
  shopName: string;
  category: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectReason?: string | null;
  rateBps?: number | null;
  createdAt: string;
}

const fmtRate = (bps?: number | null): string => (bps === null || bps === undefined ? '-' : `${(bps / 100).toFixed(1)}%`);
const fmtTime = (t?: string | null): string => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '-');

const ShopOwnerWorkbench: React.FC = () => {
  const [shops, setShops] = useState<EcoShop[]>([]);
  const [myApps, setMyApps] = useState<EcoApp[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sh, ap] = await Promise.all([
        apiGet<EcoShop[] | { data?: EcoShop[] }>('/eco/my-shops'),
        apiGet<EcoApp[] | { data?: EcoApp[] }>('/eco/my-applications'),
      ]);
      setShops(unwrapData<EcoShop[]>(sh));
      setMyApps(unwrapData<EcoApp[]>(ap));
    } catch (err) {
      message.error(`铺位数据加载失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const shopColumns: ColumnsType<EcoShop> = [
    { title: '铺位名称', dataIndex: 'shopName', key: 'shopName', render: (v: string, r) => (
      <Space size={6}>
        {v}
        {r.ecoType === 'direct' ? <Tag color="geekblue">直营</Tag> : <Tag color="cyan">加盟</Tag>}
        {r.isDemo ? <Tag color="orange">演示</Tag> : null}
      </Space>
    ) },
    { title: '经营类目', dataIndex: 'category', key: 'category', width: 120 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (v: string) =>
      v === 'active' ? <Tag color="success">在营</Tag> : <Tag color="error">已停铺</Tag> },
    { title: '协议费率', dataIndex: 'rateBps', key: 'rateBps', width: 100, render: (v: number) => <strong>{fmtRate(v)}</strong> },
    { title: '开通时间', dataIndex: 'createdAt', key: 'createdAt', width: 160, render: (v: string) => fmtTime(v) },
  ];

  return (
    <div style={{ padding: '0 0 24px' }}>
      <Card style={{ borderRadius: 12, marginBottom: 14 }} styles={{ body: { padding: '16px 18px' } }}>
        <Space align="center" style={{ width: '100%', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>经营户工作台 <Tag color="geekblue">#xdpz · 铺位管理</Tag></Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>我的铺位 · 协议费率 · 入驻申请跟踪</Typography.Text>
          </div>
          <Button icon={<ReloadOutlined />} onClick={() => void loadAll()} loading={loading}>刷新</Button>
        </Space>
      </Card>

      <Card
        title={`我的铺位 (${shops.length})`}
        style={{ borderRadius: 12, marginBottom: 14 }}
        styles={{ body: { padding: '8px 16px 16px' } }}
      >
        {shops.length === 0 && !loading ? (
          <Empty description="暂无铺位 — 可从企业台 (#xepz) 提交加盟入驻申请, 平台方审核通过后自动开通" style={{ padding: '24px 0' }} />
        ) : (
          <Table rowKey="id" size="small" columns={shopColumns} dataSource={shops} loading={loading} pagination={false} scroll={{ x: 680 }} />
        )}
      </Card>

      <Card title={`我的入驻申请 (${myApps.length})`} style={{ borderRadius: 12 }} styles={{ body: { padding: '8px 16px 16px' } }}>
        {myApps.length === 0 && !loading ? (
          <Empty description="暂无申请记录" style={{ padding: '12px 0' }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {myApps.map((a) => (
              <Card key={a.id} size="small" style={{ borderRadius: 8 }}>
                <Space align="center" style={{ width: '100%', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div>
                    <strong>{a.shopName}</strong>
                    <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>{a.category} · {fmtTime(a.createdAt)}</Typography.Text>
                  </div>
                  {a.status === 'pending' ? <Tag color="warning">平台方审核中</Tag>
                    : a.status === 'approved' ? <Tag color="success">已通过 · 开通铺 (费率 {fmtRate(a.rateBps)})</Tag>
                    : <Tag color="error">已驳回</Tag>}
                </Space>
                {a.status === 'rejected' && a.rejectReason ? (
                  <Typography.Text type="danger" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>驳回理由: {a.rejectReason}</Typography.Text>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </Card>

      {loading ? <Spin style={{ display: 'block', margin: '16px auto' }} /> : null}
    </div>
  );
};

export default ShopOwnerWorkbench;
