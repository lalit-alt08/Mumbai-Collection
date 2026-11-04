import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

function ProtectedRoute() {
  const { isAuthenticated, isReconnecting, loading } = useAuth();
  const location = useLocation();

  // AuthContext is still restoring/checking the login session or reconnecting
  if (loading || isReconnecting) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center p-6 text-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#42D6E8]/20 border-t-[#42D6E8] mb-3" />
        {isReconnecting && (
          <>
            <p className="text-sm font-medium text-[#0A1628]/70">Reconnecting to store...</p>
            <p className="text-xs text-[#0A1628]/50 mt-1">Our services are momentarily synchronizing. Please wait a moment.</p>
          </>
        )}
      </div>
    );
  }

  // User is not logged in
  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  // Profile setup is deferred to checkout; authenticated users have full access to protected routes
  return <Outlet />;
}

export default ProtectedRoute;
