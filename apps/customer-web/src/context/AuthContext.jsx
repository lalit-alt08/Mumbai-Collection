import {
  createContext,
  useState,
  useEffect,
  useContext,
} from "react";

import {
  getCurrentUser,
  logout as logoutApi,
  deleteAccount as deleteAccountApi,
} from "../services/authService";

import { clearCartSession, invalidateCartRequests } from "../services/storeApi";
import safeStorage, { safeSessionStorage } from "../utils/safeStorage.js";

const AuthContext = createContext();

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
      try {
        const response = await getCurrentUser();

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

          setUser(userData);
          persistUserCache(userData);
        } else {
          setIsReconnecting(false);
          setUser(null);
          safeSessionStorage.removeItem("user");
          clearAllProfileCaches();
        }
      } catch (error) {
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
        setLoading(false);
      }
    };

    restoreSession();
  }, []);

  // ==========================================
  // LOGIN
  // ==========================================

  const login = (userData) => {
    invalidateCartRequests();
    setIsReconnecting(false);
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
    const outgoingId = user?.id;
    if (options.checkout && outgoingId) {
      safeSessionStorage.setItem("checkout_expired_user_id", String(outgoingId));
      setCheckoutExpiredUserId(String(outgoingId));
    } else {
      safeSessionStorage.removeItem("checkout_expired_user_id");
      setCheckoutExpiredUserId(null);
    }
    setIsReconnecting(false);
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

  // ==========================================
  // LOGOUT
  // ==========================================

  const logout = async () => {
    try {
      // Call Node → WordPress logout
      return await logoutApi();
    } catch {
      return { server_revocation_confirmed: false };
    } finally {
      // Always clear frontend authentication & cart state
      handleSessionExpired();
    }
  };

  // ==========================================
  // DELETE ACCOUNT
  // ==========================================

  const deleteAccount = async (password) => {
    try {
      await deleteAccountApi(password);
      handleSessionExpired();
    } catch (error) {
      throw error;
    }
  };

  // ==========================================
  // REFRESH CURRENT USER SESSION FROM SERVER
  // ==========================================

  const refreshUser = async () => {
    try {
      const response = await getCurrentUser();
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

        setUser((prev) => ({ ...(prev || {}), ...userData, isUnverified: false }));
        persistUserCache({ ...(user || {}), ...userData });
        return { ok: true, user: userData };
      } else {
        handleSessionExpired();
        return {
          ok: false,
          reason: "unauthorized",
          status: 401,
        };
      }
    } catch (error) {
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
        logout,
        handleSessionExpired,
        deleteAccount,
        isAuthenticated: !!user && !isReconnecting && !user?.isUnverified,
        isReconnecting,
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
