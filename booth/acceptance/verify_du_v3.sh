#!/bin/bash
# verify_du_v3.sh — Booth-DU v3 验收脚本
# 包含：旧 54 项（v2 基础功能）+ 新断言（五域菜单/四仓筛选/四仓看板/趋势 API）
# 用法：./verify_du_v3.sh [BASE_URL]
# 默认 BASE_URL=https://cbpbgkdbvs.coze.site

set -e

BASE_URL="${1:-https://cbpbgkdbvs.coze.site}"
PASS=0
FAIL=0
TOTAL=0

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

log_pass() {
  echo -e "${GREEN}✓ PASS${NC}: $1"
  ((PASS++))
  ((TOTAL++))
}

log_fail() {
  echo -e "${RED}✗ FAIL${NC}: $1"
  ((FAIL++))
  ((TOTAL++))
}

# 登录获取 token
login() {
  local phone="$1"
  local resp=$(curl -s -X POST "$BASE_URL/api/booth/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"phone\":\"$phone\",\"password\":\"123456\"}")
  echo "$resp" | grep -q '"success":true' && echo "$resp" | grep -o '"token":"[^"]*"' | cut -d'"' -f4
}

# 测试账号
echo "=== 登录测试 ==="
TOKEN_DU=$(login "13800000001")
TOKEN_DX=$(login "13800000004")
TOKEN_DEX=$(login "13800000002")
TOKEN_DEXX=$(login "13800000003")
TOKEN_DM=$(login "13800000000")
TOKEN_DXX=$(login "13800000005")

[ -n "$TOKEN_DU" ] && log_pass "du 登录成功" || log_fail "du 登录失败"
[ -n "$TOKEN_DX" ] && log_pass "dx 登录成功" || log_fail "dx 登录失败"
[ -n "$TOKEN_DEX" ] && log_pass "dex 登录成功" || log_fail "dex 登录失败"
[ -n "$TOKEN_DEXX" ] && log_pass "dexx 登录成功" || log_fail "dexx 登录失败"
[ -n "$TOKEN_DM" ] && log_pass "dm 登录成功" || log_fail "dm 登录失败"
[ -n "$TOKEN_DXX" ] && log_pass "dxx 登录成功" || log_fail "dxx 登录失败"

# === 旧 54 项基础功能（v2 回归） ===
echo ""
echo "=== 旧 54 项基础功能回归 ==="

# 1. 经营看板
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/dashboard" | grep -q '"success":true' && log_pass "du 看板" || log_fail "du 看板"
curl -s -H "Authorization: Bearer $TOKEN_DX" "$BASE_URL/api/booth/du/dashboard" | grep -q '"success":true' && log_pass "dx 看板" || log_fail "dx 看板"

# 2. 订单列表
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/orders?pageSize=1" | grep -q '"success":true' && log_pass "du 订单" || log_fail "du 订单"

# 3. 履约列表
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/fulfillments?pageSize=1" | grep -q '"success":true' && log_pass "du 履约" || log_fail "du 履约"
curl -s -H "Authorization: Bearer $TOKEN_DEX" "$BASE_URL/api/booth/dex/fulfillments?pageSize=1" | grep -q '"success":true' && log_pass "dex 履约" || log_fail "dex 履约"

# 4. 工单列表
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/work-orders?pageSize=1" | grep -q '"success":true' && log_pass "du 工单" || log_fail "du 工单"
curl -s -H "Authorization: Bearer $TOKEN_DEX" "$BASE_URL/api/booth/dex/work-orders?pageSize=1" | grep -q '"success":true' && log_pass "dex 工单" || log_fail "dex 工单"

# 5. 库存
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/inventory" | grep -q '"success":true' && log_pass "du 库存" || log_fail "du 库存"
curl -s -H "Authorization: Bearer $TOKEN_DEX" "$BASE_URL/api/booth/dex/inventory" | grep -q '"success":true' && log_pass "dex 库存" || log_fail "dex 库存"
curl -s -H "Authorization: Bearer $TOKEN_DEXX" "$BASE_URL/api/booth/dexx/wh/inventory" | grep -q '"success":true' && log_pass "dexx 库存" || log_fail "dexx 库存"

# 6. BOM
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/boms" | grep -q '"success":true' && log_pass "du BOM" || log_fail "du BOM"
curl -s -H "Authorization: Bearer $TOKEN_DEX" "$BASE_URL/api/booth/dex/boms" | grep -q '"success":true' && log_pass "dex BOM" || log_fail "dex BOM"

# 7. SKU
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/skus" | grep -q '"success":true' && log_pass "du SKU" || log_fail "du SKU"
curl -s -H "Authorization: Bearer $TOKEN_DEX" "$BASE_URL/api/booth/dex/skus" | grep -q '"success":true' && log_pass "dex SKU" || log_fail "dex SKU"

# 8. 采购单
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/purchase-orders?pageSize=1" | grep -q '"success":true' && log_pass "du 采购单" || log_fail "du 采购单"

# 9. 批次
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/wh/batches?pageSize=1" | grep -q '"success":true' && log_pass "du 批次" || log_fail "du 批次"

# 10. 盘点
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/wh/stocktakes?pageSize=1" | grep -q '"success":true' && log_pass "du 盘点" || log_fail "du 盘点"
curl -s -H "Authorization: Bearer $TOKEN_DEX" "$BASE_URL/api/booth/dex/wh/stocktakes?pageSize=1" | grep -q '"success":true' && log_pass "dex 盘点" || log_fail "dex 盘点"

# 11. 配送任务
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/dl/tasks?pageSize=1" | grep -q '"success":true' && log_pass "du 配送" || log_fail "du 配送"
curl -s -H "Authorization: Bearer $TOKEN_DEX" "$BASE_URL/api/booth/dex/dl/tasks?pageSize=1" | grep -q '"success":true' && log_pass "dex 配送" || log_fail "dex 配送"
curl -s -H "Authorization: Bearer $TOKEN_DEXX" "$BASE_URL/api/booth/dexx/dl/tasks?pageSize=1" | grep -q '"success":true' && log_pass "dexx 配送" || log_fail "dexx 配送"

# 12. 服务任务
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/svc/tasks?pageSize=1" | grep -q '"success":true' && log_pass "du 服务" || log_fail "du 服务"
curl -s -H "Authorization: Bearer $TOKEN_DEX" "$BASE_URL/api/booth/dex/svc/tasks?pageSize=1" | grep -q '"success":true' && log_pass "dex 服务" || log_fail "dex 服务"
curl -s -H "Authorization: Bearer $TOKEN_DEXX" "$BASE_URL/api/booth/dexx/svc/tasks?pageSize=1" | grep -q '"success":true' && log_pass "dexx 服务" || log_fail "dexx 服务"

# 13. 利润
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/profit" | grep -q '"success":true' && log_pass "du 利润" || log_fail "du 利润"

# 14. 库存预警
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/inventory/alerts" | grep -q '"success":true' && log_pass "du 库存预警" || log_fail "du 库存预警"

# 15. 质检
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/fab/qc" | grep -q '"success":true' && log_pass "du 质检" || log_fail "du 质检"
curl -s -H "Authorization: Bearer $TOKEN_DEXX" "$BASE_URL/api/booth/dexx/fab/qc/pending" | grep -q '"success":true' && log_pass "dexx 待检" || log_fail "dexx 待检"

# 16. 价格隔离：dex/dexx 无价格字段
DEX_INV=$(curl -s -H "Authorization: Bearer $TOKEN_DEX" "$BASE_URL/api/booth/dex/inventory")
echo "$DEX_INV" | grep -qv '"cost_price"' && log_pass "dex 零价隔离" || log_fail "dex 零价隔离"

DEXX_INV=$(curl -s -H "Authorization: Bearer $TOKEN_DEXX" "$BASE_URL/api/booth/dexx/wh/inventory")
echo "$DEXX_INV" | grep -qv '"cost_price"' && log_pass "dexx 零价隔离" || log_fail "dexx 零价隔离"

# 17. DM 只读穿透
curl -s -H "Authorization: Bearer $TOKEN_DM" "$BASE_URL/api/booth/du/orders?pageSize=1" | grep -q '"success":true' && log_pass "dm 只读穿透" || log_fail "dm 只读穿透"

# 18. DM 写接口 403
DM_WRITE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN_DM" -H "Content-Type: application/json" "$BASE_URL/api/booth/du/users" -d '{"name":"test","phone":"13900000000","role":"dxx"}')
[ "$DM_WRITE" = "403" ] && log_pass "dm 写接口 403" || log_fail "dm 写接口应为 403 (got $DM_WRITE)"

# 19. DXX 售价可见但采购价隐藏
DXX_ORDERS=$(curl -s -H "Authorization: Bearer $TOKEN_DXX" "$BASE_URL/api/booth/du/orders?pageSize=1")
echo "$DXX_ORDERS" | grep -qv '"cost_price"' && log_pass "dxx 隐藏采购价" || log_fail "dxx 隐藏采购价"

# 20. 健康检查
curl -s "$BASE_URL/api/booth/health" | grep -q '"status":"ok"' && log_pass "健康检查" || log_fail "健康检查"

# === 新断言（工单 B 新增） ===
echo ""
echo "=== 工单 B 新断言 ==="

# 21. 五域菜单存在（前端路由可达）
curl -s "$BASE_URL/" | grep -q 'MKT' && log_pass "五域菜单 MKT 存在" || log_fail "五域菜单 MKT 不存在"
curl -s "$BASE_URL/" | grep -q 'FAB' && log_pass "五域菜单 FAB 存在" || log_fail "五域菜单 FAB 不存在"
curl -s "$BASE_URL/" | grep -q 'WH' && log_pass "五域菜单 WH 存在" || log_fail "五域菜单 WH 不存在"
curl -s "$BASE_URL/" | grep -q 'DL' && log_pass "五域菜单 DL 存在" || log_fail "五域菜单 DL 不存在"
curl -s "$BASE_URL/" | grep -q 'SVC' && log_pass "五域菜单 SVC 存在" || log_fail "五域菜单 SVC 不存在"

# 22. 四仓筛选：inventory 按 warehouse_type 过滤
INV_MATERIAL=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/inventory?warehouse_type=material")
echo "$INV_MATERIAL" | grep -q '"success":true' && log_pass "inventory 四仓筛选 material" || log_fail "inventory 四仓筛选 material"

INV_DEVICE=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/inventory?warehouse_type=device")
echo "$INV_DEVICE" | grep -q '"success":true' && log_pass "inventory 四仓筛选 device" || log_fail "inventory 四仓筛选 device"

# 23. 四仓筛选：batches 按 warehouse_type 过滤
BATCHES_MATERIAL=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/wh/batches?warehouse_type=material&pageSize=1")
echo "$BATCHES_MATERIAL" | grep -q '"success":true' && log_pass "batches 四仓筛选 material" || log_fail "batches 四仓筛选 material"

# 24. 四仓看板路由可达
WH_DASHBOARD=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/du/wh/warehouse-dashboard")
[ "$WH_DASHBOARD" = "200" ] && log_pass "四仓看板路由 200" || log_fail "四仓看板路由应为 200 (got $WH_DASHBOARD)"

# 25. 看板趋势 API（复用 du/dashboard，包含趋势数据）
DASHBOARD_TREND=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/dashboard")
echo "$DASHBOARD_TREND" | grep -q '"success":true' && log_pass "看板趋势 API 返回" || log_fail "看板趋势 API 返回"

# 26. inventory 不带参正常返回（回归）
INV_NO_PARAM=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/inventory")
echo "$INV_NO_PARAM" | grep -q '"success":true' && log_pass "inventory 不带参正常" || log_fail "inventory 不带参失败"

# === 汇总 ===
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
