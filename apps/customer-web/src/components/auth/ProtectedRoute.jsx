import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useEffect, useState } from "react";
import axios from "axios";

function ProtectedRoute() {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  const [checkingProfile, setCheckingProfile] = useState(true);
  const [profileComplete, setProfileComplete] = useState(false);

  useEffect(() => {
    const checkProfile = async () => {
      // AuthContext is still checking the server session
      if (loading) {
        return;
      }

      // User is not authenticated
      if (!isAuthenticated) {
        setCheckingProfile(false);
        return;
      }

      try {
        const response = await axios.get(
          "http://localhost:5000/api/profile/complete",
          {
            withCredentials: true,
          }
        );

        setProfileComplete(response.data.complete === true);
      } catch (error) {
        console.error(
          "PROFILE COMPLETION CHECK ERROR:",
          error.response?.data || error.message
        );

        setProfileComplete(false);
      } finally {
        setCheckingProfile(false);
      }
    };

    checkProfile();
  }, [isAuthenticated, loading]);

  // AuthContext is still restoring/checking the login session
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  // User is not logged in
  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  // Still checking profile completion
  if (checkingProfile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-gray-500">Checking profile...</p>
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
        state={{ from: location.pathname }}
      />
    );
  }

  return <Outlet />;
}

export default ProtectedRoute;