// ===========================================================================
// [DEV-P1-02] Station 新状态机单一来源 (7 态)
//   provisioning → idle → busy → paused/down → maintenance → decommissioned
// 旧 status 字段下线: 接口/回调/前端不再读写; 兼容映射仅固化于迁移脚本.
// ===========================================================================

/** 新状态机全部合法状态 */
export const STATION_STATES = [
  'provisioning',
  'idle',
  'busy',
  'paused',
  'down',
  'maintenance',
  'decommissioned',
] as const;

export type StationState = (typeof STATION_STATES)[number];

/**
 * 合法流转表 (目标状态机).
 * 语义:
 *  - provisioning: 上线准备, 仅可进入 idle
 *  - idle:         空闲, 可接单(busy)/掉线(down)/进维(maintenance)
 *  - busy:         作业中, 可完成回 idle/暂停 paused/掉线 down
 *  - paused:       暂停, 可恢复作业 busy/清空 idle/掉线 down/进维
 *  - down:         故障掉线, 可维修 maintenance 或快速修复回 idle
 *  - maintenance:  维护中, 完成回 idle
 *  - decommissioned: 终态 (无出边; idle→decommissioned 必须经 maintenance, 直接跳转 = INVALID_TRANSITION)
 */
export const STATION_TRANSITIONS: Record<StationState, StationState[]> = {
  provisioning: ['idle'],
  idle: ['busy', 'down', 'maintenance'],
  busy: ['idle', 'paused', 'down'],
  paused: ['busy', 'idle', 'down', 'maintenance'],
  down: ['maintenance', 'idle'],
  maintenance: ['idle'],
  decommissioned: [],
};

/** 相同状态视为 no-op (幂等上报), 不算流转 */
export function canStationTransition(from: string, to: string): boolean {
  if (from === to) return true;
  const list = STATION_TRANSITIONS[from as StationState];
  return Array.isArray(list) && list.includes(to as StationState);
}

/** 非法流转抛出 (error.code = INVALID_TRANSITION), 路由层映射 400 */
export function assertStationTransition(from: string, to: string): void {
  if (!canStationTransition(from, to)) {
    const err: any = new Error(
      `INVALID_TRANSITION: station state '${from}' -> '${to}' is not allowed (target machine: provisioning -> idle -> busy -> paused/down -> maintenance -> decommissioned)`
    );
    err.code = 'INVALID_TRANSITION';
    err.statusCode = 400;
    throw err;
  }
}

/**
 * [固化] 旧 status → 新 state 兼容映射表.
 * 仅允许迁移脚本 (scripts/dev-p1-02-migrate.cjs) 使用; 运行时代码禁止读旧 status.
 * 未知旧值保守映射为 provisioning (未上线语义, 需人工确认).
 */
export const LEGACY_STATUS_TO_STATE: Record<string, string> = {
  online: 'idle',
  offline: 'down',
  busy: 'busy',
  paused: 'paused',
  maintenance: 'maintenance',
  decommissioned: 'decommissioned',
  provisioning: 'provisioning',
  active: 'busy',
  disabled: 'down',
  scheduled: 'provisioning',
};

/** 未知旧值的兜底映射 */
export const LEGACY_STATUS_FALLBACK = 'provisioning';

/**
 * [固化] Station-OS 回调事件 → 站点新状态机目标态.
 * JobAccepted  → busy (接单开工)
 * JobRunning   → busy (运行中, self no-op)
 * JobCompleted → idle (完成释放; 多在途时由调用方保持 busy)
 * JobFailed    → down (失败视为设备异常, 人工恢复)
 */
export const STATION_EVENT_TO_STATE: Record<string, string> = {
  JobAccepted: 'busy',
  JobRunning: 'busy',
  JobCompleted: 'idle',
  JobFailed: 'down',
};
