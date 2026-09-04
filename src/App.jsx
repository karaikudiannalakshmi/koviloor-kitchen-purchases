import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { CategoriesProvider } from './contexts/CategoriesContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Vendors from './pages/Vendors';
import Ingredients from './pages/Ingredients';
import Categories from './pages/Categories';
import BillEntry from './pages/BillEntry';
import BillsLedger from './pages/BillsLedger';
import IngredientLedger from './pages/IngredientLedger';
import DailyLog from './pages/DailyLog';

function Protected({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="boot">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <CategoriesProvider><Layout>{children}</Layout></CategoriesProvider>;
}

function AppRoutes() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="boot">Loading…</div>;
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/vendors" element={<Protected><Vendors /></Protected>} />
      <Route path="/ingredients" element={<Protected><Ingredients /></Protected>} />
      <Route path="/categories" element={<Protected><Categories /></Protected>} />
      <Route path="/bills/new" element={<Protected><BillEntry /></Protected>} />
      <Route path="/bills/:id/edit" element={<Protected><BillEntry /></Protected>} />
      <Route path="/bills" element={<Protected><BillsLedger /></Protected>} />
      <Route path="/ledger" element={<Protected><IngredientLedger /></Protected>} />
      <Route path="/daily-log" element={<Protected><DailyLog /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
