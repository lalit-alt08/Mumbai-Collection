import { useState, useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Boxes,
  PackagePlus,
  FolderPlus,
  Truck,
  Store,
  Menu,
  X,
  CircleDot,
  LogOut,
  UserCheck,
  Sliders,
  FolderTree,
  Smartphone,
  Sun,
} from "lucide-react";

import { useEmployeeAuth } from "../context/EmployeeAuthContext.jsx";
import { useWakeLock } from "../hooks/useWakeLock.js";

function EmployeeLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const { logout, user } = useEmployeeAuth();
  const { isLocked, isEnabled, isSupported, toggleCounterMode, releaseLock } = useWakeLock();

  const navigation = [
    { name: "Dashboard", href: "/", exact: true, icon: LayoutDashboard },
    { name: "Orders & Dispatch", href: "/orders", icon: Truck },
    { name: "Products & Stock", href: "/products", exact: true, icon: Boxes },
    { name: "Add Product", href: "/products/add", exact: true, icon: PackagePlus },
    { name: "Categories", href: "/categories/add", exact: true, icon: FolderPlus },
    { name: "Homepage Banners", href: "/banners", exact: true, icon: Sliders },
    { name: "Subcategories", href: "/subcategories", exact: true, icon: FolderTree },
  ];

  // Resynchronize locked-screen push subscription automatically if permission is already granted
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      import("../utils/pushSubscription.js")
        .then(({ registerPushNotificationService }) => {
          registerPushNotificationService().catch(() => {});
        })
        .catch(() => {});
    }
  }, []);

  const handleLogout = async () => {
    await releaseLock();
    await logout();
    navigate("/login", { replace: true });
  };

  const getPageTitle = () => {
    if (location.pathname === "/") return "Operational Dashboard";
    if (location.pathname === "/products/add") return "Add New Product";
    if (location.pathname === "/categories/add") return "Categories";
    if (location.pathname === "/banners") return "Banners";
    if (location.pathname === "/subcategories") return "Subcategories";
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
              item.exact
                ? location.pathname === item.href
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

        {/* Counter Mode Switch in Sidebar */}
        <div className="px-4 py-2">
          <button
            onClick={toggleCounterMode}
            className={`w-full flex items-center justify-between rounded-xl p-3 text-xs font-bold transition cursor-pointer border ${
              isLocked
                ? "bg-emerald-950/60 border-emerald-500/50 text-emerald-300"
                : isEnabled
                ? "bg-amber-950/60 border-amber-500/40 text-amber-300"
                : "bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200"
            }`}
          >
            <div className="flex items-center gap-2">
              <Sun size={15} className={isLocked ? "text-emerald-400 animate-spin" : "text-slate-400"} />
              <div className="text-left">
                <p className="font-bold">Counter Mode</p>
                <p className="text-[10px] opacity-75">
                  {isLocked ? "Screen Awake & Armed" : isEnabled ? "Alerts Armed" : "Keep Screen Awake"}
                </p>
              </div>
            </div>
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                isLocked ? "bg-emerald-400 animate-pulse" : isEnabled ? "bg-amber-400" : "bg-slate-600"
              }`}
            />
          </button>
        </div>

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

          <div className="flex items-center gap-2.5">
            {/* Counter Mode Keep-Awake Switch in Header */}
            <button
              onClick={toggleCounterMode}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition cursor-pointer border ${
                isLocked
                  ? "bg-emerald-50 text-emerald-800 border-emerald-300 shadow-sm"
                  : isEnabled
                  ? "bg-amber-50 text-amber-800 border-amber-300"
                  : "bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200"
              }`}
              title="Keep screen awake and arm audio order alerts for shop phone"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isLocked ? "bg-emerald-500 animate-pulse" : isEnabled ? "bg-amber-500" : "bg-gray-400"
                }`}
              />
              <span className="hidden sm:inline">
                {isLocked ? "🟢 Counter Mode (Screen Awake)" : isEnabled ? "⚡ Counter Mode (Armed)" : "⚪ Counter Mode Off"}
              </span>
              <span className="sm:hidden">
                {isLocked ? "Awake" : "Counter Mode"}
              </span>
            </button>

            <div className="hidden sm:flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 border border-emerald-200">
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
