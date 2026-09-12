import { useCallback, useEffect, useState } from 'react';
import type { TableProps } from 'antd';

/**
 * [UX-BOOST ③关键动线] 列表统一规范：分页（10/20/50 + 总数）、密度（middle）、滚动手势。
 * 用法：<Table {...TABLE_PROPS} columns={...} dataSource={rows} />
 */
export const TABLE_PROPS: TableProps<unknown> & Record<string, unknown> = {
  size: 'middle',
  pagination: {
    defaultPageSize: 10,
    pageSizeOptions: [10, 20, 50],
    showSizeChanger: true,
    showQuickJumper: false,
    showTotal: (total: number) => `共 ${total} 条`,
  },
};

export const TABLE_PAGINATION_SMALL = {
  defaultPageSize: 5,
  pageSizeOptions: [5, 10, 20],
  showSizeChanger: true,
  showTotal: (total: number) => `共 ${total} 条`,
};

/**
 * [UX-BOOST ②三态] 轻量异步数据 hook：loading / error / data / reload。
 * 与 PageState 配套：const { data, loading, error, reload } = useAsyncData(fn, [deps])
 */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[] = []
): { data: T | null; loading: boolean; error: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    loader()
      .then((v) => {
        if (alive) setData(v);
      })
      .catch(() => {
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload };
}
