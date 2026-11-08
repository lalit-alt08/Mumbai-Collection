import { createContext, useContext, useEffect, useState, useRef } from "react";
import {
  getCurrentUser,
  loginEmployee,
  logoutEmployee,
} from "../services/authService";
import { resetNotificationController } from "../utils/orderNotification.js";

const EmployeeAuthContext = createContext(null);

export const EmployeeAuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpiresAt, setSessionExpiresAt] = useState(null);
  const [expiryWarning, setExpiryWarning] = useState(null);
  const [logoutPending, setLogoutPending] = useState(null);
  const authSeqRef = useRef(0);
  const isAuthenticatingRef = useRef(false);

  const checkAuth = async ({ isWake = false } = {}) => {
    // Pause background phone wake checks while a login or renewal is actively in flight
    if (isWake && isAuthenticatingRef.current) {
      return;
    }

    const seq = ++authSeqRef.current;
    try {
      const data = await getCurrentUser();

      // Ignore session-check results started before the latest login or newer check
      if (seq !== authSeqRef.current) return;

      if (data?.logged_in && data?.current_user_id) {
        const roles = Array.isArray(data.roles) ? data.roles : (data.role ? [data.role] : []);
        const isAllowed = roles.some((role) =>
          ["employee", "administrator"].includes(role)
        );
        if (isAllowed) {
          setUser({
            id: data.current_user_id,
            email: data.user_email || data.user?.email || "",
            name: data.display_name || data.user?.name || "",
            roles,
          });
          if (data.expires_at) {
            setSessionExpiresAt(Number(data.expires_at));
          }
        } else {
          resetNotificationController();
          setUser(null);
          setSessionExpiresAt(null);
        }
      } else {
        resetNotificationController();
        setUser(null);
        setSessionExpiresAt(null);
      }
    } catch (err) {
      // Ignore errors for checks started before the latest login or newer check
      if (seq !== authSeqRef.current) return;

      const status = err.response?.status;
      const isExplicitSessionRejection = status === 401 || status === 403;

      // On background phone wake-up, do NOT clear session or silence order alarms
      // due to transient network lag, socket reconnects, or server 5xx hiccups
      if (isWake && !isExplicitSessionRejection) {
        return;
      }

      resetNotificationController();
      setUser(null);
      setSessionExpiresAt(null);
    } finally {
      if (seq === authSeqRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  // Monitor 12-hour session expiry and warn staff when nearing cutoff
  useEffect(() => {
    if (!sessionExpiresAt || !user) {
      setExpiryWarning(null);
      return;
    }

    const inspectExpiry = () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const remainingSec = sessionExpiresAt - nowSec;

      if (remainingSec <= 0) {
        resetNotificationController();
        setUser(null);
        setSessionExpiresAt(null);
        setExpiryWarning(null);
      } else if (remainingSec <= 15 * 60) {
        setExpiryWarning(Math.max(1, Math.ceil(remainingSec / 60)));
      } else {
        setExpiryWarning(null);
      }
    };

    inspectExpiry();
    const interval = setInterval(inspectExpiry, 20_000);

    const onWake = () => {
      if (document.visibilityState === "visible") {
        inspectExpiry();
        checkAuth({ isWake: true }); // Re-sync session authority with server on phone unlock/wake safely
      }
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("pageshow", onWake);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("pageshow", onWake);
    };
  }, [sessionExpiresAt, user]);

  const login = async (email, password) => {
    // Invalidate any existing in-flight checkAuth calls and pause wake triggers
    isAuthenticatingRef.current = true;
    if (typeof window !== "undefined") {
      window.__mumbaiAuthInProgress = true;
    }

    const seq = ++authSeqRef.current;
    try {
      const data = await loginEmployee(email, password);

      if (!data?.success) {
        throw new Error(data?.message || "Login failed.");
      }

      const loginUser = data?.user;
      const initialRoles = Array.isArray(loginUser?.roles)
        ? loginUser.roles
        : (loginUser?.role ? [loginUser.role] : []);
      const isInitiallyAllowed = initialRoles.some((role) =>
        ["employee", "administrator"].includes(role)
      );

      if (!loginUser?.id || !isInitiallyAllowed) {
        await logoutEmployee().catch(() => {});
        if (seq === authSeqRef.current) {
          resetNotificationController();
          setUser(null);
          setSessionExpiresAt(null);
        }
        throw new Error("This account does not have employee access permissions.");
      }

      // Authoritatively confirm the session against /auth/me before allowing navigation
      let meData;
      try {
        meData = await getCurrentUser();
      } catch (meErr) {
        const msg = meErr.response?.data?.message || meErr.message || "Session confirmation failed.";
        throw new Error(`Login succeeded but session could not be verified: ${msg}`);
      }

      if (!meData?.logged_in || !meData?.current_user_id) {
        throw new Error("Session could not be verified with the server after login.");
      }

      // Identity check: verified /auth/me session MUST match the account returned by login
      if (Number(meData.current_user_id) !== Number(loginUser.id)) {
        await logoutEmployee().catch(() => {});
        if (seq === authSeqRef.current) {
          resetNotificationController();
          setUser(null);
          setSessionExpiresAt(null);
        }
        throw new Error("Session identity mismatch: verified session does not match the signed-in account.");
      }

      const meRoles = Array.isArray(meData.roles) ? meData.roles : (meData.role ? [meData.role] : []);
      const isAllowed = meRoles.some((role) =>
        ["employee", "administrator"].includes(role)
      );

      if (!isAllowed) {
        await logoutEmployee().catch(() => {});
        if (seq === authSeqRef.current) {
          resetNotificationController();
          setUser(null);
          setSessionExpiresAt(null);
        }
        throw new Error("This account does not have employee access permissions.");
      }

      // If superseded by a newer login attempt while waiting, return an explicit cancelled result
      if (seq !== authSeqRef.current) {
        return { success: false, superseded: true, cancelled: true };
      }

      if (typeof window !== "undefined") {
        window.__mumbaiLogoutPending = false;
      }
      setLogoutPending(null);

      setUser({
        id: meData.current_user_id,
        email: meData.user_email || meData.user?.email || loginUser?.email || email,
        name: meData.display_name || meData.name || loginUser?.name || "",
        roles: meRoles,
      });

      const expiresAt = meData.expires_at || data.expires_at;
      if (expiresAt) {
        setSessionExpiresAt(Number(expiresAt));
      }

      return { ...data, success: true, confirmed: true };
    } finally {
      isAuthenticatingRef.current = false;
      if (typeof window !== "undefined") {
        window.__mumbaiAuthInProgress = false;
      }
    }
  };

  const logout = async (options = {}) => {
    const isForce = options?.force === true;
    try {
      try {
        const { unsubscribeDevicePush } = await import("../utils/pushSubscription.js");
        await unsubscribeDevicePush();
      } catch (_) {}

      const res = await logoutEmployee(options);

      // If server revocation failed and !isForce, enter logoutPending state
      if (!isForce && res?.success === false && res?.code === "LOGOUT_REVOCATION_FAILED") {
        if (typeof window !== "undefined") {
          window.__mumbaiLogoutPending = true;
        }
        setLogoutPending({
          message: res.message || "Server session revocation could not be confirmed.",
          code: res.code || "LOGOUT_REVOCATION_FAILED",
        });
        return { success: false, pending: true };
      }

      if (typeof window !== "undefined") {
        window.__mumbaiLogoutPending = false;
      }
      setLogoutPending(null);
      resetNotificationController();
      setUser(null);
      setSessionExpiresAt(null);
      setExpiryWarning(null);
      return { success: true };
    } catch (err) {
      if (!isForce && err.response?.data?.code === "LOGOUT_REVOCATION_FAILED") {
        if (typeof window !== "undefined") {
          window.__mumbaiLogoutPending = true;
        }
        setLogoutPending({
          message: err.response.data.message || "Server session revocation could not be confirmed.",
          code: "LOGOUT_REVOCATION_FAILED",
        });
        return { success: false, pending: true };
      }

      if (isForce) {
        if (typeof window !== "undefined") {
          window.__mumbaiLogoutPending = false;
        }
        setLogoutPending(null);
        resetNotificationController();
        setUser(null);
        setSessionExpiresAt(null);
        setExpiryWarning(null);
        return { success: true, forced: true };
      }

      throw err;
    }
  };

  const isEmployee = user?.roles?.some((role) =>
    ["employee", "administrator"].includes(role)
  );

  return (
    <EmployeeAuthContext.Provider
      value={{
        user,
        loading,
        isEmployee,
        login,
        logout,
        logoutPending,
        setLogoutPending,
        checkAuth,
        expiryWarning,
        sessionExpiresAt,
      }}
    >
      {children}
    </EmployeeAuthContext.Provider>
  );
};

export const useEmployeeAuth = () => {
  const context = useContext(EmployeeAuthContext);

  if (!context) {
    throw new Error(
      "useEmployeeAuth must be used inside EmployeeAuthProvider"
    );
  }

  return context;
};
