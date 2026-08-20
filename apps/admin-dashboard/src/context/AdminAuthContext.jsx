import { createContext, useContext, useEffect, useState } from "react";
import {
  getCurrentUser,
  loginAdmin,
  logoutAdmin,
} from "../services/authService";

const AdminAuthContext = createContext(null);

export const AdminAuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    try {
      const data = await getCurrentUser();

      if (data?.logged_in && data?.current_user_id) {
        setUser({
          id: data.current_user_id,
          roles: data.role || [],
        });
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const login = async (email, password) => {
    const data = await loginAdmin(email, password);

    if (!data?.success) {
      throw new Error(data?.message || "Login failed.");
    }

    await checkAuth();

    return data;
  };

  const logout = async () => {
    try {
      await logoutAdmin();
    } finally {
      setUser(null);
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