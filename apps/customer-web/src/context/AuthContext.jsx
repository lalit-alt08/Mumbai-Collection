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

        if ((response?.success && response?.user) || (response?.logged_in && response?.current_user_id)) {
          const cachedUser = JSON.parse(localStorage.getItem("user") || "{}");
          const userData = response.user || {
            id: response.current_user_id,
            roles: response.roles || [],
          };

          // Recover email, name, and username from cache if missing from restored session data
          if (!userData.email && cachedUser.email) {
            userData.email = cachedUser.email;
          }
          if (!userData.name && cachedUser.name) {
            userData.name = cachedUser.name;
          }
          if (!userData.username && cachedUser.username) {
            userData.username = cachedUser.username;
          }

          setUser(userData);

          localStorage.setItem(
            "user",
            JSON.stringify(userData)
          );
        } else {
          setUser(null);
          localStorage.removeItem("user");
        }
      } catch (error) {
        setUser(null);
        localStorage.removeItem("user");
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
    setUser(userData);

    localStorage.setItem(
      "user",
      JSON.stringify(userData)
    );
  };

  // ==========================================
  // LOGOUT
  // ==========================================

  const logout = async () => {
    try {
      // Call Node → WordPress logout
      await logoutApi();
    } catch (error) {
      console.error(
        "LOGOUT API ERROR:",
        error.response?.data || error.message
      );
    } finally {
      // Always clear frontend authentication & cart state
      setUser(null);
      localStorage.removeItem("user");
      clearCartSession();
    }
  };

  // ==========================================
  // DELETE ACCOUNT
  // ==========================================

  const deleteAccount = async () => {
    try {
      await deleteAccountApi();
    } finally {
      setUser(null);
      localStorage.removeItem("user");
      clearCartSession();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        logout,
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