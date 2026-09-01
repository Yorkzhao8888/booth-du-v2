// BOOTH-PK-05 报价引擎 (QuoteEngine) —— 蓝本 booth_core.py 的 TS 落地
// 四能力源: MATERIAL(dyard) / INTEL(lora) / LABOR(mate) / EDGE(station)
// 选优: 能力单元按「成本/质量综合最优」(value = unitCost / quality 最低者)
// 动态利润率: urgency = 1 - remaining_days/7 (7 天为基准, 交期越紧溢价越高); 批量>=1000 加 volume_tier 0.02
// 性能: 纯内存计算, 毫秒级 (<10ms); API 层可用真实数据(booth_sku_cost / station_capabilities.rate)增强候选, 不造假数据
export type CapSource = 'MATERIAL' | 'INTEL' | 'LABOR' | 'EDGE';

export interface CapabilityUnit {
  unitId: string;
  source: CapSource;
  name: string;
  unitCost: number;
  quality: number; // 0-1
  origin: 'builtin' | 'real'; // real = 来自真实业务数据(booth_sku_cost/station_capabilities)
}

export interface QuoteRequest {
  skuId?: number;
  quantity: number;
  dueDate?: string;
  specs?: Record<string, unknown>;
}

export interface QuoteItem {
  source: CapSource;
  unit_id: string;
  unit_name: string;
  unit_cost: number;
  units: number;
  risk_factor: number; // 1 - quality, 风险披露
  subtotal: number;
}

export interface QuoteResult {
  quote_id: string;
  base_cost: number;
  margin_rate: number;
  urgency: number;
  volume_tier: number;
  total: number;
  items: QuoteItem[];
  elapsed_ms: number;
}

export const SOURCE_UNITS_COUNT: Record<CapSource, number> = {
  MATERIAL: 1,
  LABOR: 1,
  INTEL: 1,
  EDGE: 1,
};

// 内置能力单元候选 (定价参数; API 层可用真实数据覆盖 MATERIAL/EDGE 成本, 标 origin=real)
export function builtinUnits(): CapabilityUnit[] {
  return [
    { unitId: 'dyard-standard', source: 'MATERIAL', name: 'D-Yard 标准物料', unitCost: 8.5, quality: 0.92, origin: 'builtin' },
    { unitId: 'dyard-premium', source: 'MATERIAL', name: 'D-Yard 优质物料', unitCost: 12, quality: 0.99, origin: 'builtin' },
    { unitId: 'lora-lite', source: 'INTEL', name: 'LoRA 智能调度·轻量', unitCost: 0.8, quality: 0.9, origin: 'builtin' },
    { unitId: 'lora-pro', source: 'INTEL', name: 'LoRA 智能调度·专业', unitCost: 2.5, quality: 0.99, origin: 'builtin' },
    { unitId: 'mate-junior', source: 'LABOR', name: 'Mate 初级工', unitCost: 15, quality: 0.85, origin: 'builtin' },
    { unitId: 'mate-senior', source: 'LABOR', name: 'Mate 高级工', unitCost: 28, quality: 0.97, origin: 'builtin' },
    { unitId: 'station-standard', source: 'EDGE', name: 'Station 标准产线', unitCost: 0.5, quality: 0.9, origin: 'builtin' },
    { unitId: 'station-turbo', source: 'EDGE', name: 'Station 增强产线', unitCost: 1.2, quality: 0.98, origin: 'builtin' },
  ];
}

/** 成本/质量综合最优: value = unitCost / quality 最低者 (quality<=0 视为不可用) */
export function selectUnit(units: CapabilityUnit[]): CapabilityUnit {
  const usable = units.filter((u) => u.quality > 0 && Number.isFinite(u.unitCost) && u.unitCost >= 0);
  if (!usable.length) throw new Error('NO_USABLE_UNIT');
  return usable.reduce((best, u) => (u.unitCost / u.quality < best.unitCost / best.quality ? u : best));
}

/** 动态利润率: urgency = 1 - remaining_days/7 (clamp 0-1, 基准 7 天); 批量>=1000 加 volume_tier 0.02 */
export function computeMargin(quantity: number, dueDate?: string): { urgency: number; volumeTier: number; marginRate: number } {
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  let urgency = 0;
  if (dueDate) {
    const due = new Date(dueDate);
    if (!isNaN(due.getTime())) {
      const remainingDays = Math.ceil((due.getTime() - Date.now()) / 86400000);
      urgency = clamp01(1 - remainingDays / 7);
    }
  }
  const volumeTier = quantity >= 1000 ? 0.02 : 0;
  const marginRate = Math.round((0.12 + urgency * 0.18 + volumeTier) * 10000) / 10000;
  return { urgency: Math.round(urgency * 10000) / 10000, volumeTier, marginRate };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 生成报价: 按需求拆解各能力源用量 -> 每源选综合最优能力单元 -> base_cost -> margin -> total
 * specs.unitOverrides: { MATERIAL?, LABOR?, INTEL?, EDGE?: number } 可显式覆盖用量(透明可解释)
 */
export function buildQuote(req: QuoteRequest, units: CapabilityUnit[] = builtinUnits()): QuoteResult {
  const t0 = performance.now();
  const quantity = Number(req.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('INVALID_QUANTITY');
  const overrides = (req.specs?.unitOverrides ?? {}) as Partial<Record<CapSource, number>>;

  const plan: { source: CapSource; units: number }[] = [
    { source: 'MATERIAL', units: Math.max(1, Math.round(Number(overrides.MATERIAL ?? quantity))) },
    { source: 'LABOR', units: Math.max(1, Math.round(Number(overrides.LABOR ?? Math.ceil(quantity * 0.05)))) },
    { source: 'INTEL', units: Math.max(1, Math.round(Number(overrides.INTEL ?? 1))) },
    { source: 'EDGE', units: Math.max(1, Math.round(Number(overrides.EDGE ?? quantity))) },
  ];

  const items: QuoteItem[] = plan.map(({ source, units: n }) => {
    const picked = selectUnit(units.filter((u) => u.source === source));
    return {
      source,
      unit_id: picked.unitId,
      unit_name: picked.name,
      unit_cost: round2(picked.unitCost),
      units: n,
      risk_factor: Math.round((1 - picked.quality) * 10000) / 10000,
      subtotal: round2(picked.unitCost * n),
    };
  });

  const baseCost = round2(items.reduce((a, i) => a + i.subtotal, 0));
  const { urgency, volumeTier, marginRate } = computeMargin(quantity, req.dueDate);
  const total = round2(baseCost * (1 + marginRate));
  const quoteId = `QE-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  return { quote_id: quoteId, base_cost: baseCost, margin_rate: marginRate, urgency, volume_tier: volumeTier, total, items, elapsed_ms: Math.round((performance.now() - t0) * 1000) / 1000 };
}
