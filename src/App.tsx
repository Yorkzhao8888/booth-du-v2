import React from 'react';
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
// DEX pages
import ExDashboard from './pages/ex/Dashboard';
import ExWorkOrders from './pages/ex/WorkOrders';
import ExBoms from './pages/ex/Boms';
import ExSkus from './pages/ex/Skus';
import ExInventory from './pages/ex/Inventory';
import ExDlDispatch from './pages/ex/DlDispatch';
import ExSvcDispatch from './pages/ex/SvcDispatch';
import ExStocktakeApproval from './pages/ex/StocktakeApproval';
import ExCapacityQuery from './pages/ex/CapacityQuery';
// EXX pages
import ExxModuleEntry from './pages/exx/ModuleEntry';
import ExxFabQueue from './pages/exx/FabQueue';
import ExxFabActive from './pages/exx/FabActive';
import ExxFabHistory from './pages/exx/FabHistory';
import ExxWhInventory from './pages/exx/WhInventory';
import ExxWhInbound from './pages/exx/WhInbound';
import ExxWhOutbound from './pages/exx/WhOutbound';
import ExxWhTxns from './pages/exx/WhTxns';
import ExxFabOperations from './pages/exx/FabOperations';
import ExxFabAndon from './pages/exx/FabAndon';
import ExxQcExecute from './pages/exx/QcExecute';
import ExxFabTrace from './pages/exx/FabTrace';
import ExxFabPlugins from './pages/exx/FabPlugins';
import ExxFabTelemetry from './pages/exx/FabTelemetry';
import ExxFabSupplierScore from './pages/exx/FabSupplierScore';
import ExxFabDefects from './pages/exx/FabDefects';
import ExxStocktakeExec from './pages/exx/StocktakeExec';
import ExxDlExec from './pages/exx/DlExec';
import ExxSvcExec from './pages/exx/SvcExec';
import ExxProductionDashboard from './pages/exx/ProductionDashboard';
import ExxYieldTracking from './pages/exx/YieldTracking';
import ExxFabZoneView from './pages/exx/FabZoneView';
import ExxFabStations from './pages/exx/FabStations';
import ExxFabStationDetail from './pages/exx/FabStationDetail';
import ExxFabEquipment from './pages/exx/FabEquipment';
import ExxFabEquipmentOee from './pages/exx/FabEquipmentOee';
import ExxFabOeeDashboard from './pages/exx/FabOeeDashboard';
import ExxFabMaintenance from './pages/exx/FabMaintenance';
import ExxSupplyOrders from './pages/exx/SupplyOrders';
import ExxSupplyLineFeed from './pages/exx/SupplyLineFeed';
import ExxDeviceSupply from './pages/exx/DeviceSupply';
import ExxPlazaSupply from './pages/exx/PlazaSupply';
// DM pages
import DmDashboard from './pages/dm/Dashboard';
// DXX pages
import DxxDashboard from './pages/dxx/Dashboard';
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
  const { token, user } = useAuthStore();
  const location = useLocation();

  if (!token) {
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
    // dxx shares /dxx routes with exx
    else if (role === 'dxx' && !path.startsWith('/dxx') && !path.startsWith('/exx')) {
      return <Navigate to="/dxx" replace />;
    }
    else if (role === 'ex' && !path.startsWith('/ex')) {
      return <Navigate to="/ex" replace />;
    }
    else if (role === 'exx' && !path.startsWith('/exx')) {
      return <Navigate to="/exx" replace />;
    }
  }

  return <>{children}</>;
};

const RoleRedirect: React.FC = () => {
  const { user } = useAuthStore();
  if (!user) return <Navigate to="/login" replace />;
  const home: Record<string, string> = { dm: '/dm', du: '/du', dx: '/du', dxx: '/dxx', ex: '/ex', exx: '/exx', em: '/em' };
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
          <Route path="inventory-transfer" element={<ErrorBoundary><DuInventoryTransfer /></ErrorBoundary>} />
          <Route path="realtime-dashboard" element={<ErrorBoundary><DuRealtimeDashboard /></ErrorBoundary>} />
          <Route path="wh/warehouse-dashboard" element={<ErrorBoundary><WarehouseDashboard /></ErrorBoundary>} />
          <Route path="employees" element={<ErrorBoundary><EmployeeManagement /></ErrorBoundary>} />
          <Route path="org-chart" element={<ErrorBoundary><OrgChart /></ErrorBoundary>} />
          {/* FAB 产线只读监控 (FAB-MES-03-FIX3): 复用 exx 组件, 后端 requireFabRead 放行只读 GET, 写操作仍 FAB */}
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
          path="/dxx"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<ErrorBoundary><DxxDashboard /></ErrorBoundary>} />
          <Route path="org-chart" element={<ErrorBoundary><OrgChart /></ErrorBoundary>} />
          {/* DXX can access EXX execution routes */}
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
          {/* FAB 产线只读监控 (FAB-MES-03-FIX3): dex 复用 exx 组件 */}
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

        {/* EXX routes */}
        <Route
          path="/exx"
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
          {/* FAB 产线只读监控 (FAB-MES-04-FIX4): 复用 exx 组件, 后端 requireFabRead 放行只读 GET, 写操作仍 FAB */}
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
