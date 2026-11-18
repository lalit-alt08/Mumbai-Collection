import {
  createContext,
  useState,
  useEffect,
  useContext,
  useRef,
} from "react";

import {
  getCurrentUser,
  logout as logoutApi,
  deleteAccount as deleteAccountApi,
} from "../services/authService";

import { clearCartSession, invalidateCartRequests } from "../services/storeApi";
import safeStorage, { safeSessionStorage } from "../utils/safeStorage.js";

const AuthContext = createContext();
const hasExplicitLogout = () =>
  safeStorage.getItem("mc_explicit_logout") === "true" ||
  safeSessionStorage.getItem("mc_explicit_logout") === "true";

const persistUserCache = (userData) => {
  if (!userData?.id) {
    safeSessionStorage.removeItem("user");
    return;
  }
  safeSessionStorage.setJSON("user", {
    id: userData.id,
    name: userData.name || "",
    full_name: userData.full_name || userData.name || "",
    email: userData.email || "",
    phone: userData.phone || "",
    roles: Array.isArray(userData.roles) ? userData.roles : [],
    is_google_user: userData.is_google_user === true,
    ...(userData.has_usable_password !== undefined
      ? { has_usable_password: userData.has_usable_password === true }
      : {}),
  });
};

export const clearAllProfileCaches = (userId) => {
  safeSessionStorage.removeItem("user_profile");
  safeStorage.removeItem("user_profile");
  if (userId) {
    safeSessionStorage.removeItem(`user_profile_${userId}`);
    safeStorage.removeItem(`user_profile_${userId}`);
  }
  safeSessionStorage.removeByPrefix("user_profile");
  safeStorage.removeByPrefix("user_profile");
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [logoutPending, setLogoutPending] = useState(null);
  const authEpochRef = useRef(1);
  const userRef = useRef(null);
  userRef.current = user;
  const [checkoutExpiredUserId, setCheckoutExpiredUserId] = useState(() => safeSessionStorage.getItem("checkout_expired_user_id"));
  const clearCheckoutRecovery = () => {
    safeSessionStorage.removeItem("checkout_expired_user_id");
    setCheckoutExpiredUserId(null);
  };

  // ==========================================
  // RESTORE EXISTING LOGIN SESSION
  // ==========================================

  useEffect(() => {
    const restoreSession = async () => {
      if (safeSessionStorage.getItem("mc_explicit_logout") === "true" || safeStorage.getItem("mc_explicit_logout") === "true") {
        setIsReconnecting(false);
        setUser(null);
        setLoading(false);
        return;
      }

      const epoch = authEpochRef.current;
      try {
        const response = await getCurrentUser();
        if (epoch !== authEpochRef.current) return;

        // Purge legacy persistent storage to prevent PII retention on disk (Finding #12 fix)
        safeStorage.removeItem("user");
        safeStorage.removeItem("user_profile");

        if ((response?.success && response?.user) || (response?.logged_in && response?.current_user_id)) {
          setIsReconnecting(false);
          const currentUserId = response.user?.id || response.current_user_id;
          const cachedUser = safeSessionStorage.getJSON("user", {});
          const isCachedUserValid = Number(cachedUser?.id) === Number(currentUserId);
          const cachedProfile = currentUserId
            ? safeSessionStorage.getJSON(`user_profile_${currentUserId}`, {})
            : {};

          const userData = response.user || {
            id: currentUserId,
            roles: response.roles || [],
          };

          const isStoreName = (str) => {
            if (!str || typeof str !== "string") return true;
            const s = str.trim().toLowerCase();
            return s === "mumbaicollection" || s === "mumbai collection" || s === "mumbai_collection";
          };

          if (isStoreName(userData.name)) userData.name = "";
          if (isStoreName(userData.username)) userData.username = "";

          // Recover full_name, name, phone, email from profile or cache (only if cached user matches)
          if (!isStoreName(cachedProfile.full_name)) {
            userData.name = cachedProfile.full_name;
            userData.full_name = cachedProfile.full_name;
          } else if (isCachedUserValid && !isStoreName(cachedUser.full_name)) {
            userData.name = cachedUser.full_name;
            userData.full_name = cachedUser.full_name;
          } else if (isCachedUserValid && !isStoreName(cachedUser.name)) {
            userData.name = cachedUser.name;
          }

          if (response.user?.phone || response.phone) {
            userData.phone = response.user?.phone || response.phone;
          } else if (cachedProfile.phone) {
            userData.phone = cachedProfile.phone;
          } else if (isCachedUserValid && cachedUser.phone) {
            userData.phone = cachedUser.phone;
          }

          if (!userData.email && isCachedUserValid && cachedUser.email) {
            userData.email = cachedUser.email;
          }

          if (!userData.username && isCachedUserValid && !isStoreName(cachedUser.username)) {
            userData.username = cachedUser.username;
          }

          userData.is_phone_verified =
            response.user?.is_phone_verified === true ||
            response.is_phone_verified === true;

          userData.verified_phone =
            response.user?.verified_phone ||
            response.verified_phone ||
            "";

          // Prefer explicit server booleans; fall back to cache only when field is omitted and cache matches
          if (response.user?.is_google_user !== undefined) {
            userData.is_google_user = response.user.is_google_user === true;
          } else if (response.is_google_user !== undefined) {
            userData.is_google_user = response.is_google_user === true;
          } else if (isCachedUserValid && cachedUser?.is_google_user !== undefined) {
            userData.is_google_user = cachedUser.is_google_user === true;
          } else {
            userData.is_google_user = false;
          }

          if (response.user?.has_usable_password !== undefined) {
            userData.has_usable_password = response.user.has_usable_password === true;
          } else if (response.has_usable_password !== undefined) {
            userData.has_usable_password = response.has_usable_password === true;
          } else if (isCachedUserValid && cachedUser?.has_usable_password !== undefined) {
            userData.has_usable_password = cachedUser.has_usable_password === true;
          }

          setUser(userData);
          persistUserCache(userData);
        } else {
          setIsReconnecting(false);
          setUser(null);
          safeSessionStorage.removeItem("user");
          clearAllProfileCaches();
        }
      } catch (error) {
        if (epoch !== authEpochRef.current) return;
        if (error.response?.status === 401) {
          setIsReconnecting(false);
          setUser(null);
          safeSessionStorage.removeItem("user");
          clearAllProfileCaches();
        } else {
          // Outage / 503 / temporary network failure:
          // Maintain reconnecting state and flag cached display data as unverified
          setIsReconnecting(true);
          const cached = safeSessionStorage.getJSON("user", null);
          if (cached) {
            setUser({ ...cached, isUnverified: true });
          } else {
            setUser(null);
          }
        }
      } finally {
        if (epoch === authEpochRef.current) {
          setLoading(false);
        }
      }
    };

    restoreSession();
  }, []);

  // ==========================================
  // LOGIN
  // ==========================================

  const login = (userData) => {
    authEpochRef.current += 1;
    safeSessionStorage.removeItem("mc_explicit_logout");
    safeStorage.removeItem("mc_explicit_logout");
    invalidateCartRequests();
    setIsReconnecting(false);
    setLogoutPending(null);
    // Address and user caches are purged on login to prevent cross-account leakage;
    // Cart session token is preserved so CartContext can perform safe guest-to-customer cart merge
    clearAllProfileCaches(user?.id);
    safeStorage.removeItem("user");
    safeStorage.removeItem("saved_addresses_cache");
    safeStorage.removeItem("selected_address_id");
    safeSessionStorage.removeItem("saved_addresses_cache");
    safeSessionStorage.removeItem("selected_address_id");
    setUser(userData);
    persistUserCache(userData);
    safeStorage.setItem(
      "mc_auth_session_change",
      JSON.stringify({ userId: userData?.id || null, ts: Date.now() })
    );
  };

  // ==========================================
  // UPDATE USER
  // ==========================================

  const updateUser = (newData) => {
    setUser((prev) => {
      const updated = { ...(prev || {}), ...newData };
      persistUserCache(updated);
      return updated;
    });
  };

  // ==========================================
  // HANDLE EXPIRED SESSION (401)
  // ==========================================

  const handleSessionExpired = (options = {}) => {
    authEpochRef.current += 1;
    const outgoingId = userRef.current?.id;
    if (options.checkout && outgoingId) {
      safeSessionStorage.setItem("checkout_expired_user_id", String(outgoingId));
      setCheckoutExpiredUserId(String(outgoingId));
    } else {
      safeSessionStorage.removeItem("checkout_expired_user_id");
      setCheckoutExpiredUserId(null);
    }
    setIsReconnecting(false);
    setLogoutPending(null);
    setUser(null);
    safeSessionStorage.removeItem("user");
    safeStorage.removeItem("user");
    clearAllProfileCaches(outgoingId);
    safeStorage.removeItem("saved_addresses_cache");
    safeStorage.removeItem("selected_address_id");
    safeSessionStorage.removeItem("saved_addresses_cache");
    safeSessionStorage.removeItem("selected_address_id");
    clearCartSession();
  };

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === "mc_explicit_logout" && event.newValue === "true") {
        handleSessionExpired();
      } else if (event.key === "mc_auth_session_change" && event.newValue) {
        authEpochRef.current += 1;
        setUser((prev) => (prev ? { ...prev, isUnverified: true } : prev));
        try {
          const change = JSON.parse(event.newValue);
          if (change.userId && safeStorage.getItem("mc_explicit_logout") !== "true") {
            safeSessionStorage.removeItem("mc_explicit_logout");
          }
        } catch {
          // Ignore malformed notifications.
        }
        if (!hasExplicitLogout()) void refreshUser();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ==========================================
  // LOGOUT
  // ==========================================

  const logout = async (options = {}) => {
    const isForce = options?.force === true;
    authEpochRef.current += 1;
    try {
      // Call Node → WordPress logout
      const res = await logoutApi(options);
      if (
        !isForce &&
        (res?.success === false ||
          res?.server_revocation_confirmed === false ||
          res?.code === "LOGOUT_REVOCATION_FAILED")
      ) {
        const message =
          res?.message ||
          "Could not confirm sign-out with the server. Your session may still be active until you retry or sign out on this device.";
        setLogoutPending({
          message,
          code: res?.code || "LOGOUT_REVOCATION_FAILED",
        });
        return {
          success: false,
          pending: true,
          server_revocation_confirmed: false,
          message,
        };
      }

      safeSessionStorage.setItem("mc_explicit_logout", "true");
      safeStorage.setItem("mc_explicit_logout", "true");
      setLogoutPending(null);
      handleSessionExpired();
      return {
        ...res,
        success: true,
        server_revocation_confirmed: Boolean(res?.server_revocation_confirmed),
        forced: isForce,
      };
    } catch (err) {
      if (!isForce) {
        const message =
          err?.response?.data?.message ||
          "Could not confirm sign-out with the server. You can retry revoking your session or sign out on this device.";
        setLogoutPending({
          message,
          code: err?.response?.data?.code || "LOGOUT_REVOCATION_FAILED",
        });
        return {
          success: false,
          pending: true,
          server_revocation_confirmed: false,
          message,
        };
      }

      safeSessionStorage.setItem("mc_explicit_logout", "true");
      safeStorage.setItem("mc_explicit_logout", "true");
      setLogoutPending(null);
      handleSessionExpired();
      return {
        success: true,
        server_revocation_confirmed: false,
        forced: true,
      };
    }
  };

  // ==========================================
  // DELETE ACCOUNT
  // ==========================================

  const deleteAccount = async (password) => {
    authEpochRef.current += 1;
    try {
      await deleteAccountApi(password);
      safeSessionStorage.setItem("mc_explicit_logout", "true");
      safeStorage.setItem("mc_explicit_logout", "true");
      handleSessionExpired();
    } catch (error) {
      throw error;
    }
  };

  // ==========================================
  // REFRESH CURRENT USER SESSION FROM SERVER
  // ==========================================

  const refreshUser = async () => {
    if (hasExplicitLogout()) return { ok: false, reason: "logged_out" };
    const epoch = authEpochRef.current;
    try {
      const response = await getCurrentUser();
      if (epoch !== authEpochRef.current || hasExplicitLogout()) {
        return { ok: false, reason: "superseded" };
      }
      if ((response?.success && response?.user) || (response?.logged_in && response?.current_user_id)) {
        setIsReconnecting(false);
        const userData = response.user || {
          id: response.current_user_id,
          roles: response.roles || [],
        };
        userData.is_phone_verified =
          response.user?.is_phone_verified === true ||
          response.is_phone_verified === true;
        userData.verified_phone =
          response.user?.verified_phone ||
          response.verified_phone ||
          "";
        if (response.user?.phone || response.phone) {
          userData.phone = response.user?.phone || response.phone;
        }

        // Prefer explicit server booleans
        if (response.user?.is_google_user !== undefined) {
          userData.is_google_user = response.user.is_google_user === true;
        } else if (response.is_google_user !== undefined) {
          userData.is_google_user = response.is_google_user === true;
        }
        if (response.user?.has_usable_password !== undefined) {
          userData.has_usable_password = response.user.has_usable_password === true;
        } else if (response.has_usable_password !== undefined) {
          userData.has_usable_password = response.has_usable_password === true;
        }

        if (epoch !== authEpochRef.current || hasExplicitLogout()) {
          return { ok: false, reason: "superseded" };
        }

        const prevId = userRef.current?.id;
        const isAccountSwitch = prevId && String(prevId) !== String(userData.id);
        if (isAccountSwitch) {
          clearAllProfileCaches(prevId);
          safeStorage.removeItem("saved_addresses_cache");
          safeStorage.removeItem("selected_address_id");
          safeSessionStorage.removeItem("saved_addresses_cache");
          safeSessionStorage.removeItem("selected_address_id");
          invalidateCartRequests();
        }

        setUser((prev) => {
          const sameUser = prev?.id && String(prev.id) === String(userData.id);
          const nextUser = sameUser
            ? { ...prev, ...userData, isUnverified: false }
            : { ...userData, isUnverified: false };
          persistUserCache(nextUser);
          return nextUser;
        });
        return { ok: true, user: userData };
      } else {
        if (epoch !== authEpochRef.current) {
          return { ok: false, reason: "superseded" };
        }
        handleSessionExpired();
        return {
          ok: false,
          reason: "unauthorized",
          status: 401,
        };
      }
    } catch (error) {
      if (epoch !== authEpochRef.current) {
        return { ok: false, reason: "superseded" };
      }
      if (error.response?.status === 401) {
        handleSessionExpired();
        return {
          ok: false,
          reason: "unauthorized",
          status: 401,
        };
      }
      return {
        ok: false,
        reason: "unavailable",
        status: error.response?.status || 0,
      };
    }
  };

  const reconcileSupersededAuth = async () => {
    if (hasExplicitLogout()) {
      try {
        await logoutApi({ force: true });
      } catch {
        // Best-effort revocation of late-arriving cookie after explicit logout.
      }
      handleSessionExpired();
      return { ok: false, reason: "logged_out_reconciled" };
    }
    safeStorage.setItem("mc_auth_session_change", JSON.stringify({
      reason: "superseded_response",
      nonce: `${Date.now()}-${Math.random()}`,
    }));
    return refreshUser();
  };

  useEffect(() => {
    if (!isReconnecting) return;
    let cancelled = false;
    let inFlight = false;
    const retry = async () => {
      if (cancelled || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try { await refreshUser(); } finally { inFlight = false; }
    };
    const timer = setInterval(retry, 10000);
    const onVisible = () => { if (document.visibilityState === "visible") void retry(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [isReconnecting]);

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        updateUser,
        refreshUser,
        reconcileSupersededAuth,
        logout,
        logoutPending,
        setLogoutPending,
        handleSessionExpired,
        deleteAccount,
        isAuthenticated: !!user && !isReconnecting && !user?.isUnverified,
        isReconnecting,
        getAuthEpoch: () => authEpochRef.current,
        checkoutExpiredUserId,
        clearCheckoutRecovery,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
