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
// DEX pages
import DexDashboard from './pages/dex/Dashboard';
import DexWorkOrders from './pages/dex/WorkOrders';
import DexBoms from './pages/dex/Boms';
import DexSkus from './pages/dex/Skus';
import DexInventory from './pages/dex/Inventory';
import DexDlDispatch from './pages/dex/DlDispatch';
import DexSvcDispatch from './pages/dex/SvcDispatch';
import DexStocktakeApproval from './pages/dex/StocktakeApproval';
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
import DexxQcExecute from './pages/dexx/QcExecute';
import DexxStocktakeExec from './pages/dexx/StocktakeExec';
import DexxDlExec from './pages/dexx/DlExec';
import DexxSvcExec from './pages/dexx/SvcExec';

const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, user } = useAuthStore();
  const location = useLocation();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (user) {
    const role = user.role;
    const path = location.pathname;

    // du and dx share the same /du routes
    if ((role === 'du' || role === 'dx') && !path.startsWith('/du')) {
      return <Navigate to="/du" replace />;
    }
    if (role === 'dex' && !path.startsWith('/dex')) {
      return <Navigate to="/dex" replace />;
    }
    if (role === 'dexx' && !path.startsWith('/dexx')) {
      return <Navigate to="/dexx" replace />;
    }
  }

  return <>{children}</>;
};

const RoleRedirect: React.FC = () => {
  const { user } = useAuthStore();
  if (!user) return <Navigate to="/login" replace />;
  const home: Record<string, string> = { du: '/du', dx: '/du', dex: '/dex', dexx: '/dexx' };
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
          <Route path="batches" element={<ErrorBoundary><DuBatches /></ErrorBoundary>} />
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
          <Route path="qc" element={<ErrorBoundary><DexxQcExecute /></ErrorBoundary>} />
          <Route path="wh/inventory" element={<ErrorBoundary><DexxWhInventory /></ErrorBoundary>} />
          <Route path="wh/inbound" element={<ErrorBoundary><DexxWhInbound /></ErrorBoundary>} />
          <Route path="wh/outbound" element={<ErrorBoundary><DexxWhOutbound /></ErrorBoundary>} />
          <Route path="wh/txns" element={<ErrorBoundary><DexxWhTxns /></ErrorBoundary>} />
          <Route path="stocktake" element={<ErrorBoundary><DexxStocktakeExec /></ErrorBoundary>} />
          <Route path="dl" element={<ErrorBoundary><DexxDlExec /></ErrorBoundary>} />
          <Route path="svc" element={<ErrorBoundary><DexxSvcExec /></ErrorBoundary>} />
        </Route>

        <Route path="*" element={<RoleRedirect />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
