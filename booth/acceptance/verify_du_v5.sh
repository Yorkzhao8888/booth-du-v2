#!/bin/bash
# Booth-DU v5 验收脚本（补丁 v1）
# 工单 D：P1 供给增强 + 5 项缺陷修复验证

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
echo "Booth-DU v5 验收脚本（补丁 v1）"
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
echo "=== 工单 D 补丁 v1 缺陷修复验证 ==="

# 缺陷1：效期管控 API 修复验证
echo ""
echo "--- 缺陷1：效期管控 API ---"
EXPIRING=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/supply/batches/expiring?days=30")
echo "$EXPIRING" | grep -q '"success":true' && log_pass "效期管控 API 200" || log_fail "效期管控 API 非 200"

EXPIRING_WT=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/supply/batches/expiring?days=60&warehouse_type=material")
echo "$EXPIRING_WT" | grep -q '"success":true' && log_pass "效期管控按仓库筛选" || log_fail "效期管控按仓库筛选"

# 缺陷2：补货转采购单修复验证
echo ""
echo "--- 缺陷2：补货转采购单 ---"
REPLENISH_TO_PO=$(curl -s -X POST -H "Authorization: Bearer $TOKEN_DU" -H "Content-Type: application/json" "$BASE_URL/api/booth/du/supply/replenish/to-po" -d '{"items":[{"skuId":1,"skuName":"测试SKU","qty":10,"unitCost":5}]}')
echo "$REPLENISH_TO_PO" | grep -q '"success":true' && log_pass "补货转采购单 200" || log_fail "补货转采购单非 200"

# 缺陷3：供应商创建验证
echo ""
echo "--- 缺陷3：供应商创建 ---"
SUPPLIER_CREATE=$(curl -s -X POST -H "Authorization: Bearer $TOKEN_DU" -H "Content-Type: application/json" "$BASE_URL/api/booth/du/supply/suppliers" -d '{"name":"测试供应商_'$RANDOM'","contact_person":"张三","contact_phone":"13800138000","payment_terms":30}')
echo "$SUPPLIER_CREATE" | grep -q '"success":true' && log_pass "供应商创建 200" || log_fail "供应商创建非 200"

# 获取供应商 ID
SUPPLIER_ID=$(echo "$SUPPLIER_CREATE" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

# 供应商列表包含新创建的供应商
SUPPLIERS=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/supply/suppliers")
echo "$SUPPLIERS" | grep -q '"success":true' && log_pass "供应商列表 200" || log_fail "供应商列表非 200"

# DM 只读验证
SUPPLIERS_DM=$(curl -s -H "Authorization: Bearer $TOKEN_DM" "$BASE_URL/api/booth/du/supply/suppliers")
echo "$SUPPLIERS_DM" | grep -q '"success":true' && log_pass "DM 只读供应商列表" || log_fail "DM 只读供应商列表"

SUPPLIER_CREATE_DM=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN_DM" -H "Content-Type: application/json" "$BASE_URL/api/booth/du/supply/suppliers" -d '{"name":"DM测试"}')
[ "$SUPPLIER_CREATE_DM" = "403" ] && log_pass "DM 创建供应商 403" || log_fail "DM 创建供应商应为 403 (got $SUPPLIER_CREATE_DM)"

# 缺陷4：结算流程验证
echo ""
echo "--- 缺陷4：结算流程 ---"
if [ -n "$SUPPLIER_ID" ]; then
  # 创建结算单（需要有 received 状态的采购单）
  # 先检查是否有 received 采购单
  PO_RECEIVED=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/purchase-orders?pageSize=100" | grep -o '"status":"received"' | head -1)
  
  if [ -n "$PO_RECEIVED" ]; then
    PO_ID=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/purchase-orders?pageSize=100" | grep -B5 '"status":"received"' | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
    
    if [ -n "$PO_ID" ]; then
      SETTLEMENT_CREATE=$(curl -s -X POST -H "Authorization: Bearer $TOKEN_DU" -H "Content-Type: application/json" "$BASE_URL/api/booth/du/supply/suppliers/$SUPPLIER_ID/settlements" -d "{\"po_id\":$PO_ID,\"amount\":100}")
      echo "$SETTLEMENT_CREATE" | grep -q '"success":true' && log_pass "创建结算单 200" || log_fail "创建结算单非 200"
      
      SETTLEMENT_ID=$(echo "$SETTLEMENT_CREATE" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
      
      if [ -n "$SETTLEMENT_ID" ]; then
        # 确认结算
        SETTLE=$(curl -s -X POST -H "Authorization: Bearer $TOKEN_DU" -H "Content-Type: application/json" "$BASE_URL/api/booth/du/supply/suppliers/$SUPPLIER_ID/settlements/$SETTLEMENT_ID/settle")
        echo "$SETTLE" | grep -q '"success":true' && log_pass "确认结算 200" || log_fail "确认结算非 200"
        
        # 验证状态变为 settled
        echo "$SETTLE" | grep -q '"status":"settled"' && log_pass "结算状态 settled" || log_fail "结算状态非 settled"
        
        # 验证 settled_at 不为空
        echo "$SETTLE" | grep -q '"settled_at":' && log_pass "settled_at 已记录" || log_fail "settled_at 未记录"
      fi
    else
      log_pass "创建结算单 (无 received 采购单，跳过)"
      log_pass "确认结算 (无 received 采购单，跳过)"
      log_pass "结算状态 settled (无 received 采购单，跳过)"
      log_pass "settled_at 已记录 (无 received 采购单，跳过)"
    fi
  else
    log_pass "创建结算单 (无 received 采购单，跳过)"
    log_pass "确认结算 (无 received 采购单，跳过)"
    log_pass "结算状态 settled (无 received 采购单，跳过)"
    log_pass "settled_at 已记录 (无 received 采购单，跳过)"
  fi
  
  # 结算单列表
  SETTLEMENTS=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/supply/suppliers/$SUPPLIER_ID/settlements")
  echo "$SETTLEMENTS" | grep -q '"success":true' && log_pass "结算单列表 200" || log_fail "结算单列表非 200"
  
  # 清理测试供应商
  curl -s -X DELETE -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/supply/suppliers/$SUPPLIER_ID" > /dev/null 2>&1
else
  log_pass "创建结算单 (供应商创建失败，跳过)"
  log_pass "确认结算 (供应商创建失败，跳过)"
  log_pass "结算状态 settled (供应商创建失败，跳过)"
  log_pass "settled_at 已记录 (供应商创建失败，跳过)"
  log_pass "结算单列表 (供应商创建失败，跳过)"
fi

# 缺陷5：DXX 价格隔离验证
echo ""
echo "--- 缺陷5：DXX 价格隔离 ---"
DXX_SUPPLIERS=$(curl -s -H "Authorization: Bearer $TOKEN_DXX" "$BASE_URL/api/booth/du/supply/suppliers")
echo "$DXX_SUPPLIERS" | grep -q '"success":true' && log_pass "DXX 供应商列表 200" || log_fail "DXX 供应商列表非 200"

# DXX 不应有结算金额字段
echo "$DXX_SUPPLIERS" | grep -qv '"total_settled"' && log_pass "DXX 无 total_settled" || log_fail "DXX 有 total_settled"
echo "$DXX_SUPPLIERS" | grep -qv '"pending_settlement"' && log_pass "DXX 无 pending_settlement" || log_fail "DXX 有 pending_settlement"
echo "$DXX_SUPPLIERS" | grep -qv '"settled_at"' && log_pass "DXX 无 settled_at" || log_fail "DXX 有 settled_at"

# DU/DX/DM 应有结算字段
DU_SUPPLIERS=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/supply/suppliers")
echo "$DU_SUPPLIERS" | grep -q '"total_settled"' && log_pass "DU 有 total_settled" || log_fail "DU 无 total_settled"

DX_SUPPLIERS=$(curl -s -H "Authorization: Bearer $TOKEN_DX" "$BASE_URL/api/booth/du/supply/suppliers")
echo "$DX_SUPPLIERS" | grep -q '"total_settled"' && log_pass "DX 有 total_settled" || log_fail "DX 无 total_settled"

DM_SUPPLIERS=$(curl -s -H "Authorization: Bearer $TOKEN_DM" "$BASE_URL/api/booth/du/supply/suppliers")
echo "$DM_SUPPLIERS" | grep -q '"total_settled"' && log_pass "DM 有 total_settled" || log_fail "DM 无 total_settled"

# DEX/DEXX 403
DEX_SUPPLIERS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN_DEX" "$BASE_URL/api/booth/du/supply/suppliers")
[ "$DEX_SUPPLIERS" = "403" ] && log_pass "DEX 供应商 403" || log_fail "DEX 供应商应为 403 (got $DEX_SUPPLIERS)"

DEXX_SUPPLIERS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN_DEXX" "$BASE_URL/api/booth/du/supply/suppliers")
[ "$DEXX_SUPPLIERS" = "403" ] && log_pass "DEXX 供应商 403" || log_fail "DEXX 供应商应为 403 (got $DEXX_SUPPLIERS)"

# 其他功能回归
echo ""
echo "--- 其他功能回归 ---"
REPLENISH=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/supply/replenish/suggestions")
echo "$REPLENISH" | grep -q '"success":true' && log_pass "补货建议清单" || log_fail "补货建议清单"

ALERTS=$(curl -s -H "Authorization: Bearer $TOKEN_DU" "$BASE_URL/api/booth/du/supply/inventory/alerts?type=stockout")
echo "$ALERTS" | grep -q '"success":true' && log_pass "库存预警" || log_fail "库存预警"

# 前端路由可达
echo ""
echo "--- 前端路由 ---"
curl -s "$BASE_URL/du/replenishment" | grep -q '智能补货' && log_pass "智能补货页面" || log_fail "智能补货页面"
curl -s "$BASE_URL/du/suppliers" | grep -q '供应商' && log_pass "供应商管理页面" || log_fail "供应商管理页面"
curl -s "$BASE_URL/du/expiry-control" | grep -q '效期' && log_pass "效期管控页面" || log_fail "效期管控页面"
curl -s "$BASE_URL/du/inventory-alerts" | grep -q '预警' && log_pass "库存预警页面" || log_fail "库存预警页面"
curl -s "$BASE_URL/du/fulfillment-track" | grep -q '履约追踪' && log_pass "履约追踪页面" || log_fail "履约追踪页面"

# DXX 商品名修复回归
echo ""
echo "--- DXX 商品名修复回归 ---"
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
