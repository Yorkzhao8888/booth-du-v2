/**
 * [BOOTH-PRD-002 PM-004] 角色管理 (修正口径): 生态角色链 dm→du→dx→dex→dexx
 * DEU = DU 履约铺分身 (非独立角色, 保留经营决策权); DEX=dex(店-铺长) / DEXX=dexx(铺员)
 * 价格红线: M 层(dm/du)+X 层管理(dx) 可见价格; X 层执行(DEX/DEXX) 不可见任何价格
 */
import { useEffect, useState, useCallback } from 'react';
import { Alert, Card, Space, Spin, Table, Tag, Typography } from 'antd';
import { apiGet } from '../../api';

const { Text, Title } = Typography;

interface RbacMatrix {
  chain: { roleKey: string; ecoName: string; layer: string; priceVisible: boolean; description: string }[];
  deuExplanation: string;
  me: {
    roleKey: string;
    ecoName: string;
    actingAs?: string;
    priceVisible: boolean;
    menuScope: string[];
    dataScope: string;
  };
}

const LAYER_COLOR: Record<string, string> = { 'M-层': 'gold', 'X-管理': 'blue', 'X-执行': 'orange', '分身': 'geekblue' };

export default function RbacRoles() {
  const [data, setData] = useState<RbacMatrix | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet<RbacMatrix>('/rbac/roles');
      setData(d);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !data) {
    return (
      <Card>
        <Spin />
      </Card>
    );
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert
        type="info"
        showIcon
        message="生态角色链 (口径修正)"
        description={
          <Space size={8} wrap>
            {data.chain.map((c, i) => (
              <Space key={c.roleKey} size={6}>
                {i > 0 ? <Text type="secondary">→</Text> : null}
                <Tag color={LAYER_COLOR[c.layer] || 'default'}>
                  {c.ecoName} = {c.roleKey}
                </Tag>
              </Space>
            ))}
            <Tag color="geekblue">DEU = DU 履约铺分身 (非独立角色)</Tag>
          </Space>
        }
      />
      <Card title="角色权限矩阵 (BDD-17)" size="small">
        <Table
          rowKey="roleKey"
          size="small"
          pagination={false}
          dataSource={data.chain}
          columns={[
            { title: '生态代号', dataIndex: 'ecoName', width: 90 },
            { title: '系统角色', dataIndex: 'roleKey', width: 90 },
            { title: '层级', dataIndex: 'layer', width: 100, render: (l: string) => <Tag color={LAYER_COLOR[l] || 'default'}>{l}</Tag> },
            {
              title: '价格可见',
              dataIndex: 'priceVisible',
              width: 100,
              render: (p: boolean) => (p ? <Tag color="green">可见</Tag> : <Tag color="red">不可见 (红线)</Tag>),
            },
            { title: '说明', dataIndex: 'description' },
          ]}
        />
      </Card>
      <Card title="当前会话 (双层校验: 菜单权限 + 数据权限)" size="small">
        <Space direction="vertical" size={4}>
          <Space size={8}>
            <Text>身份:</Text>
            <Tag color="blue">{data.me.ecoName} ({data.me.roleKey})</Tag>
            {data.me.actingAs === 'deu' ? <Tag color="geekblue">DEU 分身生效中</Tag> : null}
            <Text>价格:</Text>
            {data.me.priceVisible ? <Tag color="green">可见</Tag> : <Tag color="red">全链路不可见售价</Tag>}
          </Space>
          <div>
            <Text>菜单权限:</Text>{' '}
            <Space size={4} wrap>
              {data.me.menuScope.map((m) => (
                <Tag key={m}>{m}</Tag>
              ))}
            </Space>
          </div>
          <Text type="secondary">数据权限: {data.me.dataScope}</Text>
        </Space>
      </Card>
      <Card title="DEU 分身机制 (修正口径落地)" size="small">
        <Title level={5} style={{ marginTop: 0 }}>
          DEU 不是独立角色
        </Title>
        <Text>
          {data.deuExplanation}
        </Text>
        <div style={{ marginTop: 8 }}>
          <Text type="secondary">
            前后端双重拦截: 前端菜单/价格列按角色隐藏; 后端 X 层执行响应统一剥离售价字段 (DEU 分身豁免 — DU 保留订单下发/审批终审/看板/收入权)。
          </Text>
        </div>
      </Card>
    </Space>
  );
}
