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

import { clearCartSession } from "../services/storeApi";
import safeStorage, { safeSessionStorage } from "../utils/safeStorage.js";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isReconnecting, setIsReconnecting] = useState(false);

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
          const cachedUser = safeSessionStorage.getJSON("user", {});
          const cachedProfile = safeSessionStorage.getJSON("user_profile", {});

          const userData = response.user || {
            id: response.current_user_id,
            roles: response.roles || [],
          };

          const isStoreName = (str) => {
            if (!str || typeof str !== "string") return true;
            const s = str.trim().toLowerCase();
            return s === "mumbaicollection" || s === "mumbai collection" || s === "mumbai_collection";
          };

          if (isStoreName(userData.name)) userData.name = "";
          if (isStoreName(userData.username)) userData.username = "";

          // Recover full_name, name, phone, email from profile or cache
          if (!isStoreName(cachedProfile.full_name)) {
            userData.name = cachedProfile.full_name;
            userData.full_name = cachedProfile.full_name;
          } else if (!isStoreName(cachedUser.full_name)) {
            userData.name = cachedUser.full_name;
            userData.full_name = cachedUser.full_name;
          } else if (!isStoreName(cachedUser.name)) {
            userData.name = cachedUser.name;
          }

          if (response.user?.phone || response.phone) {
            userData.phone = response.user?.phone || response.phone;
          } else if (cachedProfile.phone) {
            userData.phone = cachedProfile.phone;
          } else if (cachedUser.phone) {
            userData.phone = cachedUser.phone;
          }

          if (!userData.email && cachedUser.email) {
            userData.email = cachedUser.email;
          }

          if (!userData.username && !isStoreName(cachedUser.username)) {
            userData.username = cachedUser.username;
          }

          userData.is_phone_verified =
            response.user?.is_phone_verified === true ||
            response.is_phone_verified === true;

          userData.verified_phone =
            response.user?.verified_phone ||
            response.verified_phone ||
            "";

          setUser(userData);

          // Store only minimal display fields in sessionStorage (cleared on browser close)
          safeSessionStorage.setJSON("user", {
            id: userData.id,
            name: userData.name || "",
            roles: userData.roles || [],
          });
        } else {
          setIsReconnecting(false);
          setUser(null);
          safeSessionStorage.removeItem("user");
          safeSessionStorage.removeItem("user_profile");
        }
      } catch (error) {
        if (error.response?.status === 401) {
          setIsReconnecting(false);
          setUser(null);
          safeSessionStorage.removeItem("user");
          safeSessionStorage.removeItem("user_profile");
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
    setIsReconnecting(false);
    // Purge any leftover cart tokens from prior session/guest to prevent cross-account leakage
    clearCartSession();
    safeStorage.removeItem("user");
    safeStorage.removeItem("user_profile");
    setUser(userData);
    safeSessionStorage.setJSON("user", {
      id: userData?.id,
      name: userData?.name || "",
      roles: userData?.roles || [],
    });
  };

  // ==========================================
  // UPDATE USER
  // ==========================================

  const updateUser = (newData) => {
    setUser((prev) => {
      const updated = { ...(prev || {}), ...newData };
      safeSessionStorage.setJSON("user", {
        id: updated.id,
        name: updated.name || "",
        roles: updated.roles || [],
      });
      return updated;
    });
  };

  // ==========================================
  // HANDLE EXPIRED SESSION (401)
  // ==========================================

  const handleSessionExpired = () => {
    setIsReconnecting(false);
    setUser(null);
    safeSessionStorage.removeItem("user");
    safeSessionStorage.removeItem("user_profile");
    safeStorage.removeItem("user");
    safeStorage.removeItem("user_profile");
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
        setUser((prev) => ({ ...(prev || {}), ...userData, isUnverified: false }));
        safeSessionStorage.setJSON("user", {
          id: userData.id || response.current_user_id,
          name: userData.name || "",
          roles: userData.roles || [],
        });
        return userData;
      } else {
        handleSessionExpired();
      }
    } catch (error) {
      if (error.response?.status === 401) {
        handleSessionExpired();
      }
    }
    return null;
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
