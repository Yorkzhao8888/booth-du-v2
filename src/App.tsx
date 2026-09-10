import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store';
import SSEListener from './components/SSEListener';
import ErrorBoundary from './components/ErrorBoundary';
import AppLayout from './components/AppLayout';
import MobileLayout from './components/MobileLayout';
import Login from './pages/Login';
// DU pages
import DuDashboard from './pages/du/Dashboard';
import DuOrders from './pages/du/Orders';
import DuWorkOrders from './pages/du/WorkOrders';
import DuInventory from './pages/du/Inventory';
import DuBoms from './pages/du/Boms';
import DuPurchaseOrders from './pages/du/PurchaseOrders';
import DuProfitDashboard from './pages/du/ProfitDashboard';
import DuDlTasks from './pages/du/DlTasks';
import DuSvcTasks from './pages/du/SvcTasks';
import DuBatches from './pages/du/Batches';
import DuReplenishment from './pages/du/Replenishment';
import DuSuppliers from './pages/du/Suppliers';
import DuSupplierManagement from './pages/du/SupplierManagement';
import DuExpiryControl from './pages/du/ExpiryControl';
import DuInventoryAlerts from './pages/du/InventoryAlerts';
import DuFulfillmentTrack from './pages/du/FulfillmentTrack';
import DuSupplyOrders from './pages/du/SupplyOrders';
import DuInventoryTransfer from './pages/du/InventoryTransfer';
import DuRealtimeDashboard from './pages/du/RealtimeDashboard';
import ProductionOrders from './pages/du/ProductionOrders'; // [BOOTH-PRD-001] 生产单契约地基
import SupplyShops from './pages/du/SupplyShops'; // [BOOTH-PRD-002] PM-001 供应铺管理
import OrderTypes from './pages/du/OrderTypes'; // [BOOTH-PRD-002] PM-002 订单类型配置
import RbacRoles from './pages/du/RbacRoles'; // [BOOTH-PRD-002] PM-004 角色权限矩阵
import Crafts from './pages/du/Crafts'; // [BOOTH-PRD-003] RD-005 工艺管理
// EDX pages
import ExDashboard from './pages/ex/Dashboard';
import ExWorkOrders from './pages/ex/WorkOrders';
import ExBoms from './pages/ex/Boms';
import ExSkus from './pages/ex/Skus';
import ExInventory from './pages/ex/Inventory';
import ExDlDispatch from './pages/ex/DlDispatch';
import ExSvcDispatch from './pages/ex/SvcDispatch';
import ExStocktakeApproval from './pages/ex/StocktakeApproval';
import ExCapacityQuery from './pages/ex/CapacityQuery';
// EDXX pages
import ExxModuleEntry from './pages/edxx/ModuleEntry';
import ExxFabQueue from './pages/edxx/FabQueue';
import ExxFabActive from './pages/edxx/FabActive';
import ExxFabHistory from './pages/edxx/FabHistory';
import ExxWhInventory from './pages/edxx/WhInventory';
import ExxWhInbound from './pages/edxx/WhInbound';
import ExxWhOutbound from './pages/edxx/WhOutbound';
import ExxWhTxns from './pages/edxx/WhTxns';
import ExxFabOperations from './pages/edxx/FabOperations';
import ExxFabAndon from './pages/edxx/FabAndon';
import ExxQcExecute from './pages/edxx/QcExecute';
import ExxFabTrace from './pages/edxx/FabTrace';
import ExxFabPlugins from './pages/edxx/FabPlugins';
import ExxFabTelemetry from './pages/edxx/FabTelemetry';
import ExxFabSupplierScore from './pages/edxx/FabSupplierScore';
import ExxFabDefects from './pages/edxx/FabDefects';
import ExxStocktakeExec from './pages/edxx/StocktakeExec';
import ExxDlExec from './pages/edxx/DlExec';
import ExxSvcExec from './pages/edxx/SvcExec';
import ExxProductionDashboard from './pages/edxx/ProductionDashboard';
import ExxYieldTracking from './pages/edxx/YieldTracking';
import ExxFabZoneView from './pages/edxx/FabZoneView';
import ExxFabStations from './pages/edxx/FabStations';
import ExxFabStationDetail from './pages/edxx/FabStationDetail';
import ExxFabEquipment from './pages/edxx/FabEquipment';
import ExxFabEquipmentOee from './pages/edxx/FabEquipmentOee';
import ExxFabOeeDashboard from './pages/edxx/FabOeeDashboard';
import ExxFabMaintenance from './pages/edxx/FabMaintenance';
import ExxSupplyOrders from './pages/edxx/SupplyOrders';
import ExxSupplyLineFeed from './pages/edxx/SupplyLineFeed';
import ExxDeviceSupply from './pages/edxx/DeviceSupply';
import ExxPlazaSupply from './pages/edxx/PlazaSupply';
// DM pages
import DmDashboard from './pages/dm/Dashboard';
// EMXX pages
import DxxDashboard from './pages/emxx/Dashboard';
// EM pages
import EmDashboard from './pages/em/Dashboard';
import EmSupplierAdmissions from './pages/em/SupplierAdmissions';
import EmSupplyStrategies from './pages/em/SupplyStrategies';
import EmCapacityPlanning from './pages/em/CapacityPlanning';
import EmCapacityResources from './pages/em/CapacityResources';
import EmAtpCommitments from './pages/em/AtpCommitments';
import EmSguCatalog from './pages/em/SguCatalog';
import EmSguListings from './pages/em/SguListings';
import EmSguPending from './pages/em/SguPending';
import EmSupplyQuotes from './pages/em/SupplyQuotes';
import DuSupplyQuotes from './pages/du/SupplyQuotes';
import ExSupplyQuotes from './pages/ex/SupplyQuotes';
// Market pages
import MarketDashboard from './pages/market/Dashboard';
// Common pages
import OrgChart from './pages/common/OrgChart';
import EmployeeManagement from './pages/du/EmployeeManagement';
import WarehouseDashboard from './pages/du/WarehouseDashboard';

const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, user, applySession } = useAuthStore();
  const location = useLocation();
  const [devProbe, setDevProbe] = useState<'pending' | 'open' | 'closed'>('pending');

  // [OAS-OPEN-DEV-01] 开发期匿名放行探测: 无会话时问后端认证是否处于开放模式
  useEffect(() => {
    if (token) return;
    let alive = true;
    fetch('/api/booth/auth/oas-status')
      .then((r) => r.json())
      .then((d) => {
        const body = d?.data ?? d;
        if (alive && body?.authOpen && body?.anonymousUser) {
          applySession('dev-open', body.anonymousUser);
          setDevProbe('open');
        } else if (alive) {
          setDevProbe('closed');
        }
      })
      .catch(() => {
        if (alive) setDevProbe('closed');
      });
    return () => {
      alive = false;
    };
  }, [token, applySession]);

  if (!token) {
    if (devProbe === 'pending') return null;
    return <Navigate to="/login" replace />;
  }

  if (user) {
    const role = user.role;
    const path = location.pathname;

    // dm can access all routes (read-only)
    if (role === 'dm') {
      // DM can access any route, no redirect needed
    }
    // em can access /em and /market routes
    else if (role === 'em' && !path.startsWith('/em') && !path.startsWith('/market')) {
      return <Navigate to="/em" replace />;
    }
    // du and dx share the same /du routes, and can access /market
    else if ((role === 'du' || role === 'dx') && !path.startsWith('/du') && !path.startsWith('/market')) {
      return <Navigate to="/du" replace />;
    }
    // emxx shares /emxx routes with edxx
    else if (role === 'emxx' && !path.startsWith('/emxx') && !path.startsWith('/edxx')) {
      return <Navigate to="/emxx" replace />;
    }
    else if (role === 'ex' && !path.startsWith('/ex')) {
      return <Navigate to="/ex" replace />;
    }
    else if (role === 'edx' && !path.startsWith('/edx') && !path.startsWith('/du')) {
      return <Navigate to="/edx" replace />;
    }
    else if (role === 'emx' && !path.startsWith('/emx') && !path.startsWith('/du')) {
      return <Navigate to="/emx" replace />;
    }
    else if (role === 'edxx' && !path.startsWith('/edxx')) {
      return <Navigate to="/edxx" replace />;
    }
  }

  return <>{children}</>;
};

const RoleRedirect: React.FC = () => {
  const { user } = useAuthStore();
  if (!user) return <Navigate to="/login" replace />;
  const home: Record<string, string> = { dm: '/dm', du: '/du', dx: '/du', emxx: '/emxx', ex: '/ex', edxx: '/edxx', em: '/em' };
  return <Navigate to={home[user.role] || '/login'} replace />;
};

// STATION-03/06: 旧 /fab/station/:id 链接兼容跳转 (相对当前路由树前缀, 与 fab/stations -> ../station 同模式)
function OldStationRedirect() {
  const { id } = useParams();
  return <Navigate to={`../station/${id}`} replace />;
}

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <SSEListener />
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* DU routes (du + dx share) */}
        <Route
          path="/du"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<ErrorBoundary><DuDashboard /></ErrorBoundary>} />
          <Route path="orders" element={<ErrorBoundary><DuOrders /></ErrorBoundary>} />
          <Route path="work-orders" element={<ErrorBoundary><DuWorkOrders /></ErrorBoundary>} />
          <Route path="inventory" element={<ErrorBoundary><DuInventory /></ErrorBoundary>} />
          <Route path="boms" element={<ErrorBoundary><DuBoms /></ErrorBoundary>} />
          <Route path="purchase-orders" element={<ErrorBoundary><DuPurchaseOrders /></ErrorBoundary>} />
          <Route path="profit" element={<ErrorBoundary><DuProfitDashboard /></ErrorBoundary>} />
          <Route path="dl" element={<ErrorBoundary><DuDlTasks /></ErrorBoundary>} />
          <Route path="svc" element={<ErrorBoundary><DuSvcTasks /></ErrorBoundary>} />
          <Route path="supply-quotes" element={<ErrorBoundary><DuSupplyQuotes /></ErrorBoundary>} />
          <Route path="batches" element={<ErrorBoundary><DuBatches /></ErrorBoundary>} />
          <Route path="replenishment" element={<ErrorBoundary><DuReplenishment /></ErrorBoundary>} />
          <Route path="suppliers" element={<ErrorBoundary><DuSupplierManagement /></ErrorBoundary>} />
          <Route path="suppliers-legacy" element={<ErrorBoundary><DuSuppliers /></ErrorBoundary>} />
          <Route path="expiry-control" element={<ErrorBoundary><DuExpiryControl /></ErrorBoundary>} />
          <Route path="inventory-alerts" element={<ErrorBoundary><DuInventoryAlerts /></ErrorBoundary>} />
          <Route path="fulfillment-track" element={<ErrorBoundary><DuFulfillmentTrack /></ErrorBoundary>} />
          {/* BOOTH-PK-02: SupplyOrder 显式契约 (M 层 du/dx) */}
          <Route path="supply-orders" element={<ErrorBoundary><DuSupplyOrders /></ErrorBoundary>} />
          {/* [BOOTH-PRD-001] 生产单契约地基 (G-007 三级状态联动 / BDD-19 闭环骨架) */}
          <Route path="production-orders" element={<ErrorBoundary><ProductionOrders /></ErrorBoundary>} />
          {/* [BOOTH-PRD-002] 铺面管理+权限 (阶段一 P0) */}
          <Route path="supply-shops" element={<ErrorBoundary><SupplyShops /></ErrorBoundary>} />
          <Route path="order-types" element={<ErrorBoundary><OrderTypes /></ErrorBoundary>} />
          <Route path="roles" element={<ErrorBoundary><RbacRoles /></ErrorBoundary>} />
          <Route path="crafts" element={<ErrorBoundary><Crafts /></ErrorBoundary>} /> {/* [BOOTH-PRD-003] RD-005 */}
          <Route path="inventory-transfer" element={<ErrorBoundary><DuInventoryTransfer /></ErrorBoundary>} />
          <Route path="realtime-dashboard" element={<ErrorBoundary><DuRealtimeDashboard /></ErrorBoundary>} />
          <Route path="wh/warehouse-dashboard" element={<ErrorBoundary><WarehouseDashboard /></ErrorBoundary>} />
          <Route path="employees" element={<ErrorBoundary><EmployeeManagement /></ErrorBoundary>} />
          <Route path="org-chart" element={<ErrorBoundary><OrgChart /></ErrorBoundary>} />
          {/* FAB 产线只读监控 (FAB-MES-03-FIX3): 复用 edxx 组件, 后端 requireFabRead 放行只读 GET, 写操作仍 FAB */}
          <Route path="fab/zone/:stage" element={<ErrorBoundary><ExxFabZoneView /></ErrorBoundary>} />
          <Route path="station" element={<ErrorBoundary><ExxFabStations /></ErrorBoundary>} />
          <Route path="station/:id" element={<ErrorBoundary><ExxFabStationDetail /></ErrorBoundary>} />
          <Route path="fab/stations" element={<Navigate to="../station" replace />} />
          <Route path="fab/station/:id" element={<OldStationRedirect />} />
          <Route path="fab/telemetry" element={<ErrorBoundary><ExxFabTelemetry /></ErrorBoundary>} />
          <Route path="fab/score" element={<ErrorBoundary><ExxFabSupplierScore /></ErrorBoundary>} />
          <Route path="fab/equipment" element={<ErrorBoundary><ExxFabEquipment /></ErrorBoundary>} />
          <Route path="fab/equipment/oee" element={<ErrorBoundary><ExxFabOeeDashboard /></ErrorBoundary>} />
          <Route path="fab/equipment/:id" element={<ErrorBoundary><ExxFabEquipmentOee /></ErrorBoundary>} />
          <Route path="fab/maintenance" element={<ErrorBoundary><ExxFabMaintenance /></ErrorBoundary>} />
          <Route path="fab/andon" element={<ErrorBoundary><ExxFabAndon /></ErrorBoundary>} />
        </Route>

        {/* DM routes (read-only access to all) */}
        <Route
          path="/dm"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<ErrorBoundary><DmDashboard /></ErrorBoundary>} />
          <Route path="org-chart" element={<ErrorBoundary><OrgChart /></ErrorBoundary>} />
          <Route path="employees" element={<ErrorBoundary><EmployeeManagement /></ErrorBoundary>} />
          {/* DM can access all DU routes in read-only mode */}
          <Route path="orders" element={<ErrorBoundary><DuOrders /></ErrorBoundary>} />
          <Route path="work-orders" element={<ErrorBoundary><DuWorkOrders /></ErrorBoundary>} />
          <Route path="inventory" element={<ErrorBoundary><DuInventory /></ErrorBoundary>} />
          <Route path="boms" element={<ErrorBoundary><DuBoms /></ErrorBoundary>} />
          <Route path="purchase-orders" element={<ErrorBoundary><DuPurchaseOrders /></ErrorBoundary>} />
          <Route path="profit" element={<ErrorBoundary><DuProfitDashboard /></ErrorBoundary>} />
          <Route path="dl" element={<ErrorBoundary><DuDlTasks /></ErrorBoundary>} />
          <Route path="svc" element={<ErrorBoundary><DuSvcTasks /></ErrorBoundary>} />
          <Route path="batches" element={<ErrorBoundary><DuBatches /></ErrorBoundary>} />
          <Route path="replenishment" element={<ErrorBoundary><DuReplenishment /></ErrorBoundary>} />
          <Route path="suppliers" element={<ErrorBoundary><DuSupplierManagement /></ErrorBoundary>} />
          <Route path="expiry-control" element={<ErrorBoundary><DuExpiryControl /></ErrorBoundary>} />
          <Route path="inventory-alerts" element={<ErrorBoundary><DuInventoryAlerts /></ErrorBoundary>} />
          <Route path="fulfillment-track" element={<ErrorBoundary><DuFulfillmentTrack /></ErrorBoundary>} />
        </Route>
        <Route
          path="/emxx"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<ErrorBoundary><DxxDashboard /></ErrorBoundary>} />
          <Route path="org-chart" element={<ErrorBoundary><OrgChart /></ErrorBoundary>} />
          {/* EMXX can access EDXX execution routes */}
          <Route path="dl" element={<ErrorBoundary><ExxDlExec /></ErrorBoundary>} />
          <Route path="svc" element={<ErrorBoundary><ExxSvcExec /></ErrorBoundary>} />
        </Route>

        {/* EX routes */}
        <Route
          path="/ex"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<ErrorBoundary><ExDashboard /></ErrorBoundary>} />
          <Route path="work-orders" element={<ErrorBoundary><ExWorkOrders /></ErrorBoundary>} />
          <Route path="boms" element={<ErrorBoundary><ExBoms /></ErrorBoundary>} />
          <Route path="skus" element={<ErrorBoundary><ExSkus /></ErrorBoundary>} />
          <Route path="inventory" element={<ErrorBoundary><ExInventory /></ErrorBoundary>} />
          <Route path="dl-dispatch" element={<ErrorBoundary><ExDlDispatch /></ErrorBoundary>} />
          <Route path="svc-dispatch" element={<ErrorBoundary><ExSvcDispatch /></ErrorBoundary>} />
          <Route path="stocktakes" element={<ErrorBoundary><ExStocktakeApproval /></ErrorBoundary>} />
          <Route path="capacity" element={<ErrorBoundary><ExCapacityQuery /></ErrorBoundary>} />
          <Route path="supply-quotes" element={<ErrorBoundary><ExSupplyQuotes /></ErrorBoundary>} />
          <Route path="crafts" element={<ErrorBoundary><Crafts /></ErrorBoundary>} /> {/* [BOOTH-PRD-003] EDX 工艺管理 */}
          {/* FAB 产线只读监控 (FAB-MES-03-FIX3): edx 复用 edxx 组件 */}
          <Route path="fab/zone/:stage" element={<ErrorBoundary><ExxFabZoneView /></ErrorBoundary>} />
          <Route path="station" element={<ErrorBoundary><ExxFabStations /></ErrorBoundary>} />
          <Route path="station/:id" element={<ErrorBoundary><ExxFabStationDetail /></ErrorBoundary>} />
          <Route path="fab/stations" element={<Navigate to="../station" replace />} />
          <Route path="fab/station/:id" element={<OldStationRedirect />} />
          <Route path="fab/telemetry" element={<ErrorBoundary><ExxFabTelemetry /></ErrorBoundary>} />
          <Route path="fab/score" element={<ErrorBoundary><ExxFabSupplierScore /></ErrorBoundary>} />
          <Route path="fab/equipment" element={<ErrorBoundary><ExxFabEquipment /></ErrorBoundary>} />
          <Route path="fab/equipment/oee" element={<ErrorBoundary><ExxFabOeeDashboard /></ErrorBoundary>} />
          <Route path="fab/equipment/:id" element={<ErrorBoundary><ExxFabEquipmentOee /></ErrorBoundary>} />
          <Route path="fab/maintenance" element={<ErrorBoundary><ExxFabMaintenance /></ErrorBoundary>} />
          <Route path="fab/andon" element={<ErrorBoundary><ExxFabAndon /></ErrorBoundary>} />
        </Route>

        {/* EDXX routes */}
        <Route
          path="/edxx"
          element={
            <RequireAuth>
              <MobileLayout />
            </RequireAuth>
          }
        >
          <Route index element={<ErrorBoundary><ExxModuleEntry /></ErrorBoundary>} />
          <Route path="fab/queue" element={<ErrorBoundary><ExxFabQueue /></ErrorBoundary>} />
          <Route path="fab/active" element={<ErrorBoundary><ExxFabActive /></ErrorBoundary>} />
          <Route path="fab/history" element={<ErrorBoundary><ExxFabHistory /></ErrorBoundary>} />
          <Route path="fab/operations" element={<ErrorBoundary><ExxFabOperations /></ErrorBoundary>} />
          <Route path="fab/andon" element={<ErrorBoundary><ExxFabAndon /></ErrorBoundary>} />
          <Route path="fab/dashboard" element={<ErrorBoundary><ExxProductionDashboard /></ErrorBoundary>} />
          <Route path="fab/zone/:stage" element={<ErrorBoundary><ExxFabZoneView /></ErrorBoundary>} />
          <Route path="station" element={<ErrorBoundary><ExxFabStations /></ErrorBoundary>} />
          <Route path="station/:id" element={<ErrorBoundary><ExxFabStationDetail /></ErrorBoundary>} />
          <Route path="fab/stations" element={<Navigate to="../station" replace />} />
          <Route path="fab/station/:id" element={<OldStationRedirect />} />
          <Route path="fab/telemetry" element={<ErrorBoundary><ExxFabTelemetry /></ErrorBoundary>} />
          <Route path="fab/score" element={<ErrorBoundary><ExxFabSupplierScore /></ErrorBoundary>} />
          <Route path="fab/equipment" element={<ErrorBoundary><ExxFabEquipment /></ErrorBoundary>} />
          <Route path="fab/equipment/oee" element={<ErrorBoundary><ExxFabOeeDashboard /></ErrorBoundary>} />
          <Route path="fab/equipment/:id" element={<ErrorBoundary><ExxFabEquipmentOee /></ErrorBoundary>} />
          <Route path="fab/maintenance" element={<ErrorBoundary><ExxFabMaintenance /></ErrorBoundary>} />
          <Route path="fab/yield" element={<ErrorBoundary><ExxYieldTracking /></ErrorBoundary>} />
          <Route path="qc" element={<ErrorBoundary><ExxQcExecute /></ErrorBoundary>} />
          <Route path="fab/trace" element={<ErrorBoundary><ExxFabTrace /></ErrorBoundary>} />
          <Route path="fab/defects" element={<ErrorBoundary><ExxFabDefects /></ErrorBoundary>} />
          <Route path="fab/plugins" element={<ErrorBoundary><ExxFabPlugins /></ErrorBoundary>} />
          <Route path="wh/inventory" element={<ErrorBoundary><ExxWhInventory /></ErrorBoundary>} />
          <Route path="wh/inbound" element={<ErrorBoundary><ExxWhInbound /></ErrorBoundary>} />
          <Route path="wh/outbound" element={<ErrorBoundary><ExxWhOutbound /></ErrorBoundary>} />
          <Route path="wh/txns" element={<ErrorBoundary><ExxWhTxns /></ErrorBoundary>} />
          <Route path="stocktake" element={<ErrorBoundary><ExxStocktakeExec /></ErrorBoundary>} />
          <Route path="wh/supply-orders" element={<ErrorBoundary><ExxSupplyOrders /></ErrorBoundary>} />
          <Route path="wh/supply-line-feed" element={<ErrorBoundary><ExxSupplyLineFeed /></ErrorBoundary>} />
          <Route path="wh/device-supply" element={<ErrorBoundary><ExxDeviceSupply /></ErrorBoundary>} />
          <Route path="wh/plaza-supply" element={<ErrorBoundary><ExxPlazaSupply /></ErrorBoundary>} />
          <Route path="dl" element={<ErrorBoundary><ExxDlExec /></ErrorBoundary>} />
          <Route path="svc" element={<ErrorBoundary><ExxSvcExec /></ErrorBoundary>} />
        </Route>

        {/* EM routes (供给运营长) */}
        <Route
          path="/em"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<ErrorBoundary><EmDashboard /></ErrorBoundary>} />
          <Route path="admissions" element={<ErrorBoundary><EmSupplierAdmissions /></ErrorBoundary>} />
          <Route path="strategies" element={<ErrorBoundary><EmSupplyStrategies /></ErrorBoundary>} />
          <Route path="capacity-plans" element={<ErrorBoundary><EmCapacityPlanning /></ErrorBoundary>} />
          <Route path="capacity-resources" element={<ErrorBoundary><EmCapacityResources /></ErrorBoundary>} />
          <Route path="atp-commitments" element={<ErrorBoundary><EmAtpCommitments /></ErrorBoundary>} />
          <Route path="sgu-catalog" element={<ErrorBoundary><EmSguCatalog /></ErrorBoundary>} />
          <Route path="sgu-listings" element={<ErrorBoundary><EmSguListings /></ErrorBoundary>} />
          <Route path="sgu-pending" element={<ErrorBoundary><EmSguPending /></ErrorBoundary>} />
          <Route path="supply-quotes" element={<ErrorBoundary><EmSupplyQuotes /></ErrorBoundary>} />
          {/* FAB 产线只读监控 (FAB-MES-04-FIX4): 复用 edxx 组件, 后端 requireFabRead 放行只读 GET, 写操作仍 FAB */}
          <Route path="fab/zone/:stage" element={<ErrorBoundary><ExxFabZoneView /></ErrorBoundary>} />
          <Route path="station" element={<ErrorBoundary><ExxFabStations /></ErrorBoundary>} />
          <Route path="station/:id" element={<ErrorBoundary><ExxFabStationDetail /></ErrorBoundary>} />
          <Route path="fab/stations" element={<Navigate to="../station" replace />} />
          <Route path="fab/station/:id" element={<OldStationRedirect />} />
          <Route path="fab/telemetry" element={<ErrorBoundary><ExxFabTelemetry /></ErrorBoundary>} />
          <Route path="fab/score" element={<ErrorBoundary><ExxFabSupplierScore /></ErrorBoundary>} />
          <Route path="fab/equipment" element={<ErrorBoundary><ExxFabEquipment /></ErrorBoundary>} />
          <Route path="fab/equipment/oee" element={<ErrorBoundary><ExxFabOeeDashboard /></ErrorBoundary>} />
          <Route path="fab/equipment/:id" element={<ErrorBoundary><ExxFabEquipmentOee /></ErrorBoundary>} />
          <Route path="fab/maintenance" element={<ErrorBoundary><ExxFabMaintenance /></ErrorBoundary>} />
          <Route path="fab/andon" element={<ErrorBoundary><ExxFabAndon /></ErrorBoundary>} />
        </Route>

        {/* Market routes (em/du/dx/dm can access) */}
        <Route
          path="/market"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<ErrorBoundary><MarketDashboard /></ErrorBoundary>} />
        </Route>

        <Route path="*" element={<RoleRedirect />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
