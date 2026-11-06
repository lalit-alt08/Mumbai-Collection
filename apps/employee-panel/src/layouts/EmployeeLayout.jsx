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
  Sun,
} from "lucide-react";

import { useEmployeeAuth } from "../context/EmployeeAuthContext.jsx";
import { useWakeLock } from "../hooks/useWakeLock.js";

function EmployeeLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const { logout, user } = useEmployeeAuth();
  const { isLocked, isEnabled, toggleCounterMode, releaseLock } = useWakeLock();

  const navigation = [
    { name: "Dashboard", href: "/", exact: true, icon: LayoutDashboard },
    { name: "Orders & Dispatch", href: "/orders", icon: Truck },
    { name: "Products & Stock", href: "/products", exact: true, icon: Boxes },
    { name: "Add Product", href: "/products/add", exact: true, icon: PackagePlus },
    { name: "Categories", href: "/categories/add", exact: true, icon: FolderPlus },
    { name: "Homepage Banners", href: "/banners", exact: true, icon: Sliders },
    { name: "Subcategories", href: "/subcategories", exact: true, icon: FolderTree },
  ];

  // Core mobile bottom navigation items
  const mobileNavItems = [
    { name: "Dashboard", href: "/", exact: true, icon: LayoutDashboard },
    { name: "Orders", href: "/orders", exact: false, icon: Truck },
    { name: "Products", href: "/products", exact: true, icon: Boxes },
    { name: "Banners", href: "/banners", exact: true, icon: Sliders },
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
    if (location.pathname.startsWith("/orders")) return "Orders & Dispatch";
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
            aria-label="Close Sidebar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1.5 px-3 py-4 overflow-y-auto">
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
        {/* Top Header with Safe Area Padding */}
        <header
          className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200/80 bg-white/95 px-3.5 sm:px-7 pb-3 sm:pb-3.5 backdrop-blur-md transition-all shadow-[0_2px_12px_rgba(0,0,0,0.03)]"
          style={{
            paddingTop: "max(12px, calc(var(--safe-area-top, env(safe-area-inset-top, 0px)) + 8px))",
          }}
        >
          {/* Left: Previous Position of Hamburger Menu Button [ ☰ ] + Title */}
          <div className="flex items-center gap-2.5 sm:gap-4 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 active:scale-95 shadow-xs transition cursor-pointer lg:hidden shrink-0"
              aria-label="Open Sidebar Menu"
            >
              <Menu size={20} />
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-2xl lg:text-[28px] font-black tracking-[-0.02em] text-slate-900 truncate leading-tight antialiased">
                  {getPageTitle()}
                </h1>
                <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200 shrink-0">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                  Store Active
                </span>
              </div>
              <p className="text-[11px] sm:text-[13px] font-medium text-slate-500 truncate mt-0.5 sm:mt-1">
                Vasai Quick-Commerce Fulfillment Center
              </p>
            </div>
          </div>

          {/* Right Action Controls: Counter Mode & Logout */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Quick Counter WakeLock Toggle */}
            <button
              type="button"
              onClick={toggleCounterMode}
              className={`flex h-9 sm:h-10 items-center gap-1.5 rounded-xl border px-2.5 sm:px-3 text-xs font-bold transition active:scale-95 cursor-pointer shadow-xs ${
                isLocked
                  ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                  : isEnabled
                  ? "bg-amber-50 border-amber-300 text-amber-700"
                  : "bg-gray-50 border-gray-200 text-slate-600 hover:bg-gray-100"
              }`}
              title={isLocked ? "Counter Mode: Awake & Armed" : "Keep Screen Awake & Armed"}
            >
              <Sun size={15} className={isLocked ? "text-emerald-600 animate-spin" : "text-slate-500"} />
              <span className="hidden sm:inline">Counter</span>
              <span
                className={`h-2 w-2 rounded-full ${
                  isLocked ? "bg-emerald-500 animate-pulse" : isEnabled ? "bg-amber-500" : "bg-slate-300"
                }`}
              />
            </button>

            {/* Logout Button */}
            <button
              type="button"
              onClick={handleLogout}
              className="flex h-9 sm:h-10 items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3 text-xs font-bold text-gray-700 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 active:scale-95 transition cursor-pointer shadow-xs"
              title="Logout"
            >
              <LogOut size={15} />
              <span className="hidden md:inline">Logout</span>
            </button>
          </div>
        </header>

        {/* Page Content with bottom clearance for Mobile Bottom Navigation */}
        <main className="flex-1 p-3.5 sm:p-5 md:p-6 lg:p-8 max-w-7xl w-full mx-auto pb-24 lg:pb-8">
          <Outlet />
        </main>

        {/* Mobile Bottom Navigation Bar */}
        <nav
          aria-label="Mobile Staff Navigation"
          className="fixed bottom-0 left-0 right-0 z-40 rounded-t-[20px] border-t border-gray-200/90 bg-white/95 backdrop-blur-md shadow-[0_-4px_20px_rgba(0,0,0,0.06)] lg:hidden"
          style={{
            paddingBottom: "max(8px, env(safe-area-inset-bottom, 8px))",
            touchAction: "manipulation",
          }}
        >
          <div className="mx-auto flex h-14 max-w-lg items-center justify-around px-2 select-none">
            {mobileNavItems.map((item) => {
              const Icon = item.icon;

              const isActive = item.exact
                ? location.pathname === item.href
                : location.pathname.startsWith(item.href);

              return (
                <NavLink
                  key={item.name}
                  to={item.href}
                  className={`flex flex-1 flex-col items-center justify-center gap-1 py-1 active:scale-95 transition ${
                    isActive ? "text-emerald-600" : "text-slate-500 hover:text-emerald-600"
                  }`}
                >
                  <div className={`relative flex items-center justify-center transition-transform ${isActive ? "scale-105" : ""}`}>
                    <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                    {item.href === "/orders" && (
                      <span className="absolute -top-1 -right-1.5 flex h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white" />
                    )}
                  </div>
                  <span className={`text-[11px] tracking-tight ${isActive ? "font-bold text-emerald-600" : "font-semibold text-slate-500"}`}>
                    {item.name}
                  </span>
                </NavLink>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}

export default EmployeeLayout;
