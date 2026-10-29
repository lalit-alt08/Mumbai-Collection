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
import safeStorage from "../utils/safeStorage.js";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

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
          setUser(null);
          safeSessionStorage.removeItem("user");
          safeSessionStorage.removeItem("user_profile");
        }
      } catch (error) {
        setUser(null);
        safeSessionStorage.removeItem("user");
        safeSessionStorage.removeItem("user_profile");
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
      await logoutApi();
    } catch {
      // Ignore logout API error, proceed to clear local state
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
        setUser((prev) => ({ ...(prev || {}), ...userData }));
        const current = safeStorage.getJSON("user", {});
        safeStorage.setJSON("user", { ...current, ...userData });
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
        isAuthenticated: !!user,
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
