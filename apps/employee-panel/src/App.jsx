import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import EmployeeLayout from "./layouts/EmployeeLayout";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";

// Lazy-load secondary management routes
const Orders = lazy(() => import("./pages/Orders"));
const Products = lazy(() => import("./pages/Products"));
const AddProduct = lazy(() => import("./pages/AddProduct"));
const AddCategory = lazy(() => import("./pages/AddCategory"));
const Banners = lazy(() => import("./pages/Banners"));

import ProtectedRoute from "./routes/ProtectedRoute";

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] w-full items-center justify-center p-8">
      <div className="flex flex-col items-center gap-2">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-emerald-500/20 border-t-emerald-500" />
        <span className="text-xs font-medium text-slate-400">Loading page...</span>
      </div>
    </div>
  );
}

function App() {
  return (
    <Suspense fallback={<PageFallback />}>
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
    </Suspense>
  );
}

export default App;
