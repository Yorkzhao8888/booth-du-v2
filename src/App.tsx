import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
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
import DexDashboard from './pages/dex/Dashboard';
import DexWorkOrders from './pages/dex/WorkOrders';
import DexBoms from './pages/dex/Boms';
import DexSkus from './pages/dex/Skus';
import DexInventory from './pages/dex/Inventory';
import DexDlDispatch from './pages/dex/DlDispatch';
import DexSvcDispatch from './pages/dex/SvcDispatch';
import DexStocktakeApproval from './pages/dex/StocktakeApproval';
import DexCapacityQuery from './pages/dex/CapacityQuery';
// DEXX pages
import DexxModuleEntry from './pages/dexx/ModuleEntry';
import DexxFabQueue from './pages/dexx/FabQueue';
import DexxFabActive from './pages/dexx/FabActive';
import DexxFabHistory from './pages/dexx/FabHistory';
import DexxWhInventory from './pages/dexx/WhInventory';
import DexxWhInbound from './pages/dexx/WhInbound';
import DexxWhOutbound from './pages/dexx/WhOutbound';
import DexxWhTxns from './pages/dexx/WhTxns';
import DexxFabOperations from './pages/dexx/FabOperations';
import DexxFabAndon from './pages/dexx/FabAndon';
import DexxQcExecute from './pages/dexx/QcExecute';
import DexxFabTrace from './pages/dexx/FabTrace';
import DexxFabPlugins from './pages/dexx/FabPlugins';
import DexxFabDefects from './pages/dexx/FabDefects';
import DexxStocktakeExec from './pages/dexx/StocktakeExec';
import DexxDlExec from './pages/dexx/DlExec';
import DexxSvcExec from './pages/dexx/SvcExec';
import DexxProductionDashboard from './pages/dexx/ProductionDashboard';
import DexxYieldTracking from './pages/dexx/YieldTracking';
import DexxFabZoneView from './pages/dexx/FabZoneView';
import DexxFabStations from './pages/dexx/FabStations';
import DexxFabStationDetail from './pages/dexx/FabStationDetail';
import DexxFabEquipment from './pages/dexx/FabEquipment';
import DexxFabEquipmentOee from './pages/dexx/FabEquipmentOee';
import DexxFabOeeDashboard from './pages/dexx/FabOeeDashboard';
import DexxFabMaintenance from './pages/dexx/FabMaintenance';
import DexxSupplyOrders from './pages/dexx/SupplyOrders';
import DexxSupplyLineFeed from './pages/dexx/SupplyLineFeed';
import DexxDeviceSupply from './pages/dexx/DeviceSupply';
import DexxPlazaSupply from './pages/dexx/PlazaSupply';
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
import DexSupplyQuotes from './pages/dex/SupplyQuotes';
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
    // dxx shares /dxx routes with dexx
    else if (role === 'dxx' && !path.startsWith('/dxx') && !path.startsWith('/dexx')) {
      return <Navigate to="/dxx" replace />;
    }
    else if (role === 'dex' && !path.startsWith('/dex')) {
      return <Navigate to="/dex" replace />;
    }
    else if (role === 'dexx' && !path.startsWith('/dexx')) {
      return <Navigate to="/dexx" replace />;
    }
  }

  return <>{children}</>;
};

const RoleRedirect: React.FC = () => {
  const { user } = useAuthStore();
  if (!user) return <Navigate to="/login" replace />;
  const home: Record<string, string> = { dm: '/dm', du: '/du', dx: '/du', dxx: '/dxx', dex: '/dex', dexx: '/dexx', em: '/em' };
  return <Navigate to={home[user.role] || '/login'} replace />;
};

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
          {/* FAB 产线只读监控 (FAB-MES-03-FIX3): 复用 dexx 组件, 后端 requireFabRead 放行只读 GET, 写操作仍 FAB */}
          <Route path="fab/zone/:stage" element={<ErrorBoundary><DexxFabZoneView /></ErrorBoundary>} />
          <Route path="fab/stations" element={<ErrorBoundary><DexxFabStations /></ErrorBoundary>} />
          <Route path="fab/station/:id" element={<ErrorBoundary><DexxFabStationDetail /></ErrorBoundary>} />
          <Route path="fab/equipment" element={<ErrorBoundary><DexxFabEquipment /></ErrorBoundary>} />
          <Route path="fab/equipment/oee" element={<ErrorBoundary><DexxFabOeeDashboard /></ErrorBoundary>} />
          <Route path="fab/equipment/:id" element={<ErrorBoundary><DexxFabEquipmentOee /></ErrorBoundary>} />
          <Route path="fab/maintenance" element={<ErrorBoundary><DexxFabMaintenance /></ErrorBoundary>} />
          <Route path="fab/andon" element={<ErrorBoundary><DexxFabAndon /></ErrorBoundary>} />
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
          {/* DXX can access DEXX execution routes */}
          <Route path="dl" element={<ErrorBoundary><DexxDlExec /></ErrorBoundary>} />
          <Route path="svc" element={<ErrorBoundary><DexxSvcExec /></ErrorBoundary>} />
        </Route>

        {/* DEX routes */}
        <Route
          path="/dex"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<ErrorBoundary><DexDashboard /></ErrorBoundary>} />
          <Route path="work-orders" element={<ErrorBoundary><DexWorkOrders /></ErrorBoundary>} />
          <Route path="boms" element={<ErrorBoundary><DexBoms /></ErrorBoundary>} />
          <Route path="skus" element={<ErrorBoundary><DexSkus /></ErrorBoundary>} />
          <Route path="inventory" element={<ErrorBoundary><DexInventory /></ErrorBoundary>} />
          <Route path="dl-dispatch" element={<ErrorBoundary><DexDlDispatch /></ErrorBoundary>} />
          <Route path="svc-dispatch" element={<ErrorBoundary><DexSvcDispatch /></ErrorBoundary>} />
          <Route path="stocktakes" element={<ErrorBoundary><DexStocktakeApproval /></ErrorBoundary>} />
          <Route path="capacity" element={<ErrorBoundary><DexCapacityQuery /></ErrorBoundary>} />
          <Route path="supply-quotes" element={<ErrorBoundary><DexSupplyQuotes /></ErrorBoundary>} />
          {/* FAB 产线只读监控 (FAB-MES-03-FIX3): dex 复用 dexx 组件 */}
          <Route path="fab/zone/:stage" element={<ErrorBoundary><DexxFabZoneView /></ErrorBoundary>} />
          <Route path="fab/stations" element={<ErrorBoundary><DexxFabStations /></ErrorBoundary>} />
          <Route path="fab/station/:id" element={<ErrorBoundary><DexxFabStationDetail /></ErrorBoundary>} />
          <Route path="fab/equipment" element={<ErrorBoundary><DexxFabEquipment /></ErrorBoundary>} />
          <Route path="fab/equipment/oee" element={<ErrorBoundary><DexxFabOeeDashboard /></ErrorBoundary>} />
          <Route path="fab/equipment/:id" element={<ErrorBoundary><DexxFabEquipmentOee /></ErrorBoundary>} />
          <Route path="fab/maintenance" element={<ErrorBoundary><DexxFabMaintenance /></ErrorBoundary>} />
          <Route path="fab/andon" element={<ErrorBoundary><DexxFabAndon /></ErrorBoundary>} />
        </Route>

        {/* DEXX routes */}
        <Route
          path="/dexx"
          element={
            <RequireAuth>
              <MobileLayout />
            </RequireAuth>
          }
        >
          <Route index element={<ErrorBoundary><DexxModuleEntry /></ErrorBoundary>} />
          <Route path="fab/queue" element={<ErrorBoundary><DexxFabQueue /></ErrorBoundary>} />
          <Route path="fab/active" element={<ErrorBoundary><DexxFabActive /></ErrorBoundary>} />
          <Route path="fab/history" element={<ErrorBoundary><DexxFabHistory /></ErrorBoundary>} />
          <Route path="fab/operations" element={<ErrorBoundary><DexxFabOperations /></ErrorBoundary>} />
          <Route path="fab/andon" element={<ErrorBoundary><DexxFabAndon /></ErrorBoundary>} />
          <Route path="fab/dashboard" element={<ErrorBoundary><DexxProductionDashboard /></ErrorBoundary>} />
          <Route path="fab/zone/:stage" element={<ErrorBoundary><DexxFabZoneView /></ErrorBoundary>} />
          <Route path="fab/stations" element={<ErrorBoundary><DexxFabStations /></ErrorBoundary>} />
          <Route path="fab/station/:id" element={<ErrorBoundary><DexxFabStationDetail /></ErrorBoundary>} />
          <Route path="fab/equipment" element={<ErrorBoundary><DexxFabEquipment /></ErrorBoundary>} />
          <Route path="fab/equipment/oee" element={<ErrorBoundary><DexxFabOeeDashboard /></ErrorBoundary>} />
          <Route path="fab/equipment/:id" element={<ErrorBoundary><DexxFabEquipmentOee /></ErrorBoundary>} />
          <Route path="fab/maintenance" element={<ErrorBoundary><DexxFabMaintenance /></ErrorBoundary>} />
          <Route path="fab/yield" element={<ErrorBoundary><DexxYieldTracking /></ErrorBoundary>} />
          <Route path="qc" element={<ErrorBoundary><DexxQcExecute /></ErrorBoundary>} />
          <Route path="fab/trace" element={<ErrorBoundary><DexxFabTrace /></ErrorBoundary>} />
          <Route path="fab/defects" element={<ErrorBoundary><DexxFabDefects /></ErrorBoundary>} />
          <Route path="fab/plugins" element={<ErrorBoundary><DexxFabPlugins /></ErrorBoundary>} />
          <Route path="wh/inventory" element={<ErrorBoundary><DexxWhInventory /></ErrorBoundary>} />
          <Route path="wh/inbound" element={<ErrorBoundary><DexxWhInbound /></ErrorBoundary>} />
          <Route path="wh/outbound" element={<ErrorBoundary><DexxWhOutbound /></ErrorBoundary>} />
          <Route path="wh/txns" element={<ErrorBoundary><DexxWhTxns /></ErrorBoundary>} />
          <Route path="stocktake" element={<ErrorBoundary><DexxStocktakeExec /></ErrorBoundary>} />
          <Route path="wh/supply-orders" element={<ErrorBoundary><DexxSupplyOrders /></ErrorBoundary>} />
          <Route path="wh/supply-line-feed" element={<ErrorBoundary><DexxSupplyLineFeed /></ErrorBoundary>} />
          <Route path="wh/device-supply" element={<ErrorBoundary><DexxDeviceSupply /></ErrorBoundary>} />
          <Route path="wh/plaza-supply" element={<ErrorBoundary><DexxPlazaSupply /></ErrorBoundary>} />
          <Route path="dl" element={<ErrorBoundary><DexxDlExec /></ErrorBoundary>} />
          <Route path="svc" element={<ErrorBoundary><DexxSvcExec /></ErrorBoundary>} />
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
          {/* FAB 产线只读监控 (FAB-MES-04-FIX4): 复用 dexx 组件, 后端 requireFabRead 放行只读 GET, 写操作仍 FAB */}
          <Route path="fab/zone/:stage" element={<ErrorBoundary><DexxFabZoneView /></ErrorBoundary>} />
          <Route path="fab/stations" element={<ErrorBoundary><DexxFabStations /></ErrorBoundary>} />
          <Route path="fab/station/:id" element={<ErrorBoundary><DexxFabStationDetail /></ErrorBoundary>} />
          <Route path="fab/equipment" element={<ErrorBoundary><DexxFabEquipment /></ErrorBoundary>} />
          <Route path="fab/equipment/oee" element={<ErrorBoundary><DexxFabOeeDashboard /></ErrorBoundary>} />
          <Route path="fab/equipment/:id" element={<ErrorBoundary><DexxFabEquipmentOee /></ErrorBoundary>} />
          <Route path="fab/maintenance" element={<ErrorBoundary><DexxFabMaintenance /></ErrorBoundary>} />
          <Route path="fab/andon" element={<ErrorBoundary><DexxFabAndon /></ErrorBoundary>} />
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
