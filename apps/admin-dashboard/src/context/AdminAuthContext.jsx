import { createContext, useContext, useEffect, useState, useRef } from "react";
import {
  getCurrentUser,
  loginAdmin,
  logoutAdmin,
} from "../services/authService";

const AdminAuthContext = createContext(null);

export const AdminAuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [logoutPending, setLogoutPending] = useState(null);
  const authSeqRef = useRef(0);

  const checkAuth = async () => {
    const seq = ++authSeqRef.current;
    try {
      const data = await getCurrentUser({ optional: true });
      if (seq !== authSeqRef.current) return;

      if (data?.logged_in && data?.current_user_id) {
        setUser({
          id: data.current_user_id,
          roles: Array.isArray(data.roles) ? data.roles : (data.role ? [data.role] : []),
        });
      } else {
        setUser(null);
      }
    } catch {
      if (seq !== authSeqRef.current) return;
      setUser(null);
    } finally {
      if (seq === authSeqRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const login = async (email, password) => {
    const seq = ++authSeqRef.current;
    const data = await loginAdmin(email, password);

    if (!data?.success) {
      throw new Error(data?.message || "Login failed.");
    }

    if (seq !== authSeqRef.current) {
      return { success: false, superseded: true };
    }

    setLogoutPending(null);
    await checkAuth();

    return data;
  };

  const logout = async (options = {}) => {
    const isForce = options?.force === true;
    authSeqRef.current += 1;
    try {
      const res = await logoutAdmin(options);

      if (
        !isForce &&
        (res?.success === false ||
          res?.server_revocation_confirmed === false ||
          res?.code === "LOGOUT_REVOCATION_FAILED")
      ) {
        const message =
          res?.message ||
          "WordPress could not confirm destruction of this device's session token. You can retry revoking it on the server, or sign out on this device.";
        setLogoutPending({
          message,
          code: res?.code || "LOGOUT_REVOCATION_FAILED",
        });
        return { success: false, pending: true, message };
      }

      setLogoutPending(null);
      setUser(null);
      return {
        ...res,
        success: true,
        forced: isForce,
      };
    } catch (err) {
      if (!isForce) {
        const message =
          err?.response?.data?.message ||
          "WordPress could not confirm destruction of this device's session token. You can retry revoking it on the server, or sign out on this device.";
        setLogoutPending({
          message,
          code: err?.response?.data?.code || "LOGOUT_REVOCATION_FAILED",
        });
        return { success: false, pending: true, message };
      }

      setLogoutPending(null);
      setUser(null);
      return { success: true, forced: true };
    }
  };

  const isAdmin = user?.roles?.includes("administrator");

  return (
    <AdminAuthContext.Provider
      value={{
        user,
        loading,
        isAdmin,
        login,
        logout,
        logoutPending,
        setLogoutPending,
        checkAuth,
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
};

export const useAdminAuth = () => {
  const context = useContext(AdminAuthContext);

  if (!context) {
    throw new Error(
      "useAdminAuth must be used inside AdminAuthProvider"
    );
  }

  return context;
};