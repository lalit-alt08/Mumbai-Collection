import { useState, useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Boxes,
  Users,
  UserX,
  TrendingUp,
  ShieldCheck,
  Store,
  Clock,
  Menu,
  X,
  ExternalLink,
  CircleDot,
  LogOut,
  RotateCcw,
} from "lucide-react";

import { useAdminAuth } from "../context/AdminAuthContext.jsx";

function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pageRefresh, setPageRefresh] = useState(null);
  const [refreshLoading, setRefreshLoading] = useState(false);
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

  const { logout } = useAdminAuth();

  // Page components own refresh callback registration and cleanup.
  useEffect(() => {
    setRefreshLoading(false);
  }, [location.pathname]);

  const setDashboardRefresh = setPageRefresh;

  const navigation = [
    { name: "Overview", href: "/", icon: LayoutDashboard },
    { name: "Inventory & Stock", href: "/products", icon: Boxes },
    { name: "Customers", href: "/customers", icon: Users },
    { name: "Customer Suspension", href: "/customer-suspension", icon: UserX },
    { name: "Employee Access", href: "/employees", icon: ShieldCheck },
    { name: "Sales Analytics", href: "/analytics", icon: TrendingUp },
    { name: "Store Hours", href: "/store-hours", icon: Clock },
  ];

  // Core mobile bottom navigation items
  const mobileNavItems = [
    { name: "Overview", href: "/", exact: true, icon: LayoutDashboard },
    { name: "Inventory", href: "/products", exact: false, icon: Boxes },
    { name: "Analytics", href: "/analytics", exact: false, icon: TrendingUp },
    { name: "Customers", href: "/customers", exact: false, icon: Users },
  ];

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const getPageTitle = () => {
    if (location.pathname === "/") return "Executive Overview";
    if (location.pathname.startsWith("/products")) return "Inventory & Stock";
    if (location.pathname.startsWith("/customers")) return "Customers";
    if (location.pathname.startsWith("/customer-suspension")) return "Customer Suspension";
    if (location.pathname.startsWith("/employees")) return "Employee Access";
    if (location.pathname.startsWith("/analytics")) return "Sales Analytics";
    if (location.pathname.startsWith("/store-hours")) return "Store Hours";
    return "Admin HQ";
  };

  const customerStoreUrl =
    import.meta.env.VITE_CUSTOMER_URL || "http://localhost:5173";

  return (
    <div className="flex min-h-screen w-full max-w-full overflow-x-hidden bg-[#F8F9FA] text-[#1E1E1E]">
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-[45] bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-[#121417] text-white transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full pointer-events-none lg:pointer-events-auto"
        }`}
      >
        {/* Brand Header */}
        <div className="flex h-18 items-center justify-between px-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-[#FF8A00] to-[#FFA726] shadow-[0_4px_16px_rgba(255,138,0,0.4)]">
              <Store size={20} className="text-white" />
            </div>

            <div>
              <h1 className="text-base font-extrabold tracking-tight text-white">
                Mumbai Collection
              </h1>

              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#FF8A00]">
                <CircleDot size={10} className="animate-pulse" />
                Admin HQ (Vasai)
              </span>
            </div>
          </div>

          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1 text-gray-400 hover:text-white lg:hidden cursor-pointer"
            aria-label="Close Sidebar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1.5 px-3 py-4 select-none overflow-y-auto">
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
                onClick={(e) => handleMenuClick(e, item.href)}
                style={{ touchAction: "manipulation" }}
                className={`group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all select-none ${
                  isActive
                    ? "bg-[#FF8A00] text-white shadow-[0_4px_16px_rgba(255,138,0,0.3)] font-bold"
                    : "text-gray-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon
                  size={19}
                  className={
                    isActive
                      ? "text-white"
                      : "text-gray-400 group-hover:text-white"
                  }
                />

                <span>{item.name}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Bottom Section */}
        <div className="border-t border-white/10 p-4 space-y-2">
          {/* Customer Store */}
          <a
            href={customerStoreUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-xl bg-white/5 px-3.5 py-2.5 text-xs font-semibold text-gray-300 hover:bg-white/10 hover:text-white transition"
          >
            <span className="flex items-center gap-2">
              <Store size={15} className="text-[#FF8A00]" />
              View Customer Store
            </span>

            <ExternalLink size={13} />
          </a>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-gray-400 transition hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
          >
            <LogOut size={15} />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden min-h-screen">
        {/* Mobile Header with Safe Area Padding */}
        <header
          className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200/80 bg-white/95 px-3.5 sm:px-6 pb-3 backdrop-blur-md transition-all shadow-[0_2px_12px_rgba(0,0,0,0.03)] lg:hidden"
          style={{
            paddingTop: "max(12px, calc(var(--safe-area-top, env(safe-area-inset-top, 0px)) + 8px))",
          }}
        >
          {/* Left: Hamburger Menu Button [ ☰ ] + Title */}
          <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              style={{ touchAction: "manipulation" }}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 active:scale-95 shadow-xs transition cursor-pointer shrink-0"
              aria-label="Open Navigation"
            >
              <Menu size={20} />
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-black tracking-[-0.02em] text-gray-900 truncate leading-tight antialiased">
                  {getPageTitle()}
                </h1>
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-[#FF8A00] border border-amber-200/60 shrink-0">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#FF8A00] animate-ping" />
                  Admin HQ
                </span>
              </div>
              <p className="text-[11px] font-medium text-gray-500 truncate mt-0.5">
                Mumbai Collection • Vasai HQ
              </p>
            </div>
          </div>

          {/* Right Action Controls: Refresh (when page provides it) & Logout */}
          <div className="flex items-center gap-2 shrink-0">
            {pageRefresh && !location.pathname.startsWith('/customers') && (
              <button
                type="button"
                onClick={() => {
                  if (typeof pageRefresh === "function") {
                    pageRefresh();
                  }
                }}
                disabled={refreshLoading}
                aria-label="Refresh data"
                title="Refresh data"
                className="flex h-9 sm:h-10 items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-2.5 sm:px-3 text-xs font-bold text-gray-700 hover:bg-gray-100 hover:text-gray-900 active:scale-95 transition cursor-pointer shadow-xs disabled:opacity-60"
              >
                <RotateCcw size={15} className={refreshLoading ? "animate-spin text-[#FF8A00]" : "text-gray-500"} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleLogout}
              className="flex h-9 sm:h-10 items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3 text-xs font-bold text-gray-700 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 active:scale-95 transition cursor-pointer shadow-xs"
              title="Logout"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>

        {/* Page Content with bottom clearance for Mobile Bottom Navigation */}
        <main ref={mainRef} className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 pb-24 lg:pb-8">
          <Outlet context={{ setDashboardRefresh, setPageRefresh, setRefreshLoading }} />
        </main>

        {/* Mobile Bottom Navigation Bar */}
        <nav
          aria-label="Mobile Admin Navigation"
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
                    isActive ? "text-[#FF8A00]" : "text-gray-400 hover:text-[#FF8A00]"
                  }`}
                >
                  <div className={`relative flex items-center justify-center transition-transform ${isActive ? "scale-105" : ""}`}>
                    <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                  </div>
                  <span className={`text-[11px] tracking-tight ${isActive ? "font-bold text-[#FF8A00]" : "font-semibold text-gray-500"}`}>
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

export default AdminLayout;
