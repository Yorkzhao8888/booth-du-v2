import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs } from 'antd';
import { api } from '../../api';
import { ZonePanel } from './FabZoneView';
import PageState from '../../components/PageState'; // [W1-E] 三态兜底
import type { WorkOrder } from './FabZoneView';

/**
 * [W1-SIMPLIFY] FAB 作业流视图 —— 原前置/制作/包装/分拣四入口合并为一
 * 工序 tab 切换；一次拉取共享数据，各 tab 前端过滤；?zone= 与 URL 同步（直连/刷新/分享保持工序）。
 */
const STAGES: Array<{ key: string; label: string }> = [
  { key: 'preprocessing', label: '前置工序' },
  { key: 'production', label: '制作' },
  { key: 'packaging', label: '包装' },
  { key: 'sorting', label: '分拣' },
];

export default function FabFlow() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlZone = searchParams.get('zone') || '';
  const active = STAGES.some((s) => s.key === urlZone) ? urlZone : 'preprocessing';
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false); // [W1-E]
  const [orders, setOrders] = useState<WorkOrder[]>([]);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<any>('/edxx/fab/dashboard');
      if (res) setOrders(res.orders || []);
      setLoadError(false);
    } catch {
      setLoadError(true); // [W1-E]
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    const timer = setInterval(fetchOrders, 30000);
    return () => clearInterval(timer);
  }, [fetchOrders]);

  // [W1-E] 错误兜底: 断网/服务异常 → PageState error + 重试（避免静默白页）
  if (loadError) return <PageState error onRetry={() => void fetchOrders()} skeletonRows={6} />;
  return (
    <div style={{ padding: 24 }}>
      <Tabs
        activeKey={active}
        onChange={(k) => {
          // 状态迁移原子性：仅替换 query，不动 pathname（树的 fabBase 随角色变化）
          setSearchParams({ zone: k }, { replace: true });
        }}
        items={STAGES.map((s) => ({
          key: s.key,
          label: s.label,
          children: (
            <ZonePanel
              stage={s.key}
              orders={orders.filter((o) => o.production_stage === s.key)}
              loading={loading}
            />
          ),
        }))}
      />
    </div>
  );
}
