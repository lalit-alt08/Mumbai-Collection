import { useState } from "react";
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
} from "lucide-react";

import { useAdminAuth } from "../context/AdminAuthContext.jsx";

function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const { logout } = useAdminAuth();

  const navigation = [
    { name: "Overview", href: "/", icon: LayoutDashboard },
    { name: "Inventory & Stock", href: "/products", icon: Boxes },
    { name: "Customers", href: "/customers", icon: Users },
    { name: "Customer Suspension", href: "/customer-suspension", icon: UserX },
    { name: "Employee Access", href: "/employees", icon: ShieldCheck },
    { name: "Sales Analytics", href: "/analytics", icon: TrendingUp },
    { name: "Store Hours", href: "/store-hours", icon: Clock },
  ];

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const customerStoreUrl =
    import.meta.env.VITE_CUSTOMER_URL || "http://localhost:5173";

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
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-[#121417] text-white transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
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
            className="p-1 text-gray-400 hover:text-white lg:hidden"
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
            className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-gray-400 transition hover:bg-red-500/10 hover:text-red-400"
          >
            <LogOut size={15} />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile Header (only visible on mobile to open drawer) */}
        <div className="flex h-14 items-center justify-between border-b border-gray-200/80 bg-white px-4 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 text-gray-600 hover:text-gray-900 rounded-xl hover:bg-gray-100"
            aria-label="Open Navigation"
          >
            <Menu size={22} />
          </button>
          <span className="text-sm font-bold text-gray-900">Mumbai Collection</span>
          <div className="w-8" />
        </div>

        {/* Page */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AdminLayout;