import { createContext, useContext, useEffect, useState } from "react";
import {
  getCurrentUser,
  loginEmployee,
  logoutEmployee,
} from "../services/authService";

const EmployeeAuthContext = createContext(null);

export const EmployeeAuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    try {
      const data = await getCurrentUser();

      if (data?.logged_in && data?.current_user_id) {
        setUser({
          id: data.current_user_id,
          roles: Array.isArray(data.roles) ? data.roles : (data.role ? [data.role] : []),
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
    const data = await loginEmployee(email, password);

    if (!data?.success) {
      throw new Error(data?.message || "Login failed.");
    }

    await checkAuth();

    return data;
  };

  const logout = async () => {
    try {
      await logoutEmployee();
    } finally {
      setUser(null);
    }
  };

  const isEmployee = user?.roles?.some((role) =>
    ["employee", "shop_manager", "administrator"].includes(role)
  );

  return (
    <EmployeeAuthContext.Provider
      value={{
        user,
        loading,
        isEmployee,
        login,
        logout,
        checkAuth,
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
