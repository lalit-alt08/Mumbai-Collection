import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import API_URL from "../../config/api.js";
import { useEffect, useState, useRef } from "react";
import axios from "axios";
import { AlertCircle, RefreshCw } from "lucide-react";

function ProtectedRoute() {
  const { isAuthenticated, isReconnecting, loading, handleSessionExpired } = useAuth();
  const location = useLocation();

  // Explicit state model: "checking" | "complete" | "incomplete" | "unavailable"
  const [profileStatus, setProfileStatus] = useState("checking");
  const [retryCount, setRetryCount] = useState(0);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let isMounted = true;
    const currentRequestId = ++requestIdRef.current;

    // AuthContext is still checking the server session or reconnecting
    if (loading || isReconnecting) {
      return;
    }

    // User is not authenticated
    if (!isAuthenticated) {
      return;
    }

    // If already on Profile Setup page, allow immediate access without blocking
    if (location.pathname === "/profile-setup") {
      return;
    }

    // If already verified complete, keep complete status
    if (profileStatus === "complete") {
      return;
    }

    const checkProfile = async () => {
      setProfileStatus("checking");

      try {
        const response = await axios.get(
          `${API_URL}/profile/complete`,
          {
            withCredentials: true,
            headers: { "X-Mumbai-Panel": "customer" },
            timeout: 8000,
          }
        );

        if (!isMounted || requestIdRef.current !== currentRequestId) return;

        if (response.data && response.data.complete === true) {
          setProfileStatus("complete");
        } else {
          setProfileStatus("incomplete");
        }
      } catch (error) {
        if (!isMounted || requestIdRef.current !== currentRequestId) return;

        if (error.response?.status === 401) {
          if (handleSessionExpired) {
            handleSessionExpired();
          }
          return;
        }

        // On timeout, network failure, 429, 502, 503: mark unavailable
        setProfileStatus("unavailable");
      }
    };

    checkProfile();

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, loading, isReconnecting, location.pathname, handleSessionExpired, retryCount]);

  const handleRetry = () => {
    setProfileStatus("checking");
    setRetryCount((c) => c + 1);
  };

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

  // If on Profile Setup itself, always grant direct access without running the completeness gate
  if (location.pathname === "/profile-setup") {
    return <Outlet />;
  }

  // Completeness check returned unavailable (outage, network failure, 502, 503)
  if (profileStatus === "unavailable") {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center p-6 text-center">
        <div className="rounded-2xl border border-[#1E3252] bg-[#111F36] p-6 max-w-sm w-full space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 mx-auto border border-amber-500/20">
            <AlertCircle size={24} />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-[#F1F5F9]">Connection Unavailable</h3>
            <p className="text-xs font-medium text-[#8FA4BE] mt-1">
              We are momentarily having trouble confirming your account status. Please try again.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#42D6E8] px-4 text-xs font-bold text-[#061220] transition hover:bg-[#2CC4D8] active:scale-98 cursor-pointer"
          >
            <RefreshCw size={14} />
            <span>Retry Connection</span>
          </button>
        </div>
      </div>
    );
  }

  // Completeness confirmed as incomplete by the backend: redirect to Profile Setup
  if (profileStatus === "incomplete") {
    return (
      <Navigate
        to="/profile-setup"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  // Completeness is still being checked
  if (profileStatus === "checking") {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#42D6E8]/20 border-t-[#42D6E8]" />
      </div>
    );
  }

  // Profile status is "complete"
  return <Outlet />;
}

export default ProtectedRoute;
