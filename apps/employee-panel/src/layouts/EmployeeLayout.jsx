import { useState, useEffect, useRef } from "react";
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
  Clock,
  Eye,
  EyeOff,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";

import { useEmployeeAuth } from "../context/EmployeeAuthContext.jsx";
import { useWakeLock } from "../hooks/useWakeLock.js";

function EmployeeLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pageRefresh, setPageRefresh] = useState(null);
  const mainRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  const handleMenuClick = (event, href) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    setSidebarOpen(false);
    if (location.pathname !== href) return;

    event.preventDefault();
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    window.scrollTo({ top: 0, behavior: "smooth" });
    void pageRefresh?.();
  };

  const { logout, user, expiryWarning, login, logoutPending, setLogoutPending } = useEmployeeAuth();
  const { isLocked, isEnabled, toggleCounterMode, releaseLock } = useWakeLock();

  const [loggingOut, setLoggingOut] = useState(false);
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [renewEmail, setRenewEmail] = useState("");
  const [renewPassword, setRenewPassword] = useState("");
  const [showRenewPassword, setShowRenewPassword] = useState(false);
  const [renewSubmitting, setRenewSubmitting] = useState(false);
  const [renewError, setRenewError] = useState("");

  const handleRenewSubmit = async (e) => {
    e.preventDefault();
    if (!renewPassword) {
      setRenewError("Password is required.");
      return;
    }
    try {
      setRenewSubmitting(true);
      setRenewError("");
      const res = await login(renewEmail.trim(), renewPassword);
      if (res?.superseded || res?.cancelled) {
        return;
      }
      setShowRenewModal(false);
      setRenewPassword("");
      try {
        window.dispatchEvent(new CustomEvent("mumbai:session-renewed"));
      } catch (_) {}
    } catch (err) {
      setRenewError(
        err.response?.data?.message || err.message || "Failed to renew shift session."
      );
    } finally {
      setRenewSubmitting(false);
    }
  };

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

  const handleLogout = async (options = {}) => {
    try {
      setLoggingOut(true);
      await releaseLock();
      const res = await logout(options);
      if (res?.success) {
        navigate("/login", { replace: true });
      }
    } catch (_) {
    } finally {
      setLoggingOut(false);
    }
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
          className="fixed inset-0 z-[45] bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-[#0F172A] text-white transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full pointer-events-none lg:pointer-events-auto"
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
                onClick={(e) => handleMenuClick(e, item.href)}
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

        {/* 12-Hour Shift Session Expiry Warning Strip */}
        {expiryWarning && (
          <div className="bg-amber-500 text-slate-950 px-4 py-2.5 text-xs sm:text-sm font-bold flex items-center justify-between border-b border-amber-600 shadow-xs animate-[slideDown_0.2s_ease-out]">
            <div className="flex items-center gap-2 min-w-0">
              <Clock size={16} className="shrink-0 text-slate-950" />
              <span className="truncate">
                Staff Shift Notice: Session expires in <strong>{expiryWarning} minute{expiryWarning > 1 ? "s" : ""}</strong>.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setRenewEmail(user?.email || "");
                setRenewPassword("");
                setRenewError("");
                setShowRenewModal(true);
              }}
              className="px-3 py-1 bg-slate-950 text-white rounded-lg text-xs font-black hover:bg-slate-800 transition shrink-0 ml-3 cursor-pointer shadow-xs"
            >
              Extend Shift
            </button>
          </div>
        )}

        {/* In-Page Shift Extension Modal (Keeps Orders Screen & Audio Alarm Active) */}
        {showRenewModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-[fadeIn_0.15s_ease-out]">
            <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden animate-[scaleUp_0.15s_ease-out]">
              {/* Header */}
              <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center">
                    <Clock size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-gray-900">Extend 12-Hour Shift</h3>
                    <p className="text-xs text-gray-500">Order monitoring will continue in the background</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRenewModal(false)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleRenewSubmit} className="p-6 space-y-4">
                {renewError && (
                  <div className="p-3 text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl">
                    {renewError}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Staff Email</label>
                  <input
                    type="email"
                    value={renewEmail}
                    onChange={(e) => setRenewEmail(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-gray-200 bg-gray-50 text-gray-800 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Password</label>
                  <div className="relative">
                    <input
                      type={showRenewPassword ? "text" : "password"}
                      value={renewPassword}
                      onChange={(e) => setRenewPassword(e.target.value)}
                      autoFocus
                      placeholder="Enter password to extend"
                      required
                      className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-gray-200 text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRenewPassword(!showRenewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                    >
                      {showRenewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowRenewModal(false)}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={renewSubmitting}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-white text-xs font-bold transition disabled:opacity-60 cursor-pointer shadow-xs flex items-center justify-center gap-2"
                  >
                    {renewSubmitting ? "Extending..." : "Confirm & Extend"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Logout Pending / Server Unconfirmed Modal */}
        {logoutPending && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <div className="relative w-full max-w-md rounded-2xl border border-amber-500/30 bg-[#0F172A] p-6 text-white shadow-2xl">
              <div className="flex items-center gap-3 text-amber-400 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Server Revocation Pending</h3>
                  <p className="text-xs text-amber-400/90 font-medium">Single-device logout verification</p>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed mb-6">
                {logoutPending.message || "WordPress could not confirm destruction of this device's session token. You can retry revoking it on the server, or proceed to sign out on this device."}
              </p>

              <div className="flex flex-col gap-2.5">
                <button
                  type="button"
                  disabled={loggingOut}
                  onClick={() => handleLogout({ force: false })}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 text-xs font-bold text-white transition disabled:opacity-60 cursor-pointer shadow-sm"
                >
                  <RotateCcw size={14} className={loggingOut ? "animate-spin" : ""} />
                  {loggingOut ? "Retrying Revocation..." : "Retry Server Logout"}
                </button>

                <button
                  type="button"
                  disabled={loggingOut}
                  onClick={() => handleLogout({ force: true })}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 hover:text-rose-300 border border-slate-700 px-4 py-2.5 text-xs font-bold text-rose-400 transition cursor-pointer"
                >
                  <LogOut size={14} />
                  Sign Out on This Device
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Page Content with bottom clearance for Mobile Bottom Navigation */}
        <main ref={mainRef} className="flex-1 p-3.5 sm:p-5 md:p-6 lg:p-8 max-w-7xl w-full mx-auto pb-24 lg:pb-8">
          <Outlet context={{ setPageRefresh }} />
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
                  onClick={(e) => handleMenuClick(e, item.href)}
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
