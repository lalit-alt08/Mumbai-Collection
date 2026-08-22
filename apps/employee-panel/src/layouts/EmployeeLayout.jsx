import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Boxes,
  Truck,
  Store,
  Menu,
  X,
  CircleDot,
  LogOut,
  UserCheck,
} from "lucide-react";

import { useEmployeeAuth } from "../context/EmployeeAuthContext.jsx";

function EmployeeLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const { logout, user } = useEmployeeAuth();

  const navigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Products & Stock", href: "/products", icon: Boxes },
    { name: "Orders & Dispatch", href: "/orders", icon: Truck },
  ];

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const getPageTitle = () => {
    if (location.pathname === "/") return "Operational Dashboard";
    if (location.pathname.startsWith("/products")) return "Product Inventory";
    if (location.pathname.startsWith("/orders")) return "Orders & Dispatch Pipeline";
    return "Employee Panel";
  };

  return (
    <div className="flex min-h-screen bg-[#F8F9FA] text-[#1E1E1E]">
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-[#0F172A] text-white transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand Header */}
        <div className="flex h-18 items-center justify-between px-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-500 shadow-[0_4px_16px_rgba(16,185,129,0.4)]">
              <Store size={20} className="text-white" />
            </div>

            <div>
              <h1 className="text-base font-extrabold tracking-tight text-white">
                Mumbai Collection
              </h1>

              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
                <CircleDot size={10} className="animate-pulse" />
                Staff Portal (Vasai)
              </span>
            </div>
          </div>

          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1 text-slate-400 hover:text-white lg:hidden cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1.5 px-3 py-4">
          {navigation.map((item) => {
            const Icon = item.icon;

            const isActive =
              item.href === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(item.href);

            return (
              <NavLink
                key={item.name}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all ${
                  isActive
                    ? "bg-emerald-500 text-white shadow-[0_4px_16px_rgba(16,185,129,0.35)]"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100"
                }`}
              >
                <Icon
                  size={18}
                  className={
                    isActive
                      ? "text-white"
                      : "text-slate-400 group-hover:text-slate-200"
                  }
                />
                {item.name}
              </NavLink>
            );
          })}
        </nav>

        {/* User Info & Logout Footer */}
        <div className="border-t border-slate-800 p-4 space-y-3">
          <div className="flex items-center gap-3 px-2 py-1.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800 text-emerald-400 border border-slate-700 font-bold text-xs">
              <UserCheck size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-200 truncate">
                Staff ID #{user?.id || "Active"}
              </p>
              <p className="text-[11px] text-emerald-400 font-medium capitalize">
                {user?.roles?.[0] || "Employee"}
              </p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800/80 px-4 py-2.5 text-xs font-bold text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition cursor-pointer border border-rose-500/20"
          >
            <LogOut size={14} />
            End Shift & Logout
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-x-hidden min-h-screen">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex h-18 items-center justify-between border-b border-gray-200 bg-white/95 px-6 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-xl border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 lg:hidden cursor-pointer"
            >
              <Menu size={20} />
            </button>

            <div>
              <h2 className="text-lg font-black tracking-tight text-gray-900">
                {getPageTitle()}
              </h2>
              <p className="text-xs text-gray-500">
                Vasai Quick-Commerce Fulfillment Center
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
              Store Active
            </div>

            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2 text-xs font-bold text-gray-700 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition cursor-pointer"
              title="Logout"
            >
              <LogOut size={14} />
              <span className="hidden md:inline">Logout</span>
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default EmployeeLayout;
