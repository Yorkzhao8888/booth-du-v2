import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store';
import SSEListener from './components/SSEListener';
import AppLayout from './components/AppLayout';
import MobileLayout from './components/MobileLayout';
import Login from './pages/Login';
import EuDashboard from './pages/eu/Dashboard';
import EuOrders from './pages/eu/Orders';
import EuWorkOrders from './pages/eu/WorkOrders';
import EuInventory from './pages/eu/Inventory';
import EuBoms from './pages/eu/Boms';
import ExDashboard from './pages/ex/Dashboard';
import ExWorkOrders from './pages/ex/WorkOrders';
import ExBoms from './pages/ex/Boms';
import ExSkus from './pages/ex/Skus';
import ExInventory from './pages/ex/Inventory';
import ExxModuleEntry from './pages/exx/ModuleEntry';
import ExxFabQueue from './pages/exx/FabQueue';
import ExxFabActive from './pages/exx/FabActive';
import ExxFabHistory from './pages/exx/FabHistory';
import ExxWhInventory from './pages/exx/WhInventory';
import ExxWhInbound from './pages/exx/WhInbound';
import ExxWhOutbound from './pages/exx/WhOutbound';
import ExxWhTxns from './pages/exx/WhTxns';

const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, user } = useAuthStore();
  const location = useLocation();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (user) {
    const role = user.role;
    const path = location.pathname;

    if (role === 'eu' && !path.startsWith('/eu')) {
      return <Navigate to="/eu" replace />;
    }
    if (role === 'ex' && !path.startsWith('/ex')) {
      return <Navigate to="/ex" replace />;
    }
    if (role === 'exx' && !path.startsWith('/exx')) {
      return <Navigate to="/exx" replace />;
    }
  }

  return <>{children}</>;
};

const RoleRedirect: React.FC = () => {
  const { user } = useAuthStore();
  if (!user) return <Navigate to="/login" replace />;
  const home: Record<string, string> = { eu: '/eu', ex: '/ex', exx: '/exx' };
  return <Navigate to={home[user.role] || '/login'} replace />;
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <SSEListener />
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* EU routes */}
        <Route
          path="/eu"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<EuDashboard />} />
          <Route path="orders" element={<EuOrders />} />
          <Route path="work-orders" element={<EuWorkOrders />} />
          <Route path="inventory" element={<EuInventory />} />
          <Route path="boms" element={<EuBoms />} />
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
          <Route index element={<ExDashboard />} />
          <Route path="work-orders" element={<ExWorkOrders />} />
          <Route path="boms" element={<ExBoms />} />
          <Route path="skus" element={<ExSkus />} />
          <Route path="inventory" element={<ExInventory />} />
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
          <Route index element={<ExxModuleEntry />} />
          <Route path="fab/queue" element={<ExxFabQueue />} />
          <Route path="fab/active" element={<ExxFabActive />} />
          <Route path="fab/history" element={<ExxFabHistory />} />
          <Route path="wh/inventory" element={<ExxWhInventory />} />
          <Route path="wh/inbound" element={<ExxWhInbound />} />
          <Route path="wh/outbound" element={<ExxWhOutbound />} />
          <Route path="wh/txns" element={<ExxWhTxns />} />
        </Route>

        <Route path="*" element={<RoleRedirect />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
