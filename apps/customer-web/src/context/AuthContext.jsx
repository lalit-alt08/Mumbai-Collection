import { createContext, useContext, useEffect, useState } from "react";
import {
  getCurrentUser,
  logout as logoutApi,
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

        if (response?.success && response?.user) {
          console.log(" EXISTING SESSION RESTORED");

          setUser(response.user);

          localStorage.setItem(
            "user",
            JSON.stringify(response.user)
          );
        } else {
          setUser(null);
          localStorage.removeItem("user");
        }
      } catch (error) {
        console.log(" No active session.");

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

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        logout,
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