import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  TrendingUp,
  Package,
  ShoppingBag,
  AlertTriangle,
  ArrowUpRight,
  ArrowRight,
  Clock,
  CheckCircle2,
  Truck,
  RotateCcw,
  IndianRupee,
  Boxes,
  Users,
} from "lucide-react";
import { getOverview, updateOrderStatus } from "../services/adminApi";

function Overview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await getOverview();
      if (res.success) {
        setData(res.data);
      }
    } catch (err) {
      console.error("Dashboard load error:", err);
      setError("Failed to load dashboard metrics. Check backend connection.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleQuickStatusChange = async (orderId, newStatus) => {
    try {
      setUpdatingId(orderId);
      await updateOrderStatus(orderId, newStatus);
      await fetchDashboardData();
    } catch (err) {
      alert("Failed to update status: " + (err.response?.data?.message || err.message));
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-gray-200" />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-32 animate-pulse rounded-2xl bg-white p-6 shadow-sm" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-sm font-semibold text-red-600">{error || "Could not load data"}</p>
        <button
          onClick={fetchDashboardData}
          className="mt-4 rounded-full bg-red-600 px-6 py-2 text-xs font-bold text-white hover:bg-red-700"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const { summary, salesTrend, lowStockProducts, recentOrders } = data;

  // Max sales for chart scaling
  const maxRevenue = Math.max(...salesTrend.map((d) => d.revenue), 1000);

  return (
    <div className="space-y-8">
      {/* Page Title & Refresh */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 md:text-3xl">
            Store Performance Overview
          </h1>
          <p className="text-xs font-medium text-gray-500 mt-1">
            Real-time sales, order fulfillment, and inventory analytics for Mumbai Collection
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchDashboardData}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold text-gray-700 shadow-sm transition hover:bg-gray-50"
          >
            <RotateCcw size={14} />
            Refresh Data
          </button>

          <Link
            to="/orders"
            className="flex items-center gap-2 rounded-xl bg-[#FF8A00] px-5 py-2.5 text-xs font-bold text-white shadow-[0_4px_16px_rgba(255,138,0,0.3)] transition hover:bg-[#FF7300] active:scale-95"
          >
            <Package size={14} />
            Fulfill Orders
          </Link>
        </div>
      </div>

      {/* 4 Executive Metric Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Revenue */}
        <div className="relative overflow-hidden rounded-2xl bg-white p-6 shadow-sm border border-gray-100 transition-all hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
              Total Store Revenue
            </span>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <IndianRupee size={20} />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-black tracking-tight text-gray-900">
              ₹{summary.totalRevenue.toLocaleString("en-IN")}
            </span>
          </div>
          <p className="mt-2 text-xs font-semibold text-emerald-600 flex items-center gap-1">
            <TrendingUp size={13} />
            {summary.completedOrders} orders completed
          </p>
        </div>

        {/* Today's Sales */}
        <div className="relative overflow-hidden rounded-2xl bg-white p-6 shadow-sm border border-gray-100 transition-all hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
              Today&apos;s Revenue
            </span>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-[#FF8A00]">
              <TrendingUp size={20} />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-black tracking-tight text-gray-900">
              ₹{summary.todaySales.toLocaleString("en-IN")}
            </span>
          </div>
          <p className="mt-2 text-xs font-semibold text-gray-500">
            Avg Order: ₹{summary.avgOrderValue.toLocaleString("en-IN")}
          </p>
        </div>

        {/* Active Orders to Dispatch */}
        <div className="relative overflow-hidden rounded-2xl bg-white p-6 shadow-sm border border-gray-100 transition-all hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
              Orders to Dispatch
            </span>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Package size={20} />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-black tracking-tight text-gray-900">
              {summary.activeOrders}
            </span>
            <span className="text-xs font-medium text-gray-500">pending fulfillment</span>
          </div>
          <p className="mt-2 text-xs font-semibold text-blue-600 flex items-center gap-1">
            <Clock size={13} />
            20-30 min Vasai dispatch target
          </p>
        </div>

        {/* Low Stock Alerts */}
        <div className="relative overflow-hidden rounded-2xl bg-white p-6 shadow-sm border border-gray-100 transition-all hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
              Low Stock Warnings
            </span>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <AlertTriangle size={20} />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-black tracking-tight text-gray-900">
              {summary.lowStockCount}
            </span>
            <span className="text-xs font-medium text-gray-500">products critical</span>
          </div>
          <Link
            to="/products"
            className="mt-2 text-xs font-bold text-amber-700 hover:underline flex items-center gap-1"
          >
            Review inventory &rarr;
          </Link>
        </div>
      </div>

      {/* Sales Trend Chart & Low Stock Widget */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Weekly Revenue Bar Chart */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-bold text-gray-900">Weekly Revenue Breakdown</h2>
              <p className="text-xs font-medium text-gray-500">Daily store volume across recent days</p>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
              Live WooCommerce Sync
            </span>
          </div>

          <div className="flex h-64 items-end gap-3 pt-6 sm:gap-6">
            {salesTrend.map((day) => {
              const heightPercent = Math.max(8, Math.round((day.revenue / maxRevenue) * 100));
              return (
                <div key={day.date} className="flex flex-1 flex-col items-center gap-2 group h-full justify-end">
                  <div className="opacity-0 group-hover:opacity-100 transition text-[11px] font-bold text-gray-700">
                    ₹{day.revenue}
                  </div>
                  <div
                    style={{ height: `${heightPercent}%` }}
                    className="w-full rounded-xl bg-gradient-to-t from-[#FF8A00] to-[#FFA726] transition-all duration-500 group-hover:shadow-[0_4px_16px_rgba(255,138,0,0.4)] group-hover:scale-105"
                  />
                  <span className="text-[11px] font-bold text-gray-500">{day.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Low Stock Quick Glance */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-gray-900">Inventory Alerts</h2>
            <Link to="/products" className="text-xs font-bold text-[#FF8A00] hover:underline">
              View All
            </Link>
          </div>

          {lowStockProducts.length === 0 ? (
            <div className="py-12 text-center text-xs text-gray-500 font-medium">
              ✅ All products are adequately stocked!
            </div>
          ) : (
            <div className="space-y-3">
              {lowStockProducts.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-xl bg-gray-50 p-3 border border-gray-100"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-white border border-gray-200">
                      {p.image ? (
                        <img src={p.image} alt={p.name} className="h-full w-full object-contain" />
                      ) : (
                        <Boxes size={18} className="text-gray-400" />
                      )}
                    </div>
                    <div>
                      <h4 className="line-clamp-1 text-xs font-bold text-gray-900">{p.name}</h4>
                      <span className="text-[10px] text-gray-500 font-medium">₹{p.price}</span>
                    </div>
                  </div>

                  <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-rose-700 border border-rose-200">
                    {p.stock_quantity !== null ? `${p.stock_quantity} left` : "Out of stock"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Orders Live Stream with Instant Status Changer */}
      <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-base font-bold text-gray-900">Recent Customer Orders</h2>
            <p className="text-xs font-medium text-gray-500">Live order queue with 1-click status dispatcher</p>
          </div>
          <Link
            to="/orders"
            className="flex items-center gap-1 text-xs font-bold text-[#FF8A00] hover:underline"
          >
            Manage All Orders <ArrowRight size={14} />
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-gray-100 bg-gray-50/50 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">
              <tr>
                <th className="py-3 px-4">Order #</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Items</th>
                <th className="py-3 px-4">Total Paid</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Quick Dispatch Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 font-medium">
              {recentOrders.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50/60 transition">
                  <td className="py-4 px-4 font-bold text-gray-900">
                    #{o.order_number}
                    <div className="text-[10px] text-gray-400 font-normal">
                      {new Date(o.date).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <div className="font-bold text-gray-900">{o.customer_name}</div>
                    <div className="text-[10px] text-gray-400">{o.customer_phone || o.customer_email}</div>
                  </td>
                  <td className="py-4 px-4 font-semibold text-gray-700">
                    {o.items_count} item{o.items_count !== 1 ? "s" : ""}
                  </td>
                  <td className="py-4 px-4 font-black text-gray-900">
                    ₹{o.total}
                    <div className="text-[10px] text-gray-400 font-normal">{o.payment_method}</div>
                  </td>
                  <td className="py-4 px-4">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-extrabold ${
                        o.status === "completed"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : o.status === "processing"
                          ? "bg-blue-50 text-blue-700 border border-blue-200"
                          : o.status === "out-for-delivery" || o.status === "dispatched"
                          ? "bg-orange-50 text-[#FF8A00] border border-orange-200"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {o.status}
                    </span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    {o.status === "processing" && (
                      <button
                        disabled={updatingId === o.id}
                        onClick={() => handleQuickStatusChange(o.id, "out-for-delivery")}
                        className="rounded-xl bg-[#FF8A00] px-3.5 py-1.5 text-[11px] font-bold text-white shadow-sm hover:bg-[#FF7300] active:scale-95 disabled:opacity-50 transition"
                      >
                        {updatingId === o.id ? "Updating..." : "Dispatch Rider &rarr;"}
                      </button>
                    )}
                    {(o.status === "out-for-delivery" || o.status === "dispatched") && (
                      <button
                        disabled={updatingId === o.id}
                        onClick={() => handleQuickStatusChange(o.id, "completed")}
                        className="rounded-xl bg-emerald-600 px-3.5 py-1.5 text-[11px] font-bold text-white shadow-sm hover:bg-emerald-700 active:scale-95 disabled:opacity-50 transition"
                      >
                        {updatingId === o.id ? "Updating..." : "Mark Delivered ✓"}
                      </button>
                    )}
                    {o.status === "completed" && (
                      <span className="text-[11px] font-bold text-emerald-600">Delivered ✓</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Overview;
