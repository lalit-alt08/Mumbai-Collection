import { Navigate, Outlet } from "react-router-dom";
import { useAdminAuth } from "../context/AdminAuthContext.jsx";
import { Loader2 } from "lucide-react";

const ProtectedRoute = () => {
  const { user, loading, isAdmin } = useAdminAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#121212] text-white">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FF8A00]/10 text-[#FF8A00] mb-4">
          <Loader2 size={24} className="animate-spin" />
        </div>
        <p className="text-xs font-bold text-gray-400 tracking-wider uppercase">
          Verifying Admin Session...
        </p>
      </div>
    );
  }

  if (!user || !isAdmin) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;