import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store';
import SSEListener from './components/SSEListener';
import AppLayout from './components/AppLayout';
import MobileLayout from './components/MobileLayout';
import Login from './pages/Login';
import DuDashboard from './pages/du/Dashboard';
import DuOrders from './pages/du/Orders';
import DuWorkOrders from './pages/du/WorkOrders';
import DuInventory from './pages/du/Inventory';
import DuBoms from './pages/du/Boms';
import DexDashboard from './pages/dex/Dashboard';
import DexWorkOrders from './pages/dex/WorkOrders';
import DexBoms from './pages/dex/Boms';
import DexSkus from './pages/dex/Skus';
import DexInventory from './pages/dex/Inventory';
import DexxModuleEntry from './pages/dexx/ModuleEntry';
import DexxFabQueue from './pages/dexx/FabQueue';
import DexxFabActive from './pages/dexx/FabActive';
import DexxFabHistory from './pages/dexx/FabHistory';
import DexxWhInventory from './pages/dexx/WhInventory';
import DexxWhInbound from './pages/dexx/WhInbound';
import DexxWhOutbound from './pages/dexx/WhOutbound';
import DexxWhTxns from './pages/dexx/WhTxns';

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
          <Route index element={<DuDashboard />} />
          <Route path="orders" element={<DuOrders />} />
          <Route path="work-orders" element={<DuWorkOrders />} />
          <Route path="inventory" element={<DuInventory />} />
          <Route path="boms" element={<DuBoms />} />
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
          <Route index element={<DexDashboard />} />
          <Route path="work-orders" element={<DexWorkOrders />} />
          <Route path="boms" element={<DexBoms />} />
          <Route path="skus" element={<DexSkus />} />
          <Route path="inventory" element={<DexInventory />} />
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
          <Route index element={<DexxModuleEntry />} />
          <Route path="fab/queue" element={<DexxFabQueue />} />
          <Route path="fab/active" element={<DexxFabActive />} />
          <Route path="fab/history" element={<DexxFabHistory />} />
          <Route path="wh/inventory" element={<DexxWhInventory />} />
          <Route path="wh/inbound" element={<DexxWhInbound />} />
          <Route path="wh/outbound" element={<DexxWhOutbound />} />
          <Route path="wh/txns" element={<DexxWhTxns />} />
        </Route>

        <Route path="*" element={<RoleRedirect />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
