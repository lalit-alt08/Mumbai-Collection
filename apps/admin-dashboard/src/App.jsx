import { Routes, Route, Navigate } from "react-router-dom";

import AdminLayout from "./layouts/AdminLayout";

import Login from "./pages/Login";

import Overview from "./pages/Overview";
import Products from "./pages/Products";
import Customers from "./pages/Customers";
import Analytics from "./pages/Analytics";

import ProtectedRoute from "./routes/ProtectedRoute";

function App() {
  return (
    <Routes>
      {/* Admin Login */}
      <Route path="/login" element={<Login />} />

      {/* Protected Admin Area */}
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<AdminLayout />}>
          <Route index element={<Overview />} />
          <Route path="products" element={<Products />} />
          <Route path="customers" element={<Customers />} />
          <Route path="analytics" element={<Analytics />} />
        </Route>
      </Route>

      {/* Unknown routes */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;