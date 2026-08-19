import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  Boxes,
  Users,
  TrendingUp,
  Store,
  Menu,
  X,
  Bell,
  Search,
  ExternalLink,
  ShieldCheck,
  CircleDot,
} from "lucide-react";

function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const navigation = [
    { name: "Overview", href: "/", icon: LayoutDashboard },
    { name: "Orders & Dispatch", href: "/orders", icon: Package },
    { name: "Inventory & Stock", href: "/products", icon: Boxes },
    { name: "Customers", href: "/customers", icon: Users },
    { name: "Sales Analytics", href: "/analytics", icon: TrendingUp },
  ];

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
                <CircleDot size={10} className="animate-pulse" /> Admin HQ (Vasai)
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

        {/* Store Live Banner */}
        <div className="mx-4 my-4 rounded-xl bg-white/5 p-3.5 border border-white/10">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-gray-300">Vasai Store Status</span>
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-extrabold text-emerald-400">
              LIVE &bull; OPEN
            </span>
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            Accepting 20-30 min local orders
          </p>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 space-y-1.5 px-3 py-2">
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
                  className={isActive ? "text-white" : "text-gray-400 group-hover:text-white"}
                />
                <span>{item.name}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Bottom Profile / Storefront Link */}
        <div className="border-t border-white/10 p-4 space-y-2">
          <a
            href="http://localhost:5173"
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

          <div className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FF8A00]/20 text-[#FF8A00] font-bold text-xs">
              AD
            </div>
            <div className="flex-1 overflow-hidden">
              <div className="truncate text-xs font-bold text-white">Store Admin</div>
              <div className="truncate text-[10px] text-gray-400">admin@mumbaicollection.in</div>
            </div>
            <ShieldCheck size={16} className="text-emerald-400" />
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Navbar */}
        <header className="sticky top-0 z-30 flex h-18 items-center justify-between border-b border-gray-200/80 bg-white px-6 shadow-sm">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 text-gray-600 hover:text-gray-900 lg:hidden rounded-lg hover:bg-gray-100"
            >
              <Menu size={22} />
            </button>

            {/* Quick Search */}
            <div className="relative hidden sm:block w-72">
              <Search
                size={16}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="Search orders, products, customers..."
                className="h-10 w-full rounded-full border border-gray-200 bg-gray-50 pl-10 pr-4 text-xs font-medium text-gray-800 placeholder-gray-400 focus:border-[#FF8A00] focus:bg-white focus:outline-none transition"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              aria-label="Notifications"
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
            >
              <Bell size={18} />
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-[#FF8A00]" />
            </button>

            <div className="hidden md:flex flex-col text-right">
              <span className="text-xs font-bold text-gray-900">Vasai Store Terminal</span>
              <span className="text-[10px] text-gray-500 font-medium">Node Backend Connected</span>
            </div>
          </div>
        </header>

        {/* Page View Outlet */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AdminLayout;
