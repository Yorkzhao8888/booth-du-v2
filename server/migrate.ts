import bcrypt from 'bcryptjs';
import { pool, query } from './db.js';

// ===========================================================================
// Booth-DU 数据库迁移基线（TECH-DEBT-5 版本化整理）
// ---------------------------------------------------------------------------
// 本文件是全量 schema 的版本化基线：所有扩表/加列在此追加幂等语句，
// 服务启动时由 migrate() 在单事务内整体执行（事务保证原子性）。
//
// 幂等约定（新增语句必须遵守）:
//   1. 建表一律 CREATE TABLE IF NOT EXISTS
//   2. 加列一律 ALTER TABLE ... ADD COLUMN IF NOT EXISTS
//   3. 索引一律 CREATE INDEX IF NOT EXISTS
//   4. 数据级迁移先查后写（存在即跳过），或用 WHERE 守卫保证可重复执行
//   5. 禁止 DROP / TRUNCATE / 破坏性类型变更
//
// 版本区块索引（自上而下追加，禁止在历史区块内改写语义）:
//   [V1]   DDL 头部    核心域: orgs/users/skus/fulfillments/work_orders/
//                      boms/inventory/出入库/事件与Outbox
//   [V2]   DDL 中部    模块域: sku_cost/purchase_orders/profit_snapshots/
//                      batches/stocktakes/工序/质检/DL/SVC
//   [E0]   ALTERS 头部 早期增量补列: safety_stock_num/priority/paused/
//                      DL+SVC任务列/warehouse_type
//   [D]    ALTERS      工单 D: 供应商管理+结算（含 FAB 产线阶段补丁/
//                      良品率/库存调拨）
//   [C2]   ALTERS      工单 C2: 本店供应商层（档案扩展/准入/合同）
//   [C1]   ALTERS      工单 C1: EM 全局供应链（生态准入/供给策略/产能）
//   [C3]   ALTERS      工单 C3: 采购系统增强 + Market 通货售卖
//   [J]    ALTERS      工单 FAB-OPT-01: Job 模型（stations/8态状态机）
//   [WS1]  ALTERS      工单 WH-SUPPLY-01: 供给单/设备档案/维保/场地
//   [O1]   ALTERS      工单 BOOTH-OPT-01: ATP 产能/负荷/可承诺量
//   [O2]   ALTERS      工单 BOOTH-OPT-02: SGU 目录/挂牌/订阅
//   [O3]   ALTERS      工单 BOOTH-OPT-03: 供给报价三层价格
//   [M1]   migrate()   工单 FAB-MES-01: booth_equipment/状态流水/保养计划
//   [M3]   migrate()   工单 FAB-MES-03: 安灯 events/escalation/知识库候选
//   [SEED] migrate()   种子数据 + 角色迁移(eu→du等) + 账号补种(dx/dm/dxx/em)
//                      + Station 编码回填 + sku_cost 播种
//
// 新增迁移操作规程: schema 变更追加到 ALTERS 尾部（新表也可入 DDL 尾部），
// 用「-- ====== <工单号>：<一句话说明> ======」作区块头；migrate() 内的
// 数据级迁移同样按区块注释追加。改完必须在本地跑一次 build + 启动验证幂等。
// ===========================================================================

const DDL = `
-- ====== [V1] CORE TABLES 核心域 ======
CREATE TABLE IF NOT EXISTS booth_orgs (
  id SERIAL PRIMARY KEY, shop_id INTEGER NOT NULL, name VARCHAR(100) NOT NULL,
  mode VARCHAR(10) NOT NULL DEFAULT 'du', is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS booth_users (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  name VARCHAR(50) NOT NULL, phone VARCHAR(20) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL, role VARCHAR(10) NOT NULL,
  hats TEXT[] DEFAULT '{}', is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS booth_skus (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  sku_code VARCHAR(50) NOT NULL, name VARCHAR(100) NOT NULL, unit VARCHAR(20) NOT NULL,
  safety_stock INTEGER NOT NULL DEFAULT 0, cost_price INTEGER DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, sku_code)
);
CREATE TABLE IF NOT EXISTS booth_fulfillments (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  shop_order_id VARCHAR(50) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending',
  items JSONB NOT NULL DEFAULT '[]', required_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(org_id, shop_order_id)
);
CREATE TABLE IF NOT EXISTS booth_work_orders (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  fulfillment_id INTEGER REFERENCES booth_fulfillments(id),
  product_name VARCHAR(100) NOT NULL, qty INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', boms JSONB DEFAULT '[]',
  progress INTEGER NOT NULL DEFAULT 0, accepted_by INTEGER REFERENCES booth_users(id),
  operator_id INTEGER REFERENCES booth_users(id), accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS booth_boms (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  product_name VARCHAR(100) NOT NULL, product_code VARCHAR(50),
  sale_price INTEGER DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS booth_bom_items (
  id SERIAL PRIMARY KEY, bom_id INTEGER NOT NULL REFERENCES booth_boms(id) ON DELETE CASCADE,
  sku_id INTEGER NOT NULL REFERENCES booth_skus(id), qty INTEGER NOT NULL, unit VARCHAR(20) NOT NULL
);
CREATE TABLE IF NOT EXISTS booth_inventory (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  sku_id INTEGER NOT NULL REFERENCES booth_skus(id), qty_on_hand INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(org_id, sku_id)
);
CREATE TABLE IF NOT EXISTS booth_inventory_txn (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  sku_id INTEGER NOT NULL REFERENCES booth_skus(id), qty_change INTEGER NOT NULL,
  type VARCHAR(20) NOT NULL, ref_type VARCHAR(30), ref_id INTEGER,
  operator_id INTEGER REFERENCES booth_users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS booth_inbound_orders (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  items JSONB NOT NULL DEFAULT '[]', status VARCHAR(20) NOT NULL DEFAULT 'posted',
  operator_id INTEGER REFERENCES booth_users(id), posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS booth_outbound_orders (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  items JSONB NOT NULL DEFAULT '[]', status VARCHAR(20) NOT NULL DEFAULT 'posted',
  operator_id INTEGER REFERENCES booth_users(id), posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS booth_event_log (
  id SERIAL PRIMARY KEY, event_id VARCHAR(100) NOT NULL UNIQUE,
  event_type VARCHAR(50) NOT NULL, payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS booth_outbox (
  id SERIAL PRIMARY KEY, event_type VARCHAR(50) NOT NULL, payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), sent_at TIMESTAMPTZ
);

-- ====== V2 MODULE TABLES ======

-- DU: SKU moving-weighted-average cost
CREATE TABLE IF NOT EXISTS booth_sku_cost (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  sku_id INTEGER NOT NULL REFERENCES booth_skus(id),
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, sku_id)
);

-- DU: Purchase orders
CREATE TABLE IF NOT EXISTS booth_purchase_orders (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  po_no TEXT NOT NULL UNIQUE, supplier TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  total_amount NUMERIC(12,2) DEFAULT 0,
  created_by INTEGER REFERENCES booth_users(id),
  approved_by INTEGER REFERENCES booth_users(id),
  submitted_at TIMESTAMPTZ, approved_at TIMESTAMPTZ, received_at TIMESTAMPTZ,
  remark TEXT, items JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- DU: Profit snapshots
CREATE TABLE IF NOT EXISTS booth_profit_snapshots (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  fulfillment_id INTEGER REFERENCES booth_fulfillments(id),
  work_order_id INTEGER, revenue NUMERIC(12,2) DEFAULT 0,
  material_cost NUMERIC(12,2) DEFAULT 0, gross_profit NUMERIC(12,2) DEFAULT 0,
  margin NUMERIC(6,2) DEFAULT 0,
  cost_detail JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, fulfillment_id)
);

-- CORE: Stock batches
CREATE TABLE IF NOT EXISTS booth_stock_batches (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  sku_id INTEGER NOT NULL REFERENCES booth_skus(id),
  batch_no TEXT, qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  expiry_date DATE, received_at TIMESTAMPTZ DEFAULT NOW(),
  source_type TEXT, source_id BIGINT, location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CORE: Stocktake orders
CREATE TABLE IF NOT EXISTS booth_stocktake_orders (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  st_no TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER REFERENCES booth_users(id),
  approved_by INTEGER REFERENCES booth_users(id),
  submitted_at TIMESTAMPTZ, approved_at TIMESTAMPTZ,
  remark TEXT, lines JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CORE: FAB operations (工序)
CREATE TABLE IF NOT EXISTS booth_fab_operations (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  work_order_id BIGINT NOT NULL, seq INT NOT NULL, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  operator_id INTEGER REFERENCES booth_users(id),
  planned_qty NUMERIC(12,3) DEFAULT 0,
  reported_qty NUMERIC(12,3) DEFAULT 0,
  started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CORE: Quality checks
CREATE TABLE IF NOT EXISTS booth_quality_checks (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  work_order_id BIGINT NOT NULL,
  result TEXT NOT NULL DEFAULT 'pass',
  qty_pass NUMERIC(12,3) DEFAULT 0, qty_reject NUMERIC(12,3) DEFAULT 0,
  reject_reason TEXT, inspector_id INTEGER REFERENCES booth_users(id),
  checked_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CORE: Delivery tasks
CREATE TABLE IF NOT EXISTS booth_dl_tasks (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  task_no TEXT NOT NULL UNIQUE, fulfillment_id BIGINT,
  status TEXT NOT NULL DEFAULT 'pending',
  assignee_id INTEGER REFERENCES booth_users(id),
  pickup_addr TEXT, delivery_addr TEXT,
  customer_name TEXT, customer_phone TEXT,
  assigned_at TIMESTAMPTZ, accepted_at TIMESTAMPTZ,
  picked_at TIMESTAMPTZ, delivering_at TIMESTAMPTZ, signed_at TIMESTAMPTZ,
  signer TEXT, exception_reason TEXT, remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CORE: Service tasks
CREATE TABLE IF NOT EXISTS booth_svc_tasks (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  task_no TEXT NOT NULL UNIQUE, fulfillment_id BIGINT,
  status TEXT NOT NULL DEFAULT 'pending',
  assignee_id INTEGER REFERENCES booth_users(id),
  service_content TEXT, customer_name TEXT, customer_phone TEXT,
  required_at TIMESTAMPTZ,
  assigned_at TIMESTAMPTZ, accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  exception_reason TEXT, remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_wo_org_status ON booth_work_orders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_wo_fulfillment ON booth_work_orders(fulfillment_id);
CREATE INDEX IF NOT EXISTS idx_fulfill_org_status ON booth_fulfillments(org_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_txn_org_sku ON booth_inventory_txn(org_id, sku_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bom_items_bom ON booth_bom_items(bom_id);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON booth_outbox(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_batches_org_sku_exp ON booth_stock_batches(org_id, sku_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_fab_ops_wo ON booth_fab_operations(work_order_id);
CREATE INDEX IF NOT EXISTS idx_qc_wo ON booth_quality_checks(work_order_id);
CREATE INDEX IF NOT EXISTS idx_dl_org_status ON booth_dl_tasks(org_id, status);
CREATE INDEX IF NOT EXISTS idx_svc_org_status ON booth_svc_tasks(org_id, status);
CREATE INDEX IF NOT EXISTS idx_po_org_status ON booth_purchase_orders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_st_org_status ON booth_stocktake_orders(org_id, status);
`;

const ALTERS = `
-- ====== [E0] EARLY INCREMENTAL ALTERS 早期增量补列 ======
ALTER TABLE booth_skus ADD COLUMN IF NOT EXISTS safety_stock_num NUMERIC(12,3) DEFAULT 0;
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal';
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS paused BOOLEAN DEFAULT false;
ALTER TABLE booth_dl_tasks ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE booth_dl_tasks ADD COLUMN IF NOT EXISTS picked_at TIMESTAMPTZ;
ALTER TABLE booth_dl_tasks ADD COLUMN IF NOT EXISTS signer TEXT;
ALTER TABLE booth_svc_tasks ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE booth_svc_tasks ADD COLUMN IF NOT EXISTS service_category TEXT DEFAULT 'customer';
ALTER TABLE booth_svc_tasks ADD COLUMN IF NOT EXISTS service_type TEXT;
ALTER TABLE booth_inventory ADD COLUMN IF NOT EXISTS warehouse_type TEXT DEFAULT 'material';
ALTER TABLE booth_stock_batches ADD COLUMN IF NOT EXISTS warehouse_type TEXT DEFAULT 'material';

-- 工单 D：供应商管理 + 结算
CREATE TABLE IF NOT EXISTS booth_suppliers (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  name TEXT NOT NULL,
  contact_person TEXT,
  contact_phone TEXT,
  payment_terms INTEGER DEFAULT 0,
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, name)
);

CREATE TABLE IF NOT EXISTS booth_supplier_settlements (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  supplier_id INTEGER NOT NULL REFERENCES booth_suppliers(id),
  po_id INTEGER REFERENCES booth_purchase_orders(id),
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  settled_at TIMESTAMPTZ,
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 工单 D 补丁：FAB 产线阶段
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS production_stage TEXT DEFAULT 'preprocessing';
-- production_stage 取值: preprocessing(前置工序) / production(制作) / packaging(包装) / sorting(分拣)

-- ====== 工单 C2：Booth-DU 本店供应商层 ======

-- 扩展 booth_suppliers 表（本店供应商档案）
ALTER TABLE booth_suppliers ADD COLUMN IF NOT EXISTS supplier_code TEXT;
ALTER TABLE booth_suppliers ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE booth_suppliers ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE booth_suppliers ADD COLUMN IF NOT EXISTS qualifications TEXT;
ALTER TABLE booth_suppliers ADD COLUMN IF NOT EXISTS business_license TEXT;
ALTER TABLE booth_suppliers ADD COLUMN IF NOT EXISTS admission_status TEXT DEFAULT 'admitted';
-- admission_status: pending(待审核) / admitted(已准入) / rejected(已驳回) / exited(已退出)
ALTER TABLE booth_suppliers ADD COLUMN IF NOT EXISTS admission_remark TEXT;
ALTER TABLE booth_suppliers ADD COLUMN IF NOT EXISTS admission_reviewed_at TIMESTAMPTZ;
ALTER TABLE booth_suppliers ADD COLUMN IF NOT EXISTS admission_reviewed_by INTEGER REFERENCES booth_users(id);

-- 本店供应商合同表
CREATE TABLE IF NOT EXISTS booth_du_supplier_contracts (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  supplier_id BIGINT NOT NULL REFERENCES booth_suppliers(id) ON DELETE CASCADE,
  contract_no TEXT NOT NULL,
  contract_name TEXT,
  start_date DATE,
  end_date DATE,
  terms_summary TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  -- status: draft(草稿) / active(生效) / expired(到期) / terminated(终止)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, contract_no)
);

-- C2 索引
CREATE INDEX IF NOT EXISTS idx_du_suppliers_org_admission ON booth_suppliers(org_id, admission_status);
CREATE INDEX IF NOT EXISTS idx_du_contracts_org_supplier ON booth_du_supplier_contracts(org_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_du_contracts_end_date ON booth_du_supplier_contracts(end_date);
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS production_stage TEXT DEFAULT 'preprocessing';
-- production_stage 取值: preprocessing(前置工序) / production(制作) / packaging(包装) / sorting(分拣)

-- 良品率追踪表
CREATE TABLE IF NOT EXISTS booth_yield_records (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  work_order_id BIGINT NOT NULL,
  production_stage TEXT NOT NULL,
  input_qty INTEGER NOT NULL DEFAULT 0,
  good_qty INTEGER NOT NULL DEFAULT 0,
  defect_qty INTEGER NOT NULL DEFAULT 0,
  scrap_qty INTEGER NOT NULL DEFAULT 0,
  yield_rate NUMERIC(5,2) DEFAULT 0,
  defect_reason TEXT,
  operator_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 库存调拨单表
CREATE TABLE IF NOT EXISTS booth_transfer_orders (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  transfer_no TEXT NOT NULL UNIQUE,
  from_warehouse_type TEXT NOT NULL,
  to_warehouse_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  remark TEXT,
  created_by BIGINT,
  approved_by BIGINT,
  approved_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 库存调拨明细表
CREATE TABLE IF NOT EXISTS booth_transfer_items (
  id BIGSERIAL PRIMARY KEY,
  transfer_id BIGINT NOT NULL REFERENCES booth_transfer_orders(id),
  sku_id BIGINT NOT NULL,
  sku_name TEXT,
  qty INTEGER NOT NULL DEFAULT 0,
  batch_id BIGINT,
  remark TEXT
);

-- ====== 工单 C1：EM 全局供应链层 ======

-- EM：供应商准入（生态级）
CREATE TABLE IF NOT EXISTS booth_em_supplier_admissions (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  supplier_code TEXT NOT NULL UNIQUE,
  supplier_name TEXT NOT NULL,
  contact_person TEXT,
  contact_phone TEXT,
  business_license TEXT,
  category TEXT,
  region TEXT,
  status TEXT NOT NULL DEFAULT 'applied',
  -- status: applied(已申请) / reviewed(已审核) / admitted(已准入) / rejected(已拒绝) / exited(已退出)
  score INTEGER DEFAULT 0,
  level TEXT DEFAULT 'C',
  -- level: A(战略) / B(核心) / C(普通)
  reject_reason TEXT,
  exit_reason TEXT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by BIGINT,
  admitted_at TIMESTAMPTZ,
  exited_at TIMESTAMPTZ,
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- EM：供给策略
CREATE TABLE IF NOT EXISTS booth_em_supply_strategies (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  priority_mode TEXT NOT NULL DEFAULT 'fifo',
  -- priority_mode: fifo(先进先出) / fefo(先效先出) / priority(按优先级)
  source_tier TEXT NOT NULL DEFAULT 'tier1',
  -- source_tier: tier1(一级货源) / tier2(二级货源) / tier3(三级货源)
  quota_type TEXT NOT NULL DEFAULT 'fixed',
  -- quota_type: fixed(固定配额) / ratio(比例配额) / dynamic(动态配额)
  quota_value NUMERIC(12,2) DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- EM：产能规划
CREATE TABLE IF NOT EXISTS booth_em_capacity_plans (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  period_type TEXT NOT NULL DEFAULT 'monthly',
  -- period_type: daily(日) / weekly(周) / monthly(月)
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_capacity NUMERIC(12,3) NOT NULL DEFAULT 0,
  allocated_capacity NUMERIC(12,3) NOT NULL DEFAULT 0,
  remaining_capacity NUMERIC(12,3) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  -- status: draft(草稿) / active(生效) / completed(完成) / cancelled(取消)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- EM：产能分配明细
CREATE TABLE IF NOT EXISTS booth_em_capacity_allocations (
  id BIGSERIAL PRIMARY KEY,
  plan_id BIGINT NOT NULL REFERENCES booth_em_capacity_plans(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  -- target_type: shop(店铺) / product(商品)
  target_id BIGINT,
  target_name TEXT NOT NULL,
  allocated_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  used_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- EM 供应链层索引
CREATE INDEX IF NOT EXISTS idx_em_admission_org_status ON booth_em_supplier_admissions(org_id, status);
CREATE INDEX IF NOT EXISTS idx_em_strategy_org ON booth_em_supply_strategies(org_id);
CREATE INDEX IF NOT EXISTS idx_em_capacity_plan_org ON booth_em_capacity_plans(org_id, status);
CREATE INDEX IF NOT EXISTS idx_em_capacity_alloc_plan ON booth_em_capacity_allocations(plan_id);

-- ====== 工单 C3：采购系统增强 + Market 通货售卖 ======

-- C3-A: 采购系统增强 - 扩展 booth_purchase_orders 表
ALTER TABLE booth_purchase_orders ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES booth_suppliers(id);
ALTER TABLE booth_purchase_orders ADD COLUMN IF NOT EXISTS expected_delivery_date DATE;
ALTER TABLE booth_purchase_orders ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
-- 状态机: draft → submitted(pending) → approved → in_progress → received / rejected

-- C3-B: Market 通货商品表（EM/EMX 管理）
CREATE TABLE IF NOT EXISTS booth_market_products (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  -- 生态级商品，org_id 为 EM 所属组织
  product_name TEXT NOT NULL,
  product_code TEXT,
  specification TEXT,
  unit TEXT NOT NULL DEFAULT '件',
  unit_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  stock_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  supplier_id BIGINT REFERENCES booth_suppliers(id),
  supplier_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  -- status: draft(草稿) / active(上架) / inactive(下架) / sold_out(售罄)
  description TEXT,
  images TEXT[] DEFAULT '{}',
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- C3-B: Market 供应商准入（生态级，EM 管理）
CREATE TABLE IF NOT EXISTS booth_market_supplier_admissions (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  -- 与 booth_em_supplier_admissions 类似，但专用于 Market 侧
  supplier_name TEXT NOT NULL,
  contact_person TEXT,
  contact_phone TEXT,
  business_license TEXT,
  qualifications TEXT,
  category TEXT,
  region TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  -- status: pending(待审核) / approved(已准入) / rejected(已驳回) / exited(已退出)
  review_remark TEXT,
  reviewed_by BIGINT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- C3-B: Market 订单表（顾客下单）
CREATE TABLE IF NOT EXISTS booth_market_orders (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  order_no TEXT NOT NULL UNIQUE,
  customer_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  items JSONB NOT NULL DEFAULT '[]',
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  -- status: pending(待处理) / confirmed(已确认) / fulfilling(履约中) / completed(已完成) / cancelled(已取消)
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- C3 索引
CREATE INDEX IF NOT EXISTS idx_market_products_org_status ON booth_market_products(org_id, status);
CREATE INDEX IF NOT EXISTS idx_market_admissions_org_status ON booth_market_supplier_admissions(org_id, status);
CREATE INDEX IF NOT EXISTS idx_market_orders_org_status ON booth_market_orders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_po_supplier_id ON booth_purchase_orders(supplier_id);

-- ====== 工单 FAB-OPT-01：Job 模型对齐 BOOTH-S-A1.0 ======

-- Station 表（工位/工作站）
CREATE TABLE IF NOT EXISTS booth_stations (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  type TEXT NOT NULL,
  -- type: FAB / WH / DL / SVC
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline',
  -- status: online / offline / busy
  capacity INTEGER NOT NULL DEFAULT 1,
  current_load INTEGER NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, name)
);

-- 扩展 booth_work_orders 为 Job 模型
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS job_id TEXT;
-- job_id: 业务号 J-xxx
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS job_type TEXT DEFAULT 'PRODUCE';
-- job_type: PICK / PACK / SHIP / SERVE / PRODUCE
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS station_id BIGINT REFERENCES booth_stations(id);
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}';
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 5;
-- priority: 1-10, 10 最高
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS sla_minutes INTEGER;
-- SLA 分钟数
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ;
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- 状态映射说明：
-- 旧状态 → 新状态（兼容期同时支持两种写法）
-- pending → Pending
-- accepted → Accepted  
-- preparing → Running
-- completed → Completed
-- cancelled → Cancelled
-- 新增：Dispatched (已派单待接单), Failed (失败), Archived (归档)

-- 为现有工单生成 job_id（如果为空）
UPDATE booth_work_orders SET job_id = 'J-' || LPAD(id::TEXT, 6, '0') WHERE job_id IS NULL;

-- FAB-OPT-01 索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_orders_job_id ON booth_work_orders(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_orders_org_status ON booth_work_orders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_work_orders_station ON booth_work_orders(station_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_priority ON booth_work_orders(priority DESC);
CREATE INDEX IF NOT EXISTS idx_stations_org_type ON booth_stations(org_id, type);
CREATE INDEX IF NOT EXISTS idx_stations_status ON booth_stations(status);

-- ====== WH-SUPPLY-01：供给执行单元 ======

-- 供给单
CREATE TABLE IF NOT EXISTS booth_supply_orders (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  supply_no TEXT NOT NULL UNIQUE,
  supply_type TEXT NOT NULL DEFAULT 'material',
  -- supply_type: material(原料) / device(设备) / plaza(场地)
  target_type TEXT,
  -- target_type: production_line(产线) / work_order(工单) / station(工位) / service(服务单)
  target_id BIGINT,
  target_name TEXT,
  from_warehouse_type TEXT DEFAULT 'material',
  -- 来源仓类型: material / device / plaza
  sku_id BIGINT,
  sku_name TEXT,
  qty NUMERIC(12,3) DEFAULT 0,
  unit TEXT,
  device_id BIGINT,
  plaza_resource_id BIGINT,
  status TEXT NOT NULL DEFAULT 'pending',
  -- status: pending(待执行) / dispatched(已下发) / supplied(已供给) / returned(已退回) / cancelled(已取消)
  remark TEXT,
  created_by BIGINT,
  supplied_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supply_org_type ON booth_supply_orders(org_id, supply_type);
CREATE INDEX IF NOT EXISTS idx_supply_org_status ON booth_supply_orders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_supply_target ON booth_supply_orders(target_type, target_id);

-- 设备档案
CREATE TABLE IF NOT EXISTS booth_devices (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  device_code TEXT NOT NULL,
  device_name TEXT NOT NULL,
  device_type TEXT,
  -- device_type: production(生产设备) / packaging(包装设备) / sorting(分拣设备) / auxiliary(辅助设备)
  serial_no TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  -- status: idle(空闲) / in_use(使用中) / maintenance(维保中) / retired(已报废)
  location TEXT,
  assigned_line TEXT,
  -- 当前分配到的产线
  purchase_date DATE,
  warranty_until DATE,
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, device_code)
);

CREATE INDEX IF NOT EXISTS idx_devices_org_status ON booth_devices(org_id, status);

-- 设备维保履历
CREATE TABLE IF NOT EXISTS booth_device_maintenance_logs (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  device_id BIGINT NOT NULL REFERENCES booth_devices(id),
  maintenance_type TEXT NOT NULL DEFAULT 'routine',
  -- maintenance_type: routine(日常保养) / repair(维修) / inspection(巡检) / calibration(校准)
  description TEXT,
  operator_id BIGINT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cost NUMERIC(12,2) DEFAULT 0,
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_maintenance_device ON booth_device_maintenance_logs(device_id);

-- 场地资源池 (Plaza)
CREATE TABLE IF NOT EXISTS booth_plaza_resources (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  resource_code TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  plaza_type TEXT NOT NULL DEFAULT 'standard',
  -- plaza_type: standard(标准铺位) / cold_storage(冷藏区) / hot_zone(热区) / storage(仓储区)
  area_sqm NUMERIC(8,2) DEFAULT 0,
  capacity INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available',
  -- status: available(可用) / booked(已预订) / occupied(占用中) / maintenance(维护中)
  location TEXT,
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, resource_code)
);

CREATE INDEX IF NOT EXISTS idx_plaza_org_status ON booth_plaza_resources(org_id, status);

-- 场地预订记录
CREATE TABLE IF NOT EXISTS booth_plaza_bookings (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  resource_id BIGINT NOT NULL REFERENCES booth_plaza_resources(id),
  booking_no TEXT NOT NULL UNIQUE,
  booker_id BIGINT,
  purpose TEXT,
  -- 用途: production / storage / event / display
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked',
  -- status: booked(已预订) / checked_in(已入驻) / released(已释放) / cancelled(已取消)
  billing_amount NUMERIC(12,2) DEFAULT 0,
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plaza_bookings_resource ON booth_plaza_bookings(resource_id);
CREATE INDEX IF NOT EXISTS idx_plaza_bookings_org_status ON booth_plaza_bookings(org_id, status);

-- ====== BOOTH-OPT-01：ATP 产能与交期承诺 ======

-- 产能资源表（产线/工位/人力，含 traffic_cap 容量上限）
CREATE TABLE IF NOT EXISTS booth_capacity_resources (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  resource_code TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  resource_type TEXT NOT NULL DEFAULT 'line',
  -- resource_type: line(产线) / station(工位) / labor(人力)
  traffic_cap INTEGER NOT NULL DEFAULT 0,
  -- 容量上限（A1.35 对齐）：单位时段最大产出/处理量
  unit TEXT NOT NULL DEFAULT '件/小时',
  -- 产能单位
  shift_hours_per_day NUMERIC(4,1) DEFAULT 8,
  -- 每日有效工时
  efficiency_rate NUMERIC(4,2) DEFAULT 1.00,
  -- 效率系数 (0~1)
  status TEXT NOT NULL DEFAULT 'active',
  -- status: active(启用) / inactive(停用) / maintenance(维护中)
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, resource_code)
);

CREATE INDEX IF NOT EXISTS idx_cap_res_org_type ON booth_capacity_resources(org_id, resource_type);
CREATE INDEX IF NOT EXISTS idx_cap_res_org_status ON booth_capacity_resources(org_id, status);

-- 产能负荷记录（资源 + 时段 + 占用量）
CREATE TABLE IF NOT EXISTS booth_capacity_load (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  resource_id BIGINT NOT NULL REFERENCES booth_capacity_resources(id),
  slot_date DATE NOT NULL,
  -- 时段日期
  slot_hour INTEGER DEFAULT 0,
  -- 时段小时 (0~23)，0 表示日级汇总
  occupied_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  -- 已占用量
  ref_type TEXT,
  -- ref_type: work_order(工单) / fulfillment(履约单) / market_order(市场订单)
  ref_id BIGINT,
  -- 关联单据 ID
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cap_load_resource_date ON booth_capacity_load(resource_id, slot_date);
CREATE INDEX IF NOT EXISTS idx_cap_load_org_date ON booth_capacity_load(org_id, slot_date);

-- ATP 可承诺量与交期承诺记录
CREATE TABLE IF NOT EXISTS booth_atp_commitments (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  commitment_no TEXT NOT NULL UNIQUE,
  -- 来源
  source_type TEXT NOT NULL DEFAULT 'market_order',
  -- source_type: market_order(市场订单) / internal(内部)
  source_id BIGINT,
  -- 来源单据 ID
  -- 请求参数
  requested_qty INTEGER NOT NULL DEFAULT 0,
  requested_product TEXT,
  -- 承诺结果
  atp_qty INTEGER NOT NULL DEFAULT 0,
  -- 可承诺量
  earliest_date TIMESTAMPTZ,
  -- 最早可交付时点
  queue_position INTEGER DEFAULT 0,
  -- 排队位置
  status TEXT NOT NULL DEFAULT 'pending',
  -- status: pending(待确认) / confirmed(已确认) / rejected(已拒绝) / expired(已过期)
  confirmed_at TIMESTAMPTZ,
  confirmed_by BIGINT,
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_atp_org_status ON booth_atp_commitments(org_id, status);
CREATE INDEX IF NOT EXISTS idx_atp_source ON booth_atp_commitments(source_type, source_id);

-- ====== [O2] BOOTH-OPT-02: SGU 供给目录（目录/挂牌/Shop新品订阅） ======
-- SGU Catalog (供给目录)
CREATE TABLE IF NOT EXISTS booth_sgu_catalog (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  sgu_no VARCHAR(50) NOT NULL UNIQUE,
  sku_id INTEGER NOT NULL REFERENCES booth_skus(id),
  booth_type VARCHAR(20) NOT NULL, -- sundry/material/device/plaza
  status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft/active/suspended/delisted
  capacity_resource_id INTEGER REFERENCES booth_capacity_resources(id),
  traffic_cap INTEGER DEFAULT 0,
  lead_time_hours INTEGER DEFAULT 24,
  unit_price INTEGER DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'CNY',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SGU Listings (挂牌记录 - 面向Market的对外条目)
CREATE TABLE IF NOT EXISTS booth_sgu_listings (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  sgu_id INTEGER NOT NULL REFERENCES booth_sgu_catalog(id),
  listing_no VARCHAR(50) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending/listed/delisted/suspended
  market_visible BOOLEAN NOT NULL DEFAULT FALSE,
  listed_at TIMESTAMPTZ,
  delisted_at TIMESTAMPTZ,
  external_ref VARCHAR(100), -- Market侧引用ID
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SKU-Created subscription triggers (Shop新品触发Booth创建SGU的待办)
CREATE TABLE IF NOT EXISTS booth_sgu_pending (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  sku_id INTEGER NOT NULL REFERENCES booth_skus(id),
  source VARCHAR(50) NOT NULL DEFAULT 'sku-created', -- SKU-Created event
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending/created/ignored
  suggested_booth_type VARCHAR(20),
  created_by INTEGER REFERENCES booth_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sgu_catalog_org_type ON booth_sgu_catalog(org_id, booth_type);
CREATE INDEX IF NOT EXISTS idx_sgu_catalog_status ON booth_sgu_catalog(status);
CREATE INDEX IF NOT EXISTS idx_sgu_listings_org ON booth_sgu_listings(org_id);
CREATE INDEX IF NOT EXISTS idx_sgu_listings_status ON booth_sgu_listings(status);
CREATE INDEX IF NOT EXISTS idx_sgu_pending_org ON booth_sgu_pending(org_id, status);

-- ====== [O3] BOOTH-OPT-03: 供给报价（三层价格体系/版本/审计） ======
-- Supply Quotes (供给报价单 - 三层价格体系)
CREATE TABLE IF NOT EXISTS booth_supply_quotes (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  quote_no VARCHAR(50) NOT NULL UNIQUE,
  sgu_id INTEGER REFERENCES booth_sgu_catalog(id),
  sku_id INTEGER REFERENCES booth_skus(id),
  -- 成本构成 (仅EU决策层可见完整构成)
  bom_material_cost NUMERIC(12,2) DEFAULT 0, -- BOM材料成本
  labor_cost NUMERIC(12,2) DEFAULT 0, -- 人工费
  manufacturing_fee NUMERIC(12,2) DEFAULT 0, -- 制造/服务费
  -- 价格
  supply_price NUMERIC(12,2) NOT NULL DEFAULT 0, -- 供给价 = BOM + 人工 + 制造费
  margin_rate NUMERIC(5,2) DEFAULT 0, -- 毛利率 %
  gross_profit NUMERIC(12,2) DEFAULT 0, -- 毛利额
  total_price NUMERIC(12,2) NOT NULL DEFAULT 0, -- 总价 = 供给价 + 毛利
  -- 版本与状态
  version INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft/pending/approved/rejected/expired
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,
  -- 审计
  created_by INTEGER REFERENCES booth_users(id),
  approved_by INTEGER REFERENCES booth_users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Supply Quote Versions (报价版本历史)
CREATE TABLE IF NOT EXISTS booth_supply_quote_versions (
  id SERIAL PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES booth_supply_quotes(id),
  version INTEGER NOT NULL,
  -- 快照字段
  bom_material_cost NUMERIC(12,2),
  labor_cost NUMERIC(12,2),
  manufacturing_fee NUMERIC(12,2),
  supply_price NUMERIC(12,2),
  margin_rate NUMERIC(5,2),
  gross_profit NUMERIC(12,2),
  total_price NUMERIC(12,2),
  status VARCHAR(20),
  changed_by INTEGER REFERENCES booth_users(id),
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Supply Quote Audit Log (报价变更审计)
CREATE TABLE IF NOT EXISTS booth_supply_quote_audit (
  id SERIAL PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES booth_supply_quotes(id),
  action VARCHAR(50) NOT NULL, -- created/updated/approved/rejected/expired
  actor_id INTEGER REFERENCES booth_users(id),
  old_values JSONB,
  new_values JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supply_quotes_org ON booth_supply_quotes(org_id);
CREATE INDEX IF NOT EXISTS idx_supply_quotes_sgu ON booth_supply_quotes(sgu_id);
CREATE INDEX IF NOT EXISTS idx_supply_quotes_status ON booth_supply_quotes(status);
CREATE INDEX IF NOT EXISTS idx_supply_quote_versions_quote ON booth_supply_quote_versions(quote_id, version);
CREATE INDEX IF NOT EXISTS idx_supply_quote_audit_quote ON booth_supply_quote_audit(quote_id);

-- [FAB-MES-02] 质量追溯链: 质检关卡扩展 + 产出批次 + 追溯关系
ALTER TABLE booth_quality_checks ADD COLUMN IF NOT EXISTS check_type TEXT NOT NULL DEFAULT 'fqc';
ALTER TABLE booth_quality_checks ADD COLUMN IF NOT EXISTS stage TEXT;

CREATE TABLE IF NOT EXISTS booth_output_batches (
  id SERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  work_order_id BIGINT NOT NULL,
  batch_no TEXT NOT NULL,
  sku_id BIGINT,
  qty NUMERIC(12,2) NOT NULL DEFAULT 0,
  quality_status TEXT NOT NULL DEFAULT 'hold',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booth_trace_links (
  id SERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  work_order_id BIGINT NOT NULL,
  batch_id BIGINT,
  direction TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  qty NUMERIC(12,2) NOT NULL DEFAULT 0,
  operator_id BIGINT,
  equipment_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_output_batches_org_no ON booth_output_batches(org_id, batch_no);
CREATE INDEX IF NOT EXISTS idx_output_batches_wo ON booth_output_batches(org_id, work_order_id);
CREATE INDEX IF NOT EXISTS idx_trace_links_wo ON booth_trace_links(org_id, work_order_id);
CREATE INDEX IF NOT EXISTS idx_trace_links_batch ON booth_trace_links(org_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_trace_links_type ON booth_trace_links(org_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_qc_check_type ON booth_quality_checks(org_id, check_type, checked_at);

-- [BOOTH-PK-02] SupplyOrder 显式契约: 扩展 booth_fulfillments 为契约载体(方案A, 不新建表)
ALTER TABLE booth_fulfillments ADD COLUMN IF NOT EXISTS quote_snapshot JSONB;
ALTER TABLE booth_fulfillments ADD COLUMN IF NOT EXISTS milestones JSONB;
ALTER TABLE booth_fulfillments ADD COLUMN IF NOT EXISTS contract_status VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_fulfillments_contract ON booth_fulfillments(org_id, contract_status);

-- 存量单契约化回填(不改原 status 字段, 保证无孤儿订单):
UPDATE booth_fulfillments SET contract_status = 'Cancelled', milestones = COALESCE(milestones, '{}'::jsonb)
WHERE contract_status IS NULL AND status = 'cancelled';
UPDATE booth_fulfillments SET contract_status = 'Settled', milestones = COALESCE(milestones, '{}'::jsonb)
WHERE contract_status IS NULL AND status = 'completed';
UPDATE booth_fulfillments SET contract_status = 'Executing', milestones = COALESCE(milestones, '{}'::jsonb)
WHERE contract_status IS NULL AND status = 'dispatched';
UPDATE booth_fulfillments SET contract_status = 'Created', milestones = COALESCE(milestones, '{}'::jsonb)
WHERE contract_status IS NULL;

-- [BOOTH-PK-01] Station 能力插件(v1.1 能力登记+匹配子集, 复用 booth_stations 作挂载宿主):
-- 能力是执行能力登记层, 执行仍走 booth_fab_operations, 不建并行执行引擎
CREATE TABLE IF NOT EXISTS station_capabilities (
  id SERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  station_id BIGINT NOT NULL,
  capability_code TEXT NOT NULL,
  name TEXT NOT NULL,
  inputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  outputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  estimated_time INTEGER,
  rate NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_station_cap ON station_capabilities(org_id, station_id, capability_code);
CREATE INDEX IF NOT EXISTS idx_station_cap_status ON station_capabilities(org_id, status);

CREATE TABLE IF NOT EXISTS station_capability_mounts (
  id SERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  station_id BIGINT NOT NULL,
  capability_id BIGINT NOT NULL REFERENCES station_capabilities(id) ON DELETE CASCADE,
  mount_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  state TEXT NOT NULL DEFAULT 'registered',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_station_cap_mount ON station_capability_mounts(org_id, station_id, capability_id);
CREATE INDEX IF NOT EXISTS idx_station_cap_mount_station ON station_capability_mounts(org_id, station_id);

-- [BOOTH-PK-03] IoT/边缘自动采集(通道契约先行):
-- 采集通道契约化: ingest 幂等(org+设备+metric+collected_at 唯一) + source=auto 打标 + 内置模拟通道(demo_source=true, 与生产隔离)。
-- 红线: 只登记真实采集数据; 无硬件时以占位接入点存在; 设备为弱关联(不加外键), 不阻塞设备生命周期与 DATA-CLEAN 清理。
CREATE TABLE IF NOT EXISTS equipment_telemetry (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  equipment_id INTEGER NOT NULL,
  metric TEXT NOT NULL,
  value NUMERIC(18,4) NOT NULL,
  collected_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('auto','manual')),
  demo_source BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_telemetry_point ON equipment_telemetry(org_id, equipment_id, metric, collected_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_eq_time ON equipment_telemetry(equipment_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_org_recv ON equipment_telemetry(org_id, received_at DESC);

CREATE TABLE IF NOT EXISTS equipment_telemetry_configs (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  station_id INTEGER,
  equipment_id INTEGER NOT NULL,
  metric TEXT NOT NULL,
  interval_sec INTEGER NOT NULL DEFAULT 60 CHECK (interval_sec >= 1),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  demo_source BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_telemetry_cfg ON equipment_telemetry_configs(org_id, equipment_id, metric);
CREATE INDEX IF NOT EXISTS idx_telemetry_cfg_org ON equipment_telemetry_configs(org_id, enabled);

-- [BOOTH-PK-04] 供给数据资产化 + 履约评分:
-- 评分只基于真实业务数据聚合(fulfillments/quality_checks/andon/trace), 不做假分; 样本不足不给分;
-- 绝不暴露采购价/售价/毛利(价格字段不进入评分与对外响应); 口径快照入表保证透明可复算。
CREATE TABLE IF NOT EXISTS supplier_scores (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  booth_id BIGINT NOT NULL,
  score_date DATE NOT NULL DEFAULT CURRENT_DATE,
  fulfillment_rate NUMERIC(5,2),
  fulfillment_sample INTEGER NOT NULL DEFAULT 0,
  on_time_rate NUMERIC(5,2),
  on_time_sample INTEGER NOT NULL DEFAULT 0,
  quality_rate NUMERIC(5,2),
  quality_sample INTEGER NOT NULL DEFAULT 0,
  response_time NUMERIC(10,2),
  response_sample INTEGER NOT NULL DEFAULT 0,
  trace_rate NUMERIC(5,2),
  trace_sample INTEGER NOT NULL DEFAULT 0,
  overall_score NUMERIC(5,2),
  weights_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_score ON supplier_scores(org_id, booth_id, score_date);
CREATE INDEX IF NOT EXISTS idx_supplier_scores_booth ON supplier_scores(booth_id, score_date DESC);

-- 评分口径配置: EM/EU 可配置各指标权重与样本门槛; 对外只读
CREATE TABLE IF NOT EXISTS supplier_score_configs (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  weights JSONB NOT NULL DEFAULT '{"fulfillment":0.25,"on_time":0.25,"quality":0.25,"response":0.1,"trace":0.15}'::jsonb,
  min_samples INTEGER NOT NULL DEFAULT 3,
  window_days INTEGER NOT NULL DEFAULT 90,
  updated_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_score_cfg ON supplier_score_configs(org_id);

-- [BOOTH-PK-05] 业财闭环: XCase 专案 / VCase 总账 / 对账
-- 红线: 只基于真实履约业务数据; vcase 凭 source_voucher 幂等去重(重复投递不重复入账); 不破坏 outbox 机制
CREATE TABLE IF NOT EXISTS booth_xcases (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  xcase_no VARCHAR(40) NOT NULL,
  business_type VARCHAR(40) NOT NULL DEFAULT 'booth_fulfillment',
  title VARCHAR(120),
  parties JSONB NOT NULL DEFAULT '[]'::jsonb,
  fulfillment_id BIGINT,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_xcase_no ON booth_xcases(org_id, xcase_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_xcase_fulfillment ON booth_xcases(org_id, fulfillment_id) WHERE fulfillment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_xcases_status ON booth_xcases(org_id, status);

CREATE TABLE IF NOT EXISTS booth_vouchers (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  xcase_id BIGINT NOT NULL REFERENCES booth_xcases(id) ON DELETE CASCADE,
  voucher_no VARCHAR(40) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('income','expense')),
  category VARCHAR(20) NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  summary VARCHAR(200),
  source_voucher VARCHAR(80) NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_voucher_source ON booth_vouchers(org_id, source_voucher);
CREATE INDEX IF NOT EXISTS idx_vouchers_case ON booth_vouchers(xcase_id);

CREATE TABLE IF NOT EXISTS booth_vcase_entries (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  vcase_no VARCHAR(40) NOT NULL,
  xcase_id BIGINT NOT NULL,
  xcase_no VARCHAR(40) NOT NULL,
  direction VARCHAR(10) NOT NULL,
  category VARCHAR(20) NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  source_voucher VARCHAR(80) NOT NULL,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vcase_source ON booth_vcase_entries(org_id, source_voucher);
CREATE INDEX IF NOT EXISTS idx_vcase_no ON booth_vcase_entries(org_id, vcase_no);
`;

// In-memory store for org modes
export const orgModes = new Map<number, string>();

// ---------------------------------------------------------------------------
// migrate() 执行流程（单事务，幂等）:
//   1. 执行三大 schema 基线: DDL([V1][V2]) → INDEXES → ALTERS([E0]~[O3])
//   2. 库非空(已有组织)路径: 加载 orgModes → Outbox 死信清理 → 角色迁移
//      → 账号补种(dx/dm/dxx/em) → Station-OS 升级与编码回填
//      → [M1]设备台账 → [M3]安灯三表 → 工序.equipment_id → sku_cost 播种
//   3. 库空路径(首次): 全量种子(组织/用户/SKU/BOM/库存)并回拨序列
//   任何一步失败整体 ROLLBACK，下次启动重放（幂等约定见文件头）。
// ---------------------------------------------------------------------------
export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Execute DDL
    await client.query(DDL);
    await client.query(INDEXES);
    await client.query(ALTERS);

    // Check if seed data already exists
    const orgCheck = await client.query('SELECT COUNT(*) as cnt FROM booth_orgs');
    if (parseInt(orgCheck.rows[0].cnt) > 0) {
      // Load org modes into memory even if seed is skipped
      const orgs = await client.query('SELECT id, mode FROM booth_orgs');
      for (const row of orgs.rows) {
        orgModes.set(row.id, row.mode);
      }

      // Cleanup: mark stale outbox events (retry_count >= MAX_RETRIES) as dead
      const staleResult = await client.query(
        `UPDATE booth_outbox SET status = 'dead' WHERE status = 'pending' AND retry_count >= 10`
      );
      if (staleResult.rowCount && staleResult.rowCount > 0) {
        console.log(`[migrate] Marked ${staleResult.rowCount} stale outbox events as dead.`);
      }

      // Role migration: dex→ex (BOOTH-ROLE-CLEAN-01 C1 裁定 DEX 废弃，铺长线统一 EX)；exx→dexx 铺员线另单处理 (idempotent)
      const roleUpdates = [
        { from: 'dex', to: 'ex' },
        { from: 'exx', to: 'dexx' },
      ];
      for (const { from, to } of roleUpdates) {
        const r = await client.query(`UPDATE booth_users SET role = $1 WHERE role = $2`, [to, from]);
        if (r.rowCount && r.rowCount > 0) {
          console.log(`[migrate] Renamed role '${from}' → '${to}' (${r.rowCount} users).`);
        }
      }

      // Add dx (店长) user if not exists
      const dxCheck = await client.query(`SELECT id FROM booth_users WHERE phone = '13800000004'`);
      if (dxCheck.rows.length === 0) {
        const hash = bcrypt.hashSync('123456', 10);
        await client.query(
          `INSERT INTO booth_users (org_id, name, phone, password_hash, role, hats)
           VALUES (1, '店长', '13800000004', $1, 'dx', '{}')`,
          [hash]
        );
        console.log('[migrate] Added dx user: 店长 / 13800000004.');
      }

      // Update dexx hats to include all modules
      await client.query(
        `UPDATE booth_users SET hats = '{FAB,WH,DL,SVC}' WHERE role = 'dexx' AND org_id = 1`
      );

      // Add DM (运营) user if not exists
      const dmCheck = await client.query(`SELECT id FROM booth_users WHERE phone = '13800000000'`);
      if (dmCheck.rowCount === 0) {
        const dmHash = bcrypt.hashSync('123456', 10);
        await client.query(
          `INSERT INTO booth_users (org_id, name, phone, password_hash, role, hats)
           VALUES (1, '运营', '13800000000', $1, 'dm', '{}')`,
          [dmHash]
        );
        console.log('[migrate] Added dm user: 运营 / 13800000000.');
      }

      // Add DXX (店员) user if not exists
      const dxxCheck = await client.query(`SELECT id FROM booth_users WHERE phone = '13800000005'`);
      if (dxxCheck.rowCount === 0) {
        const dxxHash = bcrypt.hashSync('123456', 10);
        await client.query(
          `INSERT INTO booth_users (org_id, name, phone, password_hash, role, hats)
           VALUES (1, '店员', '13800000005', $1, 'dxx', '{}')`,
          [dxxHash]
        );
        console.log('[migrate] Added dxx user: 店员 / 13800000005.');
      }

      // Add EM (供给运营长) user if not exists
      const emCheck = await client.query(`SELECT id FROM booth_users WHERE phone = '13800000006'`);
      if (emCheck.rowCount === 0) {
        const emHash = bcrypt.hashSync('123456', 10);
        await client.query(
          `INSERT INTO booth_users (org_id, name, phone, password_hash, role, hats)
           VALUES (1, '供给运营长', '13800000006', $1, 'em', '{}')`,
          [emHash]
        );
        console.log('[migrate] Added em user: 供给运营长 / 13800000006.');
      }

      // FAB-MES-05: Station-OS 产线/作业站融合 - booth_stations 升级为 Station 实体
      await client.query(
        `ALTER TABLE booth_stations ADD COLUMN IF NOT EXISTS code TEXT;
         ALTER TABLE booth_stations ADD COLUMN IF NOT EXISTS zone_type TEXT;
         ALTER TABLE booth_stations ADD COLUMN IF NOT EXISTS station_type TEXT DEFAULT 'manual';
         ALTER TABLE booth_stations ADD COLUMN IF NOT EXISTS state TEXT DEFAULT 'provisioning';
         ALTER TABLE booth_stations ADD COLUMN IF NOT EXISTS fault_strategy TEXT DEFAULT 'bypass';
         ALTER TABLE booth_stations ADD COLUMN IF NOT EXISTS traffic_cap NUMERIC DEFAULT 0;
         ALTER TABLE booth_stations ADD COLUMN IF NOT EXISTS bottleneck_rate NUMERIC DEFAULT 0;
         ALTER TABLE booth_stations ADD COLUMN IF NOT EXISTS offline_mode BOOLEAN DEFAULT FALSE;`
      );
      // 兼容映射: 旧 status → 新 state (online→idle, offline→down, busy→busy)
      await client.query(
        `UPDATE booth_stations SET state = 'idle' WHERE status = 'online' AND (state IS NULL OR state = 'provisioning');
         UPDATE booth_stations SET state = 'down' WHERE status = 'offline' AND (state IS NULL OR state = 'provisioning');
         UPDATE booth_stations SET state = 'busy' WHERE status = 'busy' AND (state IS NULL OR state = 'provisioning');
         UPDATE booth_stations SET zone_type = type WHERE zone_type IS NULL;
         UPDATE booth_stations SET traffic_cap = capacity WHERE traffic_cap = 0;`
      );
      // 生成规范编码: {org_id}.{ZONE}.{STATION_TYPE}-{seq} (seq 从已有编码最大值续号, 避免唯一索引碰撞)
      const stationRows = await client.query(
        `SELECT id, org_id, type, station_type FROM booth_stations WHERE code IS NULL OR code = '' ORDER BY id`
      );
      const existingMax = await client.query(
        `SELECT org_id, code FROM booth_stations WHERE code IS NOT NULL AND code <> ''`
      );
      const typeSeqCount: Record<string, number> = {};
      const seqRe = /-(\d+)$/;
      for (const row of existingMax.rows) {
        const m = seqRe.exec(String(row.code));
        if (!m) continue;
        const parts = String(row.code).split('.');
        if (parts.length < 3) continue;
        const stTypePart = parts[2].split('-')[0];
        const key = `${row.org_id}.${parts[1]}.${stTypePart}`;
        const seq = parseInt(m[1], 10);
        if (!(key in typeSeqCount) || seq > typeSeqCount[key]) typeSeqCount[key] = seq;
      }
      for (const st of stationRows.rows) {
        const zoneUpper = String(st.type || 'FAB').toUpperCase();
        const stType = String(st.station_type || 'manual').toUpperCase();
        const seqKey = `${st.org_id}.${zoneUpper}.${stType}`;
        typeSeqCount[seqKey] = (typeSeqCount[seqKey] || 0) + 1;
        const code = `${st.org_id}.${zoneUpper}.${stType}-${String(typeSeqCount[seqKey]).padStart(3, '0')}`;
        await client.query(`UPDATE booth_stations SET code = $1 WHERE id = $2`, [code, st.id]);
      }
      if (stationRows.rows.length > 0) {
        console.log(`[migrate] Generated codes for ${stationRows.rows.length} stations.`);
      }
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_stations_org_code ON booth_stations(org_id, code);`
      );

      // ===== FAB-MES-01: 设备台账 + OEE 稼动率 =====
      await client.query(`
        CREATE TABLE IF NOT EXISTS booth_equipment (
          id SERIAL PRIMARY KEY,
          org_id INTEGER NOT NULL DEFAULT 1 REFERENCES booth_orgs(id),
          station_id INTEGER REFERENCES booth_stations(id),
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          type TEXT DEFAULT 'device',
          status TEXT NOT NULL DEFAULT 'idle',
          rated_capacity NUMERIC DEFAULT 0,
          purchase_date DATE,
          last_maintenance_at TIMESTAMPTZ,
          maintenance_cycle_days INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_org_code ON booth_equipment(org_id, code);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_equipment_station ON booth_equipment(station_id);`);
      await client.query(`ALTER TABLE booth_equipment ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS booth_equipment_status_log (
          id SERIAL PRIMARY KEY,
          org_id INTEGER NOT NULL DEFAULT 1 REFERENCES booth_orgs(id),
          equipment_id INTEGER NOT NULL REFERENCES booth_equipment(id),
          from_status TEXT,
          to_status TEXT NOT NULL,
          reason TEXT,
          operator_id INTEGER,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ended_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_equipment_log_equip ON booth_equipment_status_log(equipment_id, started_at);`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS booth_maintenance_plans (
          id SERIAL PRIMARY KEY,
          org_id INTEGER NOT NULL DEFAULT 1 REFERENCES booth_orgs(id),
          equipment_id INTEGER NOT NULL REFERENCES booth_equipment(id),
          plan_name TEXT NOT NULL,
          cycle_days INTEGER DEFAULT 30,
          last_done_at TIMESTAMPTZ,
          next_due_at TIMESTAMPTZ,
          assignee_id INTEGER,
          status TEXT NOT NULL DEFAULT 'pending',
          remark TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_maintenance_plans_org_status ON booth_maintenance_plans(org_id, status);`);

      // ── FAB-MES-03 安灯异常中心 ─────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS booth_andon_events (
          id SERIAL PRIMARY KEY,
          org_id INTEGER NOT NULL DEFAULT 1 REFERENCES booth_orgs(id),
          work_order_id INTEGER,
          station_id INTEGER,
          equipment_id INTEGER,
          type TEXT NOT NULL DEFAULT 'other',
          severity TEXT NOT NULL DEFAULT 'medium',
          message TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open',
          caller_id INTEGER,
          assignee_id INTEGER,
          responded_at TIMESTAMPTZ,
          resolved_at TIMESTAMPTZ,
          solution TEXT,
          auto_generated BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_andon_events_org_status ON booth_andon_events(org_id, status, created_at DESC);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_andon_events_org_severity ON booth_andon_events(org_id, severity, status);`);
      await client.query(`ALTER TABLE booth_andon_events ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN NOT NULL DEFAULT FALSE;`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS booth_andon_escalation (
          id SERIAL PRIMARY KEY,
          event_id INTEGER NOT NULL REFERENCES booth_andon_events(id),
          level INTEGER NOT NULL,
          target TEXT NOT NULL,
          notified_at TIMESTAMPTZ DEFAULT NOW(),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_andon_escalation_event ON booth_andon_escalation(event_id, level);`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS booth_knowledge_candidates (
          id SERIAL PRIMARY KEY,
          org_id INTEGER NOT NULL DEFAULT 1 REFERENCES booth_orgs(id),
          andon_event_id INTEGER,
          title TEXT NOT NULL,
          solution TEXT NOT NULL,
          reporter_id INTEGER,
          status TEXT NOT NULL DEFAULT 'candidate',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_candidates_org ON booth_knowledge_candidates(org_id, status);`);

      // 工序表加 equipment_id（追溯与 OEE 数据基础）
      await client.query(`ALTER TABLE booth_fab_operations ADD COLUMN IF NOT EXISTS equipment_id INTEGER REFERENCES booth_equipment(id);`);

      // Seed sku_cost for all existing SKUs if not exists
      const skuCostCheck = await client.query('SELECT COUNT(*) as cnt FROM booth_sku_cost WHERE org_id = 1');
      if (parseInt(skuCostCheck.rows[0].cnt) === 0) {
        const skus = await client.query('SELECT id FROM booth_skus WHERE org_id = 1');
        for (const sku of skus.rows) {
          await client.query(
            `INSERT INTO booth_sku_cost (org_id, sku_id, unit_cost, total_qty) VALUES (1, $1, 0, 0)`,
            [sku.id]
          );
        }
        console.log(`[migrate] Seeded sku_cost for ${skus.rows.length} SKUs.`);
      }

      await client.query('COMMIT');
      console.log('[migrate] Tables verified, seed data already exists.');
      return;
    }

    const passwordHash = bcrypt.hashSync('123456', 10);

    // Seed org
    await client.query(
      `INSERT INTO booth_orgs (id, shop_id, name, mode) VALUES (1, 1, '知味直营铺', 'du')`
    );

    // Seed users
    await client.query(
      `INSERT INTO booth_users (id, org_id, name, phone, password_hash, role, hats)
       VALUES (1, 1, '店主', '13800000001', $1, 'du', '{}')`,
      [passwordHash]
    );
    await client.query(
      `INSERT INTO booth_users (id, org_id, name, phone, password_hash, role, hats)
       VALUES (2, 1, '店长', '13800000004', $1, 'dx', '{}')`,
      [passwordHash]
    );
    await client.query(
      `INSERT INTO booth_users (id, org_id, name, phone, password_hash, role, hats)
       VALUES (3, 1, '铺长', '13800000002', $1, 'ex', '{}')`,
      [passwordHash]
    );
    await client.query(
      `INSERT INTO booth_users (id, org_id, name, phone, password_hash, role, hats)
       VALUES (4, 1, '铺员', '13800000003', $1, 'dexx', '{FAB,WH,DL,SVC}')`,
      [passwordHash]
    );

    // Fix sequence for users
    await client.query(`SELECT setval('booth_users_id_seq', 4, true)`);

    // Seed SKUs
    const skus = [
      { code: 'FLOUR', name: '面粉', unit: 'g', safety: 500, cost: 50 },
      { code: 'BEEF', name: '牛肉', unit: 'g', safety: 1000, cost: 800 },
      { code: 'LETTUCE', name: '生菜', unit: 'g', safety: 500, cost: 30 },
      { code: 'TOMATO', name: '番茄', unit: 'g', safety: 500, cost: 40 },
      { code: 'BOX', name: '包装盒', unit: '个', safety: 50, cost: 30 },
    ];

    for (const sku of skus) {
      await client.query(
        `INSERT INTO booth_skus (id, org_id, sku_code, name, unit, safety_stock, cost_price)
         VALUES (DEFAULT, 1, $1, $2, $3, $4, $5)`,
        [sku.code, sku.name, sku.unit, sku.safety, sku.cost]
      );
    }

    // Fix sequence for skus
    await client.query(`SELECT setval('booth_skus_id_seq', 5, true)`);

    // Seed BOMs
    await client.query(
      `INSERT INTO booth_boms (id, org_id, product_name, product_code, sale_price)
       VALUES (1, 1, '牛肉汉堡', 'BEEF-BURGER', 3800)`
    );
    await client.query(
      `INSERT INTO booth_boms (id, org_id, product_name, product_code, sale_price)
       VALUES (2, 1, '牛肉沙拉', 'BEEF-SALAD', 3200)`
    );
    await client.query(`SELECT setval('booth_boms_id_seq', 2, true)`);

    // Seed BOM items for 汉堡 (bom_id=1): 面粉150g, 牛肉100g, 生菜30g, 番茄50g, 包装盒1个
    const burgerItems = [
      { skuId: 1, qty: 150, unit: 'g' },   // 面粉
      { skuId: 2, qty: 100, unit: 'g' },   // 牛肉
      { skuId: 3, qty: 30, unit: 'g' },    // 生菜
      { skuId: 4, qty: 50, unit: 'g' },    // 番茄
      { skuId: 5, qty: 1, unit: '个' },    // 包装盒
    ];
    for (const item of burgerItems) {
      await client.query(
        `INSERT INTO booth_bom_items (bom_id, sku_id, qty, unit) VALUES (1, $1, $2, $3)`,
        [item.skuId, item.qty, item.unit]
      );
    }

    // Seed BOM items for 沙拉 (bom_id=2): 牛肉150g, 生菜80g, 番茄60g, 包装盒1个
    const saladItems = [
      { skuId: 2, qty: 150, unit: 'g' },   // 牛肉
      { skuId: 3, qty: 80, unit: 'g' },    // 生菜
      { skuId: 4, qty: 60, unit: 'g' },    // 番茄
      { skuId: 5, qty: 1, unit: '个' },    // 包装盒
    ];
    for (const item of saladItems) {
      await client.query(
        `INSERT INTO booth_bom_items (bom_id, sku_id, qty, unit) VALUES (2, $1, $2, $3)`,
        [item.skuId, item.qty, item.unit]
      );
    }

    // Seed inventory: each SKU 10000
    for (let skuId = 1; skuId <= 5; skuId++) {
      await client.query(
        `INSERT INTO booth_inventory (org_id, sku_id, qty_on_hand) VALUES (1, $1, 10000)`,
        [skuId]
      );
    }

    orgModes.set(1, 'du');

    await client.query('COMMIT');
    console.log('[migrate] All tables created and seed data inserted.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}
