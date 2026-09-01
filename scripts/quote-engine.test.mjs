// BOOTH-PK-05 QuoteEngine 五验证点单测(轻量 node 直跑, 无测试框架依赖)
// 运行: pnpm build && node scripts/quote-engine.test.mjs
import { buildQuote, builtinUnits, computeMargin, selectUnit } from '../dist/server/services/quote-engine.js';

const results = [];
let pass = 0, fail = 0;
function check(name, cond, detail) {
  results.push(`${cond ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
  cond ? pass++ : fail++;
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// 1) 四能力源: 输出 items 覆盖 MATERIAL/INTEL/LABOR/EDGE
const q1 = buildQuote({ quantity: 100, dueDate: new Date(Date.now() + 5 * 86400000).toISOString() });
const sources = new Set(q1.items.map((i) => i.source));
check('四能力源 MATERIAL/INTEL/LABOR/EDGE', sources.size === 4 && ['MATERIAL', 'INTEL', 'LABOR', 'EDGE'].every((s) => sources.has(s)), [...sources].join(','));

// 2) 总价 > 成本 (margin > 0)
check('总价 > 成本', q1.total > q1.base_cost && q1.margin_rate > 0, `base=${q1.base_cost} total=${q1.total} margin=${q1.margin_rate}`);

// 3) 毫秒级: 连续 500 次报价, 单次均 < 10ms
const t0 = performance.now();
for (let i = 0; i < 500; i++) buildQuote({ quantity: 100 + (i % 50), dueDate: new Date(Date.now() + 3 * 86400000).toISOString() });
const avgMs = (performance.now() - t0) / 500;
check('毫秒级 <10ms/次', avgMs < 10, `avg=${avgMs.toFixed(4)}ms`);

// 4) 加急溢价: 交期越紧 margin 越高 (urgency = 1 - remaining/7)
const rush = computeMargin(100, new Date(Date.now() + 1 * 86400000).toISOString()).marginRate;
const relaxed = computeMargin(100, new Date(Date.now() + 10 * 86400000).toISOString()).marginRate;
check('加急溢价 (rush > relaxed)', rush > relaxed, `rush=${rush} relaxed=${relaxed}`);
check('加急 urgency 公式 (1-remaining/7)', near(computeMargin(100, new Date(Date.now() + 1 * 86400000).toISOString()).urgency, 1 - 1 / 7, 0.01), `urgency=${computeMargin(100, new Date(Date.now() + 1 * 86400000).toISOString()).urgency}`);

// 5) 批量溢价: quantity >= 1000 加 volume_tier 0.02
const bulk = computeMargin(1500, new Date(Date.now() + 5 * 86400000).toISOString());
const normal = computeMargin(500, new Date(Date.now() + 5 * 86400000).toISOString());
check('批量溢价 volume_tier=0.02', bulk.volumeTier === 0.02 && normal.volumeTier === 0 && near(bulk.marginRate - normal.marginRate, 0.02, 0.001), `bulk=${bulk.marginRate} normal=${normal.marginRate}`);

// 引擎综合最优选择: selectUnit 取 unitCost/quality 最优
const best = selectUnit(builtinUnits().filter((u) => u.source === 'MATERIAL'));
check('综合最优选型 (cost/quality)', best.unitId === 'dyard-standard', `picked=${best.unitId} value=${(best.unitCost / best.quality).toFixed(3)}`);

console.log(results.join('\n'));
console.log(`\nTOTAL: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
