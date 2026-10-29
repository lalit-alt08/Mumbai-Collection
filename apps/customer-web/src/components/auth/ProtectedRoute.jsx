import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import API_URL from "../../config/api.js";
import { useEffect, useState } from "react";
import axios from "axios";

function ProtectedRoute() {
  const { isAuthenticated, isReconnecting, loading, handleSessionExpired } = useAuth();
  const location = useLocation();

  const isProfileSetupRoute = location.pathname === "/profile-setup";
  const [checkingProfile, setCheckingProfile] = useState(!isProfileSetupRoute);
  const [profileComplete, setProfileComplete] = useState(false);

  useEffect(() => {
    const checkProfile = async () => {
      // AuthContext is still checking the server session or reconnecting
      if (loading || isReconnecting) {
        return;
      }

      // User is not authenticated
      if (!isAuthenticated) {
        setCheckingProfile(false);
        return;
      }

      // If already on Profile Setup page, allow immediate access without blocking
      if (location.pathname === "/profile-setup") {
        setCheckingProfile(false);
        return;
      }

      try {
        const response = await axios.get(
          `${API_URL}/profile/complete`,
          {
            withCredentials: true,
            headers: { "X-Mumbai-Panel": "customer" },
            timeout: 8000,
          }
        );

        setProfileComplete(response.data.complete === true);
      } catch (error) {
        if (error.response?.status === 401) {
          if (handleSessionExpired) {
            handleSessionExpired();
          }
          setProfileComplete(false);
        } else {
          setProfileComplete(false);
        }
      } finally {
        setCheckingProfile(false);
      }
    };

    checkProfile();
  }, [isAuthenticated, loading, isReconnecting, location.pathname, handleSessionExpired]);

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

  // Still checking profile completion
  if (checkingProfile) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#42D6E8]/20 border-t-[#42D6E8]" />
      </div>
    );
  }

  // Profile is incomplete
  // Allow the user to access Profile Setup itself
  if (
    !profileComplete &&
    location.pathname !== "/profile-setup"
  ) {
    return (
      <Navigate
        to="/profile-setup"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  return <Outlet />;
}

export default ProtectedRoute;
