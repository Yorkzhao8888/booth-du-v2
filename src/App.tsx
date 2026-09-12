import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store';
import { Spin } from 'antd';
import { MaybeHiddenRoute } from './components/MaybeHiddenRoute';
import { isPathHidden } from './config/menuConfig';
import SSEListener from './components/SSEListener';
import ErrorBoundary from './components/ErrorBoundary';
import AppLayout from './components/AppLayout';
import MobileLayout from './components/MobileLayout';
const Login = lazy(() => import('./pages/Login'));
// DU pages
const DuDashboard = lazy(() => import('./pages/du/Dashboard'));
const DuOrders = lazy(() => import('./pages/du/Orders'));
const DuWorkOrders = lazy(() => import('./pages/du/WorkOrders'));
const DuInventory = lazy(() => import('./pages/du/Inventory'));
const DuBoms = lazy(() => import('./pages/du/Boms'));
const DuPurchaseOrders = lazy(() => import('./pages/du/PurchaseOrders'));
const DuProfitDashboard = lazy(() => import('./pages/du/ProfitDashboard'));
const DuDlTasks = lazy(() => import('./pages/du/DlTasks'));
const DuSvcTasks = lazy(() => import('./pages/du/SvcTasks'));
const DuBatches = lazy(() => import('./pages/du/Batches'));
const DuReplenishment = lazy(() => import('./pages/du/Replenishment'));
const DuSuppliers = lazy(() => import('./pages/du/Suppliers'));
const DuSupplierManagement = lazy(() => import('./pages/du/SupplierManagement'));
const DuExpiryControl = lazy(() => import('./pages/du/ExpiryControl'));
const DuInventoryAlerts = lazy(() => import('./pages/du/InventoryAlerts'));
const DuFulfillmentTrack = lazy(() => import('./pages/du/FulfillmentTrack'));
const DuSupplyOrders = lazy(() => import('./pages/du/SupplyOrders'));
const DuInventoryTransfer = lazy(() => import('./pages/du/InventoryTransfer'));
const DuRealtimeDashboard = lazy(() => import('./pages/du/RealtimeDashboard'));
import ProductionOrders from './pages/du/ProductionOrders'; // [BOOTH-PRD-001] 生产单契约地基
import SupplyShops from './pages/du/SupplyShops'; // [BOOTH-PRD-002] PM-001 供应铺管理
import OrderTypes from './pages/du/OrderTypes'; // [BOOTH-PRD-002] PM-002 订单类型配置
import RbacRoles from './pages/du/RbacRoles'; // [BOOTH-PRD-002] PM-004 角色权限矩阵
import Crafts from './pages/du/Crafts'; // [BOOTH-PRD-003] RD-005 工艺管理
import OnboardingWizard from './pages/du/OnboardingWizard'; // [Xfactory-ONBOARDING] 三步开通向导
import QuickStart from './pages/QuickStart'; // [Xfactory-ONBOARDING] 三动线帮助页
// EDX pages
const ExDashboard = lazy(() => import('./pages/ex/Dashboard'));
const ExWorkOrders = lazy(() => import('./pages/ex/WorkOrders'));
const ExBoms = lazy(() => import('./pages/ex/Boms'));
const ExSkus = lazy(() => import('./pages/ex/Skus'));
const ExInventory = lazy(() => import('./pages/ex/Inventory'));
const ExDlDispatch = lazy(() => import('./pages/ex/DlDispatch'));
const ExSvcDispatch = lazy(() => import('./pages/ex/SvcDispatch'));
const ExStocktakeApproval = lazy(() => import('./pages/ex/StocktakeApproval'));
const ExCapacityQuery = lazy(() => import('./pages/ex/CapacityQuery'));
// EDXX pages
const ExxModuleEntry = lazy(() => import('./pages/edxx/ModuleEntry'));
const ExxFabQueue = lazy(() => import('./pages/edxx/FabQueue'));
const ExxFabActive = lazy(() => import('./pages/edxx/FabActive'));
const ExxFabHistory = lazy(() => import('./pages/edxx/FabHistory'));
const ExxWhInventory = lazy(() => import('./pages/edxx/WhInventory'));
const ExxWhInbound = lazy(() => import('./pages/edxx/WhInbound'));
const ExxWhOutbound = lazy(() => import('./pages/edxx/WhOutbound'));
const ExxWhTxns = lazy(() => import('./pages/edxx/WhTxns'));
const ExxFabOperations = lazy(() => import('./pages/edxx/FabOperations'));
const ExxFabAndon = lazy(() => import('./pages/edxx/FabAndon'));
const ExxQcExecute = lazy(() => import('./pages/edxx/QcExecute'));
const ExxFabTrace = lazy(() => import('./pages/edxx/FabTrace'));
const ExxFabPlugins = lazy(() => import('./pages/edxx/FabPlugins'));
const ExxFabTelemetry = lazy(() => import('./pages/edxx/FabTelemetry'));
const ExxFabSupplierScore = lazy(() => import('./pages/edxx/FabSupplierScore'));
const ExxFabDefects = lazy(() => import('./pages/edxx/FabDefects'));
const ExxStocktakeExec = lazy(() => import('./pages/edxx/StocktakeExec'));
const ExxDlExec = lazy(() => import('./pages/edxx/DlExec'));
const ExxSvcExec = lazy(() => import('./pages/edxx/SvcExec'));
const ExxProductionDashboard = lazy(() => import('./pages/edxx/ProductionDashboard'));
const ExxYieldTracking = lazy(() => import('./pages/edxx/YieldTracking'));
const ExxFabZoneView = lazy(() => import('./pages/edxx/FabZoneView'));
// [W1-B1] FAB 作业流视图（四工序 tab 合并）
const ExxFabFlow = lazy(() => import('./pages/edxx/FabFlow'));
// [W1-C2] AU 店长台（operator 独立工作台）
const AUWorkbench = lazy(() => import('./pages/xepz/AUWorkbench'));
const ExxFabStations = lazy(() => import('./pages/edxx/FabStations'));
const ExxFabStationDetail = lazy(() => import('./pages/edxx/FabStationDetail'));
const ExxFabEquipment = lazy(() => import('./pages/edxx/FabEquipment'));
const ExxFabEquipmentOee = lazy(() => import('./pages/edxx/FabEquipmentOee'));
const ExxFabOeeDashboard = lazy(() => import('./pages/edxx/FabOeeDashboard'));
const ExxFabMaintenance = lazy(() => import('./pages/edxx/FabMaintenance'));
const ExxSupplyOrders = lazy(() => import('./pages/edxx/SupplyOrders'));
const ExxSupplyLineFeed = lazy(() => import('./pages/edxx/SupplyLineFeed'));
const ExxDeviceSupply = lazy(() => import('./pages/edxx/DeviceSupply'));
const ExxPlazaSupply = lazy(() => import('./pages/edxx/PlazaSupply'));
// DM pages
const DmDashboard = lazy(() => import('./pages/dm/Dashboard'));
// EMXX pages
const DxxDashboard = lazy(() => import('./pages/emxx/Dashboard'));
// EM pages
const EmDashboard = lazy(() => import('./pages/em/Dashboard'));
const EmSupplierAdmissions = lazy(() => import('./pages/em/SupplierAdmissions'));
const EmSupplyStrategies = lazy(() => import('./pages/em/SupplyStrategies'));
const EmCapacityPlanning = lazy(() => import('./pages/em/CapacityPlanning'));
const EmCapacityResources = lazy(() => import('./pages/em/CapacityResources'));
const EmAtpCommitments = lazy(() => import('./pages/em/AtpCommitments'));
const EmSguCatalog = lazy(() => import('./pages/em/SguCatalog'));
const EmSguListings = lazy(() => import('./pages/em/SguListings'));
const EmSguPending = lazy(() => import('./pages/em/SguPending'));
const EmSupplyQuotes = lazy(() => import('./pages/em/SupplyQuotes'));
const DuSupplyQuotes = lazy(() => import('./pages/du/SupplyQuotes'));
const ExSupplyQuotes = lazy(() => import('./pages/ex/SupplyQuotes'));
// Market pages
const MarketDashboard = lazy(() => import('./pages/market/Dashboard'));
// Common pages
const OrgChart = lazy(() => import('./pages/common/OrgChart'));
const EmployeeManagement = lazy(() => import('./pages/du/EmployeeManagement'));
const WarehouseDashboard = lazy(() => import('./pages/du/WarehouseDashboard'));
// [DUAL-PORTAL-P0] 双端容器分流 + 个人台/企业台
import { ContainerPortal } from './pages/portal/ContainerPortal';
import { HatSelect } from './pages/portal/HatSelect';
import { ForbiddenPage } from './pages/portal/ForbiddenPage';
import { PortalShell } from './components/PortalShell';
const PersonalWorkbench = lazy(() => import('./pages/xhpz/PersonalWorkbench'));
const EnterpriseWorkbench = lazy(() => import('./pages/xepz/EnterpriseWorkbench'));
// [XDP-ECO] 生态版四主体: 经营户台 + VEM 平台方控制台
const ShopOwnerWorkbench = lazy(() => import('./pages/xdpz/ShopOwnerWorkbench'));
const VemConsole = lazy(() => import('./pages/xvpz/VemConsole'));
import type { ContainerKey } from './types/containers';

const CONTAINER_PATHS = ['/containers', '/xhpz', '/xepz', '/xdpz', '/xvpz'];

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

    // [DUAL-PORTAL-P0] 容器层路由放行: 分流/帽选择/双端工作台不做角色 home 强制跳转 (容器+帽守卫自行处理)
    if (CONTAINER_PATHS.some((p) => path.startsWith(p))) {
      return <>{children}</>;
    }

    // dm can access all routes (read-only)
    if (role === 'dm') {
      // DM can access any route, no redirect needed
    }
    // em can access /em and /market routes
    else if (role === 'em' && !path.startsWith('/em') && !path.startsWith('/market')) {
      return <Navigate to="/em" replace />;
    }
    // du and dx share the same /du routes, and can access /market
    else if ((role === 'du' || role === 'dx') && !path.startsWith('/du') && !path.startsWith('/au') && !path.startsWith('/market')) { // [W1-C2] /au 店长台放行
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

// [DUAL-PORTAL-P0] 容器层守卫: 单容器账号跨端访问 → 无权限友好页 (不白屏); containers 结果会话内缓存
const RequireContainer: React.FC<{ container: ContainerKey; children: React.ReactNode }> = ({ container, children }) => {
  const { containers, setContainers } = useAuthStore();
  const [checked, setChecked] = useState<boolean>(!!containers);

  useEffect(() => {
    if (containers) {
      setChecked(true);
      return;
    }
    let alive = true;
    fetch('/api/booth/auth/containers', {
      headers: { Authorization: `Bearer ${localStorage.getItem('booth_token') || ''}` },
    })
      .then((r) => r.json())
      .then((d) => {
        const body = d?.data ?? d;
        if (alive) {
          // [XDP-ECO] 四主体容器: xhpz/xepz/xdpz/xvpz (xdpz/xvpz 默认 false, 以后端判定为准)
          setContainers({
            xhpz: body?.xhpz !== false,
            xepz: body?.xepz !== false,
            xdpz: body?.xdpz === true,
            xvpz: body?.xvpz === true,
          });
          setChecked(true);
        }
      })
      .catch(() => {
        // containers 接口不可达: 会话真实存在则放行, 细粒度权限由后端各接口兜底
        if (alive) {
          setContainers({ xhpz: true, xepz: true, xdpz: true, xvpz: true });
          setChecked(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [containers, setContainers]);

  if (!checked) return null;
  if (!containers?.[container]) return <ForbiddenPage container={container} />;
  return <>{children}</>;
};

// [DUAL-PORTAL-P0] 视角层守卫: 有 token 未选帽 → 角色选择页 (切换角色=回此页重进, 视角状态清空重建)
const RequireHat: React.FC<{ container: ContainerKey; children: React.ReactNode }> = ({ container, children }) => {
  const hat = useAuthStore((s) => s.hat);
  // [UX-BOOST] xvpz(平台方·VEM) / xdpz(经营户) 为管理控制台视图, 无作业帽语义, 不强制选帽
  if (container === 'xvpz' || container === 'xdpz') return <>{children}</>;
  if (!hat) return <Navigate to={`/${container}/hats`} replace />;
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

// [W1-B1] FAB 产线四页合并进作业流后的 zone/:stage 直连守卫：
// toggle 关（默认）→ 优雅重定向 /<tree>/fab/flow?zone=<stage>；toggle 开回 → 原四页视图原子恢复
function ZoneFlowRedirect() {
  const { stage } = useParams();
  if (!isPathHidden(`zone/${stage || ''}`)) return <ErrorBoundary><ExxFabZoneView /></ErrorBoundary>;
  return <Navigate to={`../fab/flow?zone=${stage || 'production'}`} replace />;
}

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <SSEListener />
      <Suspense
        fallback={
          <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Spin size="large" tip="页面加载中" />
          </div>
        }
      >
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/quickstart" element={<QuickStart />} /> {/* [Xfactory-ONBOARDING] 三动线帮助页, 免登可达 */}

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
          <Route path="onboarding" element={<ErrorBoundary><OnboardingWizard /></ErrorBoundary>} /> {/* [Xfactory-ONBOARDING] 三步开通向导 */}
          <Route path="orders" element={<ErrorBoundary><DuOrders /></ErrorBoundary>} />
          <Route path="work-orders" element={<ErrorBoundary><DuWorkOrders /></ErrorBoundary>} />
          <Route path="inventory" element={<ErrorBoundary><DuInventory /></ErrorBoundary>} />
          <Route path="boms" element={<ErrorBoundary><DuBoms /></ErrorBoundary>} />
          <Route path="purchase-orders" element={<ErrorBoundary><DuPurchaseOrders /></ErrorBoundary>} />
          <Route path="profit" element={<MaybeHiddenRoute flag="profit" fallback="/du"><ErrorBoundary><DuProfitDashboard /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="dl" element={<ErrorBoundary><DuDlTasks /></ErrorBoundary>} />
          <Route path="svc" element={<ErrorBoundary><DuSvcTasks /></ErrorBoundary>} />
          <Route path="supply-quotes" element={<MaybeHiddenRoute flag="supplyQuotes" fallback="/du"><ErrorBoundary><DuSupplyQuotes /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="batches" element={<ErrorBoundary><DuBatches /></ErrorBoundary>} />
          <Route path="replenishment" element={<MaybeHiddenRoute flag="replenishment" fallback="/du"><ErrorBoundary><DuReplenishment /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="suppliers" element={<ErrorBoundary><DuSupplierManagement /></ErrorBoundary>} />
          <Route path="suppliers-legacy" element={<ErrorBoundary><DuSuppliers /></ErrorBoundary>} />
          <Route path="expiry-control" element={<MaybeHiddenRoute flag="whExpiry" fallback="/du"><ErrorBoundary><DuExpiryControl /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="inventory-alerts" element={<MaybeHiddenRoute flag="whAlerts" fallback="/du"><ErrorBoundary><DuInventoryAlerts /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="fulfillment-track" element={<MaybeHiddenRoute flag="fulfillmentTrack" fallback="/du"><ErrorBoundary><DuFulfillmentTrack /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          {/* BOOTH-PK-02: SupplyOrder 显式契约 (M 层 du/dx) */}
          <Route path="supply-orders" element={<ErrorBoundary><DuSupplyOrders /></ErrorBoundary>} />
          {/* [BOOTH-PRD-001] 生产单契约地基 (G-007 三级状态联动 / BDD-19 闭环骨架) */}
          <Route path="production-orders" element={<ErrorBoundary><ProductionOrders /></ErrorBoundary>} />
          {/* [BOOTH-PRD-002] 铺面管理+权限 (阶段一 P0) */}
          <Route path="supply-shops" element={<MaybeHiddenRoute flag="supplyShops" fallback="/du"><ErrorBoundary><SupplyShops /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="order-types" element={<MaybeHiddenRoute flag="orderTypes" fallback="/du"><ErrorBoundary><OrderTypes /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="roles" element={<MaybeHiddenRoute flag="roles" fallback="/du"><ErrorBoundary><RbacRoles /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="crafts" element={<ErrorBoundary><Crafts /></ErrorBoundary>} /> {/* [BOOTH-PRD-003] RD-005 */}
          <Route path="inventory-transfer" element={<ErrorBoundary><DuInventoryTransfer /></ErrorBoundary>} />
          <Route path="realtime-dashboard" element={<MaybeHiddenRoute flag="realtime" fallback="/du"><ErrorBoundary><DuRealtimeDashboard /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="wh/warehouse-dashboard" element={<MaybeHiddenRoute flag="whBoard" fallback="/du"><ErrorBoundary><WarehouseDashboard /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="employees" element={<ErrorBoundary><EmployeeManagement /></ErrorBoundary>} />
          <Route path="org-chart" element={<MaybeHiddenRoute flag="orgChart" fallback="/du"><ErrorBoundary><OrgChart /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          {/* FAB 产线只读监控 (FAB-MES-03-FIX3): 复用 edxx 组件, 后端 requireFabRead 放行只读 GET, 写操作仍 FAB */}
          <Route path="fab/flow" element={<ErrorBoundary><ExxFabFlow /></ErrorBoundary>} /> {/* [W1-B1] 作业流视图 */}
          <Route path="fab/zone/:stage" element={<ZoneFlowRedirect />} /> {/* [W1-B1] 合并重定向 */}
          <Route path="station" element={<ErrorBoundary><ExxFabStations /></ErrorBoundary>} />
          <Route path="station/:id" element={<ErrorBoundary><ExxFabStationDetail /></ErrorBoundary>} />
          <Route path="fab/stations" element={<Navigate to="../station" replace />} />
          <Route path="fab/station" element={<Navigate to="../station" replace />} /> {/* [UX-BOOST] P1-e: fabBase/station 菜单死链兼容 */}
          <Route path="fab/station/:id" element={<OldStationRedirect />} />
          <Route path="fab/telemetry" element={<MaybeHiddenRoute flag="telemetry" fallback="../equipment"><ErrorBoundary><ExxFabTelemetry /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="fab/score" element={<ErrorBoundary><ExxFabSupplierScore /></ErrorBoundary>} />
          <Route path="fab/equipment" element={<ErrorBoundary><ExxFabEquipment /></ErrorBoundary>} />
          <Route path="fab/equipment/oee" element={<MaybeHiddenRoute flag="oee" fallback="../equipment"><ErrorBoundary><ExxFabOeeDashboard /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="fab/equipment/:id" element={<ErrorBoundary><ExxFabEquipmentOee /></ErrorBoundary>} />
          <Route path="fab/maintenance" element={<MaybeHiddenRoute flag="maintenance" fallback="../equipment"><ErrorBoundary><ExxFabMaintenance /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="fab/andon" element={<MaybeHiddenRoute flag="andon" fallback="../equipment"><ErrorBoundary><ExxFabAndon /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
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
          <Route path="org-chart" element={<MaybeHiddenRoute flag="orgChart" fallback="/du"><ErrorBoundary><OrgChart /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="employees" element={<ErrorBoundary><EmployeeManagement /></ErrorBoundary>} />
          {/* DM can access all DU routes in read-only mode */}
          <Route path="orders" element={<ErrorBoundary><DuOrders /></ErrorBoundary>} />
          <Route path="work-orders" element={<ErrorBoundary><DuWorkOrders /></ErrorBoundary>} />
          <Route path="inventory" element={<ErrorBoundary><DuInventory /></ErrorBoundary>} />
          <Route path="boms" element={<ErrorBoundary><DuBoms /></ErrorBoundary>} />
          <Route path="purchase-orders" element={<ErrorBoundary><DuPurchaseOrders /></ErrorBoundary>} />
          <Route path="profit" element={<MaybeHiddenRoute flag="profit" fallback="/du"><ErrorBoundary><DuProfitDashboard /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="dl" element={<ErrorBoundary><DuDlTasks /></ErrorBoundary>} />
          <Route path="svc" element={<ErrorBoundary><DuSvcTasks /></ErrorBoundary>} />
          <Route path="batches" element={<ErrorBoundary><DuBatches /></ErrorBoundary>} />
          <Route path="replenishment" element={<MaybeHiddenRoute flag="replenishment" fallback="/du"><ErrorBoundary><DuReplenishment /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="suppliers" element={<ErrorBoundary><DuSupplierManagement /></ErrorBoundary>} />
          <Route path="expiry-control" element={<MaybeHiddenRoute flag="whExpiry" fallback="/du"><ErrorBoundary><DuExpiryControl /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="inventory-alerts" element={<MaybeHiddenRoute flag="whAlerts" fallback="/du"><ErrorBoundary><DuInventoryAlerts /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="fulfillment-track" element={<MaybeHiddenRoute flag="fulfillmentTrack" fallback="/du"><ErrorBoundary><DuFulfillmentTrack /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
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
          <Route path="org-chart" element={<MaybeHiddenRoute flag="orgChart" fallback="/du"><ErrorBoundary><OrgChart /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
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
          <Route path="fab/flow" element={<ErrorBoundary><ExxFabFlow /></ErrorBoundary>} /> {/* [W1-B1] 作业流视图 */}
          <Route path="fab/zone/:stage" element={<ZoneFlowRedirect />} /> {/* [W1-B1] 合并重定向 */}
          <Route path="station" element={<ErrorBoundary><ExxFabStations /></ErrorBoundary>} />
          <Route path="station/:id" element={<ErrorBoundary><ExxFabStationDetail /></ErrorBoundary>} />
          <Route path="fab/stations" element={<Navigate to="../station" replace />} />
          <Route path="fab/station" element={<Navigate to="../station" replace />} /> {/* [UX-BOOST] P1-e: fabBase/station 菜单死链兼容 */}
          <Route path="fab/station/:id" element={<OldStationRedirect />} />
          <Route path="fab/telemetry" element={<MaybeHiddenRoute flag="telemetry" fallback="../equipment"><ErrorBoundary><ExxFabTelemetry /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="fab/score" element={<ErrorBoundary><ExxFabSupplierScore /></ErrorBoundary>} />
          <Route path="fab/equipment" element={<ErrorBoundary><ExxFabEquipment /></ErrorBoundary>} />
          <Route path="fab/equipment/oee" element={<MaybeHiddenRoute flag="oee" fallback="../equipment"><ErrorBoundary><ExxFabOeeDashboard /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="fab/equipment/:id" element={<ErrorBoundary><ExxFabEquipmentOee /></ErrorBoundary>} />
          <Route path="fab/maintenance" element={<MaybeHiddenRoute flag="maintenance" fallback="../equipment"><ErrorBoundary><ExxFabMaintenance /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="fab/andon" element={<MaybeHiddenRoute flag="andon" fallback="../equipment"><ErrorBoundary><ExxFabAndon /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
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
          <Route path="fab/andon" element={<MaybeHiddenRoute flag="andon" fallback="../equipment"><ErrorBoundary><ExxFabAndon /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="fab/dashboard" element={<ErrorBoundary><ExxProductionDashboard /></ErrorBoundary>} />
          <Route path="fab/flow" element={<ErrorBoundary><ExxFabFlow /></ErrorBoundary>} /> {/* [W1-B1] 作业流视图 */}
          <Route path="fab/zone/:stage" element={<ZoneFlowRedirect />} /> {/* [W1-B1] 合并重定向 */}
          <Route path="station" element={<ErrorBoundary><ExxFabStations /></ErrorBoundary>} />
          <Route path="station/:id" element={<ErrorBoundary><ExxFabStationDetail /></ErrorBoundary>} />
          <Route path="fab/stations" element={<Navigate to="../station" replace />} />
          <Route path="fab/station" element={<Navigate to="../station" replace />} /> {/* [UX-BOOST] P1-e: fabBase/station 菜单死链兼容 */}
          <Route path="fab/station/:id" element={<OldStationRedirect />} />
          <Route path="fab/telemetry" element={<MaybeHiddenRoute flag="telemetry" fallback="../equipment"><ErrorBoundary><ExxFabTelemetry /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="fab/score" element={<ErrorBoundary><ExxFabSupplierScore /></ErrorBoundary>} />
          <Route path="fab/equipment" element={<ErrorBoundary><ExxFabEquipment /></ErrorBoundary>} />
          <Route path="fab/equipment/oee" element={<MaybeHiddenRoute flag="oee" fallback="../equipment"><ErrorBoundary><ExxFabOeeDashboard /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="fab/equipment/:id" element={<ErrorBoundary><ExxFabEquipmentOee /></ErrorBoundary>} />
          <Route path="fab/maintenance" element={<MaybeHiddenRoute flag="maintenance" fallback="../equipment"><ErrorBoundary><ExxFabMaintenance /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
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
          <Route path="supply-quotes" element={<MaybeHiddenRoute flag="supplyQuotes" fallback="/em"><ErrorBoundary><EmSupplyQuotes /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          {/* FAB 产线只读监控 (FAB-MES-04-FIX4): 复用 edxx 组件, 后端 requireFabRead 放行只读 GET, 写操作仍 FAB */}
          <Route path="fab/flow" element={<ErrorBoundary><ExxFabFlow /></ErrorBoundary>} /> {/* [W1-B1] 作业流视图 */}
          <Route path="fab/zone/:stage" element={<ZoneFlowRedirect />} /> {/* [W1-B1] 合并重定向 */}
          <Route path="station" element={<ErrorBoundary><ExxFabStations /></ErrorBoundary>} />
          <Route path="station/:id" element={<ErrorBoundary><ExxFabStationDetail /></ErrorBoundary>} />
          <Route path="fab/stations" element={<Navigate to="../station" replace />} />
          <Route path="fab/station" element={<Navigate to="../station" replace />} /> {/* [UX-BOOST] P1-e: fabBase/station 菜单死链兼容 */}
          <Route path="fab/station/:id" element={<OldStationRedirect />} />
          <Route path="fab/telemetry" element={<MaybeHiddenRoute flag="telemetry" fallback="../equipment"><ErrorBoundary><ExxFabTelemetry /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="fab/score" element={<ErrorBoundary><ExxFabSupplierScore /></ErrorBoundary>} />
          <Route path="fab/equipment" element={<ErrorBoundary><ExxFabEquipment /></ErrorBoundary>} />
          <Route path="fab/equipment/oee" element={<MaybeHiddenRoute flag="oee" fallback="../equipment"><ErrorBoundary><ExxFabOeeDashboard /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="fab/equipment/:id" element={<ErrorBoundary><ExxFabEquipmentOee /></ErrorBoundary>} />
          <Route path="fab/maintenance" element={<MaybeHiddenRoute flag="maintenance" fallback="../equipment"><ErrorBoundary><ExxFabMaintenance /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
          <Route path="fab/andon" element={<MaybeHiddenRoute flag="andon" fallback="../equipment"><ErrorBoundary><ExxFabAndon /></ErrorBoundary></MaybeHiddenRoute>} /> {/* [W1-A] */}
        </Route>

        {/* [W1-C2] AU 店长台: operator 独立工作台 (dx 天然经营视角, 登录分流与演示卡描述一致) */}
        <Route
          path="/au"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<ErrorBoundary><AUWorkbench /></ErrorBoundary>} />
          <Route path="*" element={<Navigate to="/au" replace />} />
        </Route>
        {/* Market routes (em/du/dx/dm can access) */}
        <Route
          path="/market"
          element={
            <MaybeHiddenRoute flag="market" fallback="/du">
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
            </MaybeHiddenRoute>
          }
        >
          <Route index element={<ErrorBoundary><MarketDashboard /></ErrorBoundary>} />
        </Route>

        {/* [DUAL-PORTAL-P0] 双端容器: 一键登录后分流页 (#xhpz 个人 / #xepz 企业 / #xopz+#xgpz 预留置灰) */}
        <Route
          path="/containers"
          element={
            <RequireAuth>
              <ErrorBoundary>
                <ContainerPortal />
              </ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/xhpz"
          element={
            <RequireAuth>
              <RequireContainer container="xhpz">
                <RequireHat container="xhpz">
                  <PortalShell container="xhpz">
                    <ErrorBoundary>
                      <PersonalWorkbench />
                    </ErrorBoundary>
                  </PortalShell>
                </RequireHat>
              </RequireContainer>
            </RequireAuth>
          }
        />
        <Route
          path="/xhpz/hats"
          element={
            <RequireAuth>
              <RequireContainer container="xhpz">
                <ErrorBoundary>
                  <HatSelect container="xhpz" />
                </ErrorBoundary>
              </RequireContainer>
            </RequireAuth>
          }
        />
        <Route
          path="/xepz"
          element={
            <RequireAuth>
              <RequireContainer container="xepz">
                <RequireHat container="xepz">
                  <PortalShell container="xepz">
                    <ErrorBoundary>
                      <EnterpriseWorkbench />
                    </ErrorBoundary>
                  </PortalShell>
                </RequireHat>
              </RequireContainer>
            </RequireAuth>
          }
        />
        <Route
          path="/xepz/hats"
          element={
            <RequireAuth>
              <RequireContainer container="xepz">
                <ErrorBoundary>
                  <HatSelect container="xepz" />
                </ErrorBoundary>
              </RequireContainer>
            </RequireAuth>
          }
        />

        {/* [XDP-ECO] 经营户 (#xdpz) 铺位管理动线 */}
        <Route
          path="/xdpz"
          element={
            <RequireAuth>
              <RequireContainer container="xdpz">
                <RequireHat container="xdpz">
                  <PortalShell container="xdpz">
                    <ErrorBoundary>
                      <ShopOwnerWorkbench />
                    </ErrorBoundary>
                  </PortalShell>
                </RequireHat>
              </RequireContainer>
            </RequireAuth>
          }
        />
        <Route
          path="/xdpz/hats"
          element={
            <RequireAuth>
              <RequireContainer container="xdpz">
                <ErrorBoundary>
                  <HatSelect container="xdpz" />
                </ErrorBoundary>
              </RequireContainer>
            </RequireAuth>
          }
        />

        {/* [XDP-ECO] 平台方 (#xvpz · VEM) 生态治理控制台 */}
        <Route
          path="/xvpz"
          element={
            <RequireAuth>
              <RequireContainer container="xvpz">
                <RequireHat container="xvpz">
                  <PortalShell container="xvpz">
                    <ErrorBoundary>
                      <VemConsole />
                    </ErrorBoundary>
                  </PortalShell>
                </RequireHat>
              </RequireContainer>
            </RequireAuth>
          }
        />
        <Route
          path="/xvpz/hats"
          element={
            <RequireAuth>
              <RequireContainer container="xvpz">
                <ErrorBoundary>
                  <HatSelect container="xvpz" />
                </ErrorBoundary>
              </RequireContainer>
            </RequireAuth>
          }
        />

        <Route path="*" element={<RoleRedirect />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
};

export default App;
