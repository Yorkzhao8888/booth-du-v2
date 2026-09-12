import type { TableProps } from 'antd';

/**
 * [UX-BOOST] 列表统一规范：分页、尺寸、密度
 * - size: middle（信息密度与触控平衡）
 * - pagination: 默认 10/页 + 尺寸切换 + 总数提示
 * - 页面可覆盖 pagination 字段（展开合并优先级在页面侧）
 */
export const TABLE_PROPS: Pick<TableProps<any>, 'size' | 'pagination'> = {
  size: 'middle',
  pagination: {
    defaultPageSize: 10,
    showSizeChanger: true,
    pageSizeOptions: [10, 20, 50],
    showTotal: (total: number) => `共 ${total} 条`,
  },
};
