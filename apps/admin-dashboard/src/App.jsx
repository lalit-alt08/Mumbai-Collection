import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import AdminLayout from "./layouts/AdminLayout";

import Login from "./pages/Login";
import Overview from "./pages/Overview";

// Lazy-load secondary administrative routes
const Products = lazy(() => import("./pages/Products"));
const Customers = lazy(() => import("./pages/Customers"));
const Employees = lazy(() => import("./pages/Employees"));
const Analytics = lazy(() => import("./pages/Analytics"));
const StoreHours = lazy(() => import("./pages/StoreHours"));
const CustomerSuspension = lazy(() => import("./pages/CustomerSuspension"));

import ProtectedRoute from "./routes/ProtectedRoute";

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] w-full items-center justify-center p-8">
      <div className="flex flex-col items-center gap-2">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#FF8A00]/20 border-t-[#FF8A00]" />
        <span className="text-xs font-medium text-gray-400">Loading page...</span>
      </div>
    </div>
  );
}

function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        {/* Admin Login */}
        <Route path="/login" element={<Login />} />

        {/* Protected Admin Area */}
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<AdminLayout />}>
            <Route index element={<Overview />} />
            <Route path="products" element={<Products />} />
            <Route path="customers" element={<Customers />} />
            <Route path="customer-suspension" element={<CustomerSuspension />} />
            <Route path="employees" element={<Employees />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="store-hours" element={<StoreHours />} />
          </Route>
        </Route>

        {/* Unknown routes */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;