/**
 * [XDP-ECO] 生态版四主体容器共享类型与元数据
 * 四主体口径 (2026-09-12 拍板): 个人(XHPZ·消费与派岗) / 企业(XEPZ·开店经营) /
 * 经营户(XDPZ·铺位管理) / 平台方(XVPZ·VEM 生态治理)
 */
export type ContainerKey = 'xhpz' | 'xepz' | 'xdpz' | 'xvpz';

export type ContainerAccess = Record<ContainerKey, boolean>;

export const CONTAINER_META: Record<ContainerKey, { label: string; sub: string; color: string }> = {
  xhpz: { label: 'Xfactory 个人版', sub: '客户视图 · 消费与交付 · Xfactory 履约端', color: 'purple' },
  xepz: { label: 'Xfactory 企业版', sub: '经营者视角 · 铺子履约 · Xfactory 履约端', color: 'geekblue' },
  xdpz: { label: 'Xfactory 经营户', sub: '铺位管理 · 生态经营 · Xfactory 履约端', color: 'cyan' },
  xvpz: { label: 'Xfactory 平台方', sub: '生态治理 · VEM 控制台 · Xfactory 履约端', color: 'gold' },
};

/** 四主体分流文案 (登录页/注册入口/门户卡共用) */
export const FOUR_SUBJECT_LINES: Record<ContainerKey, { title: string; desc: string }> = {
  xhpz: { title: '个人 · 消费与派岗', desc: '逛集市下单消费, 经 X-Mate 人事铺派岗接单' },
  xepz: { title: '企业 · 开店经营', desc: '注册企业主体开店, 经营履约与供给采购' },
  xdpz: { title: '经营户 · 铺位管理', desc: '直营/加盟铺位管理与生态经营' },
  xvpz: { title: '平台方 · 生态治理', desc: '入驻审核 · 费率配置 · 分成台账 · 治理操作' },
};

/** PortalShell「切换端」映射: xhpz↔xepz 互切; 经营户/平台方切企业端 */
export const CONTAINER_SWITCH_TO: Record<ContainerKey, ContainerKey> = {
  xhpz: 'xepz',
  xepz: 'xhpz',
  xdpz: 'xepz',
  xvpz: 'xdpz',
};
