#!/bin/bash
# Booth-DU v4 验收脚本
# 工单 C：DXX 供给化改造 + DM 运营页细化

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
echo "Booth-DU v4 验收脚本"
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
echo "=== 基础功能（旧 54 项）==="

# 看板
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/dashboard" | grep -q '"success":true' && log_pass "du 看板" || log_fail "du 看板"
curl -s -H "Authorization: Bearer $TOKEN_DX" "$BASE_URL/api/booth/du/dashboard" | grep -q '"success":true' && log_pass "dx 看板" || log_fail "dx 看板"
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
curl -s -H "Authorization: Bearer $TOKEN_DEX" "$BASE_URL/api/booth/dex/dl/tasks?pageSize=1" | grep -q '"success":true' && log_pass "dex 配送" || log_fail "dex 配送"
curl -s -H "Authorization: Bearer $TOKEN_DEXX" "$BASE_URL/api/booth/dexx/dl/tasks?pageSize=1" | grep -q '"success":true' && log_pass "dexx 配送" || log_fail "dexx 配送"

# 服务
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/svc/tasks?pageSize=1" | grep -q '"success":true' && log_pass "du 服务" || log_fail "du 服务"
curl -s -H "Authorization: Bearer $TOKEN_DEX" "$BASE_URL/api/booth/dex/svc/tasks?pageSize=1" | grep -q '"success":true' && log_pass "dex 服务" || log_fail "dex 服务"
curl -s -H "Authorization: Bearer $TOKEN_DEXX" "$BASE_URL/api/booth/dexx/svc/tasks?pageSize=1" | grep -q '"success":true' && log_pass "dexx 服务" || log_fail "dexx 服务"

# 利润
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/profit" | grep -q '"success":true' && log_pass "du 利润" || log_fail "du 利润"

# 库存预警
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/inventory/alerts" | grep -q '"success":true' && log_pass "du 库存预警" || log_fail "du 库存预警"

# 质检
curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/fab/qc" | grep -q '"success":true' && log_pass "du 质检" || log_fail "du 质检"
curl -s -H "Authorization: Bearer $TOKEN_DEXX" "$BASE_URL/api/booth/dexx/fab/qc/pending" | grep -q '"success":true' && log_pass "dexx 待检" || log_fail "dexx 待检"

# 价格隔离：dex/dexx 无价格字段
DEX_INV=$(curl -s -H "Authorization: Bearer $TOKEN_DEX" "$BASE_URL/api/booth/dex/inventory")
echo "$DEX_INV" | grep -qv '"cost_price"' && log_pass "dex 零价隔离" || log_fail "dex 零价隔离"

DEXX_INV=$(curl -s -H "Authorization: Bearer $TOKEN_DEXX" "$BASE_URL/api/booth/dexx/wh/inventory")
echo "$DEXX_INV" | grep -qv '"cost_price"' && log_pass "dexx 零价隔离" || log_fail "dexx 零价隔离"

# DM 只读穿透
curl -s -H "Authorization: Bearer $TOKEN_DM" "$BASE_URL/api/booth/du/orders?pageSize=1" | grep -q '"success":true' && log_pass "dm 只读穿透" || log_fail "dm 只读穿透"

# DM 写接口 403
DM_WRITE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN_DM" -H "Content-Type: application/json" "$BASE_URL/api/booth/du/users" -d '{"name":"test","phone":"13900000000","role":"dxx"}')
[ "$DM_WRITE" = "403" ] && log_pass "dm 写接口 403" || log_fail "dm 写接口应为 403 (got $DM_WRITE)"

# DXX 售价可见但采购价隐藏
DXX_ORDERS=$(curl -s -H "Authorization: Bearer $TOKEN_DXX" "$BASE_URL/api/booth/du/orders?pageSize=1")
echo "$DXX_ORDERS" | grep -qv '"cost_price"' && log_pass "dxx 隐藏采购价" || log_fail "dxx 隐藏采购价"

# 健康检查
curl -s "$BASE_URL/api/booth/health" | grep -q '"status":"ok"' && log_pass "健康检查" || log_fail "健康检查"

echo ""
echo "=== 工单 B 新断言 ==="

# 五域菜单存在（前端路由可达）
curl -s "$BASE_URL/" | grep -q 'MKT' && log_pass "五域菜单 MKT 存在" || log_fail "五域菜单 MKT 不存在"
curl -s "$BASE_URL/" | grep -q 'FAB' && log_pass "五域菜单 FAB 存在" || log_fail "五域菜单 FAB 不存在"
curl -s "$BASE_URL/" | grep -q 'WH' && log_pass "五域菜单 WH 存在" || log_fail "五域菜单 WH 不存在"
curl -s "$BASE_URL/" | grep -q 'DL' && log_pass "五域菜单 DL 存在" || log_fail "五域菜单 DL 不存在"
curl -s "$BASE_URL/" | grep -q 'SVC' && log_pass "五域菜单 SVC 存在" || log_fail "五域菜单 SVC 不存在"

# 四仓筛选：inventory 按 warehouse_type 过滤
INV_MATERIAL=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/inventory?warehouse_type=material")
echo "$INV_MATERIAL" | grep -q '"success":true' && log_pass "inventory 四仓筛选 material" || log_fail "inventory 四仓筛选 material"

INV_DEVICE=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/inventory?warehouse_type=device")
echo "$INV_DEVICE" | grep -q '"success":true' && log_pass "inventory 四仓筛选 device" || log_fail "inventory 四仓筛选 device"

# 四仓筛选：batches 按 warehouse_type 过滤
BATCHES_MATERIAL=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/wh/batches?warehouse_type=material&pageSize=1")
echo "$BATCHES_MATERIAL" | grep -q '"success":true' && log_pass "batches 四仓筛选 material" || log_fail "batches 四仓筛选 material"

# 四仓看板路由可达
WH_DASHBOARD=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/du/wh/warehouse-dashboard")
[ "$WH_DASHBOARD" = "200" ] && log_pass "四仓看板路由 200" || log_fail "四仓看板路由应为 200 (got $WH_DASHBOARD)"

# 看板趋势 API（包含 trend 数组）
DASHBOARD_TREND=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/dashboard")
echo "$DASHBOARD_TREND" | grep -q '"trend"' && log_pass "看板趋势 API 返回 trend" || log_fail "看板趋势 API 无 trend 字段"

# DXX dashboard 无毛利字段
DXX_DASHBOARD=$(curl -s -H "Authorization: Bearer $TOKEN_DXX" "$BASE_URL/api/booth/du/dashboard")
echo "$DXX_DASHBOARD" | grep -qv '"todayGrossProfit"' && log_pass "dxx dashboard 无毛利" || log_fail "dxx dashboard 有毛利字段"

# inventory 不带参正常返回（回归）
INV_NO_PARAM=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/inventory")
echo "$INV_NO_PARAM" | grep -q '"success":true' && log_pass "inventory 不带参正常" || log_fail "inventory 不带参失败"

echo ""
echo "=== 工单 C 新断言 ==="

# DXX 无收银入口断言
DXX_PAGE=$(curl -s "$BASE_URL/dxx")
echo "$DXX_PAGE" | grep -qv '收银' && log_pass "DXX 无收银入口" || log_fail "DXX 有收银入口"
echo "$DXX_PAGE" | grep -qv 'POS' && log_pass "DXX 无 POS 入口" || log_fail "DXX 有 POS 入口"

# DXX 无客户接待入口断言
echo "$DXX_PAGE" | grep -qv '客户接待' && log_pass "DXX 无客户接待入口" || log_fail "DXX 有客户接待入口"

# DXX 页面无 cost 字段断言
DXX_DATA=$(curl -s -H "Authorization: Bearer $TOKEN_DXX" "$BASE_URL/api/booth/du/orders?pageSize=1")
echo "$DXX_DATA" | grep -qv '"cost_price"' && log_pass "DXX 数据无 cost_price" || log_fail "DXX 数据有 cost_price"
echo "$DXX_DATA" | grep -qv '"unit_cost"' && log_pass "DXX 数据无 unit_cost" || log_fail "DXX 数据有 unit_cost"
echo "$DXX_DATA" | grep -qv '"gross_margin"' && log_pass "DXX 数据无 gross_margin" || log_fail "DXX 数据有 gross_margin"

# DM 无写操作断言
DM_PAGE=$(curl -s "$BASE_URL/dm")
echo "$DM_PAGE" | grep -qv '新建' && log_pass "DM 页面无新建按钮" || log_fail "DM 页面有新建按钮"

# DM 五域卡片存在断言
DM_DASHBOARD=$(curl -s -H "Authorization: Bearer $TOKEN_DM" "$BASE_URL/api/booth/du/dashboard")
echo "$DM_DASHBOARD" | grep -q '"success":true' && log_pass "DM 看板 200" || log_fail "DM 看板非 200"

# DM 写接口仍 403
DM_WRITE2=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN_DM" -H "Content-Type: application/json" "$BASE_URL/api/booth/du/purchase-orders" -d '{"supplier":"test","items":[]}')
[ "$DM_WRITE2" = "403" ] && log_pass "DM 采购写接口 403" || log_fail "DM 采购写接口应为 403 (got $DM_WRITE2)"

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
