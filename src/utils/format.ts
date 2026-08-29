/**
 * 数值格式化工具函数
 * 统一处理 number | string | null | undefined 的格式化，避免 .toFixed() 报错
 */

/**
 * 将任意值安全转换为 number
 * @param v 任意值
 * @param fallback 转换失败时的默认值，默认 0
 */
export function toNumber(v: unknown, fallback = 0): number {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 格式化金额（带千分位和 ¥ 符号）
 * @param v 金额值（支持 number | string | null | undefined）
 * @param digits 小数位数，默认 2
 */
export function fmtMoney(v: unknown, digits = 2): string {
  const n = toNumber(v, 0);
  return `¥${n.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * 格式化数量（带千分位，无货币符号）
 * @param v 数量值（支持 number | string | null | undefined）
 * @param digits 小数位数，默认 3
 */
export function fmtQty(v: unknown, digits = 3): string {
  const n = toNumber(v, 0);
  return n.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 格式化百分比
 * @param v 百分比值（如 99.21 表示 99.21%）
 * @param digits 小数位数，默认 2
 */
export function fmtPercent(v: unknown, digits = 2): string {
  const n = toNumber(v, 0);
  return `${n.toFixed(digits)}%`;
}

/**
 * 格式化普通数字（无千分位）
 * @param v 数值
 * @param digits 小数位数，默认 2
 */
export function fmtNum(v: unknown, digits = 2): string {
  const n = toNumber(v, 0);
  return n.toFixed(digits);
}
