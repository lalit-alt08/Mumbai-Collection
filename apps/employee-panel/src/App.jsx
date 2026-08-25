import { Routes, Route, Navigate } from "react-router-dom";

import EmployeeLayout from "./layouts/EmployeeLayout";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Orders from "./pages/Orders";
import Products from "./pages/Products";
import AddProduct from "./pages/AddProduct";
import AddCategory from "./pages/AddCategory";
import Banners from "./pages/Banners";

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
          <Route path="products/add" element={<AddProduct />} />
          <Route path="categories/add" element={<AddCategory />} />
          <Route path="banners" element={<Banners />} />
          <Route path="orders" element={<Orders />} />
        </Route>
      </Route>

      {/* Unknown routes */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;
