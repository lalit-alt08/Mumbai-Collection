import { Routes, Route, Navigate } from "react-router-dom";

import EmployeeLayout from "./layouts/EmployeeLayout";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Orders from "./pages/Orders";
import Products from "./pages/Products";

import ProtectedRoute from "./routes/ProtectedRoute";

function App() {
  return (
    <Routes>
      {/* Employee Login */}
      <Route path="/login" element={<Login />} />

      {/* Protected Employee Area */}
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<EmployeeLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="products" element={<Products />} />
          <Route path="orders" element={<Orders />} />
        </Route>
      </Route>

      {/* Unknown routes */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;
