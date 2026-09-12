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
        const roles = Array.isArray(data.roles) ? data.roles : (data.role ? [data.role] : []);
        const isAllowed = roles.some((role) =>
          ["employee", "administrator"].includes(role)
        );
        if (isAllowed) {
          setUser({
            id: data.current_user_id,
            roles,
          });
        } else {
          setUser(null);
        }
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

    const meData = await getCurrentUser();
    const roles = Array.isArray(meData?.roles) ? meData.roles : (meData?.role ? [meData.role] : []);
    const isAllowed = roles.some((role) =>
      ["employee", "administrator"].includes(role)
    );

    if (!meData?.logged_in || !isAllowed) {
      await logoutEmployee().catch(() => {});
      setUser(null);
      throw new Error("This account does not have employee access permissions.");
    }

    setUser({
      id: meData.current_user_id,
      roles,
    });

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
