import { createContext, useContext, useEffect, useState } from "react";
import {
  getCurrentUser,
  logout as logoutApi,
} from "../services/authService";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check existing login session when application starts
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const response = await getCurrentUser();

        if (response?.success && response?.user) {
          setUser(response.user);
          localStorage.setItem("user", JSON.stringify(response.user));
        } else {
          setUser(null);
          localStorage.removeItem("user");
        }
      } catch (error) {
        console.log("No active session.");

        setUser(null);
        localStorage.removeItem("user");
      } finally {
        setLoading(false);
      }
    };

    restoreSession();
  }, []);

  const login = (userData) => {
    setUser(userData);
    localStorage.setItem("user", JSON.stringify(userData));
  };

  const logout = async () => {
    try {
      await logoutApi();
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      setUser(null);
      localStorage.removeItem("user");
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