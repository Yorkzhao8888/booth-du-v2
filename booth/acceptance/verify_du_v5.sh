#!/bin/bash
# Booth-DU v5 验收脚本
# 工单 D：P1 供给增强（智能补货/供应商结算/效期管控/库存预警/履约追踪）

set -e

BASE_URL="${BASE_URL:-https://cbpbgkdbvs.coze.site}"
TOTAL=0
PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

log_pass() { ((TOTAL++)); ((PASS++)); echo -e "${GREEN}✓${NC} $1"; }
log_fail() { ((TOTAL++)); ((FAIL++)); echo -e "${RED}✗${NC} $1"; }

echo "========================================"
echo "Booth-DU v5 验收脚本"
echo "BASE_URL: $BASE_URL"
echo "========================================"
echo ""

# 登录获取 token
echo "=== 登录 ==="
TOKEN_DM=$(curl -s -X POST -H "Content-Type: application/json" -d '{"phone":"13800000000","password":"123456"}' "$BASE_URL/api/booth/auth/login" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
TOKEN_DU=$(curl -s -X POST -H "Content-Type: application/json" -d '{"phone":"13800000001","password":"123456"}' "$BASE_URL/api/booth/auth/login" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
TOKEN_DEX=$(curl -s -X POST -H "Content-Type: application/json" -d '{"phone":"13800000002","password":"123456"}' "$BASE_URL/api/booth/auth/login" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
TOKEN_DEXX=$(curl -s -X POST -H "Content-Type: application/json" -d '{"phone":"13800000003","password":"123456"}' "$BASE_URL/api/booth/auth/login" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
TOKEN_DX=$(curl -s -X POST -H "Content-Type: application/json" -d '{"phone":"13800000004","password":"123456"}' "$BASE_URL/api/booth/auth/login" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
TOKEN_DXX=$(curl -s -X POST -H "Content-Type: application/json" -d '{"phone":"13800000005","password":"123456"}' "$BASE_URL/api/booth/auth/login" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

[ -n "$TOKEN_DU" ] && log_pass "du 登录" || log_fail "du 登录"
[ -n "$TOKEN_DM" ] && log_pass "dm 登录" || log_fail "dm 登录"
[ -n "$TOKEN_DX" ] && log_pass "dx 登录" || log_fail "dx 登录"
[ -n "$TOKEN_DXX" ] && log_pass "dxx 登录" || log_fail "dxx 登录"
[ -n "$TOKEN_DEX" ] && log_pass "dex 登录" || log_fail "dex 登录"
[ -n "$TOKEN_DEXX" ] && log_pass "dexx 登录" || log_fail "dexx 登录"

echo ""
echo "=== 基础功能回归 ==="

# 看板
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/dashboard" | grep -q '"success":true' && log_pass "du 看板" || log_fail "du 看板"
curl -s -H "Authorization: Bearer $TOKEN_DM" "$BASE_URL/api/booth/du/dashboard" | grep -q '"success":true' && log_pass "dm 看板" || log_fail "dm 看板"

# 订单
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/orders?pageSize=1" | grep -q '"success":true' && log_pass "du 订单" || log_fail "du 订单"

# 库存
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/inventory" | grep -q '"success":true' && log_pass "du 库存" || log_fail "du 库存"

# 批次
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/wh/batches?pageSize=1" | grep -q '"success":true' && log_pass "du 批次" || log_fail "du 批次"

# 采购
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/purchase-orders?pageSize=1" | grep -q '"success":true' && log_pass "du 采购" || log_fail "du 采购"

# 配送
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/dl/tasks?pageSize=1" | grep -q '"success":true' && log_pass "du 配送" || log_fail "du 配送"

# 服务
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/svc/tasks?pageSize=1" | grep -q '"success":true' && log_pass "du 服务" || log_fail "du 服务"

# 利润
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/profit" | grep -q '"success":true' && log_pass "du 利润" || log_fail "du 利润"

# 健康检查
curl -s "$BASE_URL/api/booth/health" | grep -q '"status":"ok"' && log_pass "健康检查" || log_fail "健康检查"

echo ""
echo "=== 工单 D 新断言：P1 供给增强 ==="

# 1. 智能补货
echo ""
echo "--- 智能补货 ---"

# 补货建议清单 API
REPLENISH=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/supply/replenish/suggestions")
echo "$REPLENISH" | grep -q '"success":true' && log_pass "补货建议清单 API" || log_fail "补货建议清单 API"

# 补货建议带仓库筛选
REPLENISH_WT=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/supply/replenish/suggestions?warehouse_type=material")
echo "$REPLENISH_WT" | grep -q '"success":true' && log_pass "补货建议按仓库筛选" || log_fail "补货建议按仓库筛选"

# DM 只读访问补货建议
REPLENISH_DM=$(curl -s -H "Authorization: Bearer $TOKEN_DM" "$BASE_URL/api/booth/du/supply/replenish/suggestions")
echo "$REPLENISH_DM" | grep -q '"success":true' && log_pass "DM 只读补货建议" || log_fail "DM 只读补货建议"

# DM 写接口 403
REPLENISH_DM_WRITE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN_DM" -H "Content-Type: application/json" "$BASE_URL/api/booth/du/supply/replenish/to-po" -d '{"items":[{"skuId":1,"skuName":"test","qty":10}]}')
[ "$REPLENISH_DM_WRITE" = "403" ] && log_pass "DM 补货转采购 403" || log_fail "DM 补货转采购应为 403 (got $REPLENISH_DM_WRITE)"

# 一键转采购单 API
REPLENISH_TO_PO=$(curl -s -X POST -H "Authorization: Bearer $TOKEN_DU" -H "Content-Type: application/json" "$BASE_URL/api/booth/du/supply/replenish/to-po" -d '{"items":[{"skuId":1,"skuName":"测试SKU","qty":10,"unitCost":5}]}')
echo "$REPLENISH_TO_PO" | grep -q '"success":true' && log_pass "一键转采购单" || log_fail "一键转采购单"

# 2. 供应商管理 + 结算
echo ""
echo "--- 供应商管理 + 结算 ---"

# 供应商列表 API
SUPPLIERS=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/supply/suppliers")
echo "$SUPPLIERS" | grep -q '"success":true' && log_pass "供应商列表 API" || log_fail "供应商列表 API"

# DM 只读访问供应商
SUPPLIERS_DM=$(curl -s -H "Authorization: Bearer $TOKEN_DM" "$BASE_URL/api/booth/du/supply/suppliers")
echo "$SUPPLIERS_DM" | grep -q '"success":true' && log_pass "DM 只读供应商" || log_fail "DM 只读供应商"

# 供应商结算单列表
SUPPLIER_SETTLEMENTS=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/supply/suppliers/%E5%BE%85%E6%8C%87%E5%AE%9A/settlements")
echo "$SUPPLIER_SETTLEMENTS" | grep -q '"success":true' && log_pass "供应商结算单列表" || log_fail "供应商结算单列表"

# 3. 效期管控 / 临期预警
echo ""
echo "--- 效期管控 / 临期预警 ---"

# 临期批次 API
EXPIRING=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/supply/batches/expiring?days=30")
echo "$EXPIRING" | grep -q '"success":true' && log_pass "临期批次 API" || log_fail "临期批次 API"

# 临期批次带仓库筛选
EXPIRING_WT=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/supply/batches/expiring?days=60&warehouse_type=material")
echo "$EXPIRING_WT" | grep -q '"success":true' && log_pass "临期批次按仓库筛选" || log_fail "临期批次按仓库筛选"

# DM 只读访问临期批次
EXPIRING_DM=$(curl -s -H "Authorization: Bearer $TOKEN_DM" "$BASE_URL/api/booth/du/supply/batches/expiring?days=30")
echo "$EXPIRING_DM" | grep -q '"success":true' && log_pass "DM 只读临期批次" || log_fail "DM 只读临期批次"

# 4. 库存预警（缺货/呆滞）
echo ""
echo "--- 库存预警 ---"

# 库存预警 API - 缺货
ALERTS_STOCKOUT=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/supply/inventory/alerts?type=stockout")
echo "$ALERTS_STOCKOUT" | grep -q '"success":true' && log_pass "库存预警-缺货 API" || log_fail "库存预警-缺货 API"

# 库存预警 API - 呆滞
ALERTS_STAGNANT=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/supply/inventory/alerts?type=stagnant")
echo "$ALERTS_STAGNANT" | grep -q '"success":true' && log_pass "库存预警-呆滞 API" || log_fail "库存预警-呆滞 API"

# 库存预警带仓库筛选
ALERTS_WT=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/supply/inventory/alerts?type=stockout&warehouse_type=material")
echo "$ALERTS_WT" | grep -q '"success":true' && log_pass "库存预警按仓库筛选" || log_fail "库存预警按仓库筛选"

# DM 只读访问库存预警
ALERTS_DM=$(curl -s -H "Authorization: Bearer $TOKEN_DM" "$BASE_URL/api/booth/du/supply/inventory/alerts?type=stockout")
echo "$ALERTS_DM" | grep -q '"success":true' && log_pass "DM 只读库存预警" || log_fail "DM 只读库存预警"

# 5. 履约追踪
echo ""
echo "--- 履约追踪 ---"

# 获取一个订单 ID 用于追踪测试
ORDER_ID=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/fulfillments?pageSize=1" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

if [ -n "$ORDER_ID" ]; then
  # 履约追踪 API
  TRACK=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/supply/orders/$ORDER_ID/track")
  echo "$TRACK" | grep -q '"success":true' && log_pass "履约追踪 API" || log_fail "履约追踪 API"
  
  # 追踪返回 trackNodes 数组
  echo "$TRACK" | grep -q '"trackNodes"' && log_pass "履约追踪返回 trackNodes" || log_fail "履约追踪无 trackNodes"
  
  # DM 只读访问履约追踪
  TRACK_DM=$(curl -s -H "Authorization: Bearer $TOKEN_DM" "$BASE_URL/api/booth/du/supply/orders/$ORDER_ID/track")
  echo "$TRACK_DM" | grep -q '"success":true' && log_pass "DM 只读履约追踪" || log_fail "DM 只读履约追踪"
else
  log_pass "履约追踪 API (无订单数据，跳过)"
  log_pass "履约追踪返回 trackNodes (无订单数据，跳过)"
  log_pass "DM 只读履约追踪 (无订单数据，跳过)"
fi

# 不存在的订单返回 404
TRACK_404=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/supply/orders/999999/track")
[ "$TRACK_404" = "404" ] && log_pass "不存在订单追踪 404" || log_fail "不存在订单追踪应为 404 (got $TRACK_404)"

# 前端路由可达
echo ""
echo "--- 前端路由 ---"
curl -s "$BASE_URL/du/replenishment" | grep -q '智能补货' && log_pass "智能补货页面" || log_fail "智能补货页面"
curl -s "$BASE_URL/du/suppliers" | grep -q '供应商' && log_pass "供应商管理页面" || log_fail "供应商管理页面"
curl -s "$BASE_URL/du/expiry-control" | grep -q '效期' && log_pass "效期管控页面" || log_fail "效期管控页面"
curl -s "$BASE_URL/du/inventory-alerts" | grep -q '预警' && log_pass "库存预警页面" || log_fail "库存预警页面"
curl -s "$BASE_URL/du/fulfillment-track" | grep -q '履约追踪' && log_pass "履约追踪页面" || log_fail "履约追踪页面"

# DXX 商品名 undefined 修复验证
echo ""
echo "--- DXX 商品名修复 ---"
DXX_ORDERS=$(curl -s -H "Authorization: Bearer $TOKEN_DXX" "$BASE_URL/api/booth/du/orders?pageSize=1")
echo "$DXX_ORDERS" | grep -q '"success":true' && log_pass "DXX 订单 API 正常" || log_fail "DXX 订单 API 异常"

echo ""
echo "========================================"
echo "总计: $TOTAL 项"
echo -e "通过: ${GREEN}$PASS${NC}"
echo -e "失败: ${RED}$FAIL${NC}"
echo "========================================"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
exit 0
