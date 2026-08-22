import { Navigate, Outlet } from "react-router-dom";
import { useEmployeeAuth } from "../context/EmployeeAuthContext.jsx";
import { Loader2 } from "lucide-react";

const ProtectedRoute = () => {
  const { user, loading, isEmployee } = useEmployeeAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0F172A] text-white">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400 mb-4">
          <Loader2 size={24} className="animate-spin" />
        </div>
        <p className="text-xs font-bold text-slate-400 tracking-wider uppercase">
          Verifying Employee Session...
        </p>
      </div>
    );
  }

  if (!user || !isEmployee) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
