import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  TrendingUp,
  Package,
  ShoppingBag,
  AlertTriangle,
  ArrowUpRight,
  Clock,
  CheckCircle2,
  Truck,
  RotateCcw,
  Boxes,
  Users,
  Calendar,
  Loader2,
} from "lucide-react";
import { getOverview, reconcilePayment } from "../services/adminApi";
import { formatOrderDateTimeIST, getStatusBadgeClass } from "../utils/recentOrdersFormatter.js";

function Overview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reconcilingId, setReconcilingId] = useState(null);
  const [reconcileFeedback, setReconcileFeedback] = useState(null);

  const fetchDashboardData = async (isRefresh = false) => {
    try {
      setLoading(true);
      setError("");
      const res = await getOverview(isRefresh ? { refresh: "true" } : {});
      if (res.success) {
        setData(res.data);
      }
    } catch (err) {
      setError("Failed to load dashboard metrics. Check backend connection.");
    } finally {
      setLoading(false);
    }
  };

  const handleReconcile = async (orderId) => {
    try {
      setReconcilingId(orderId);
      setReconcileFeedback(null);
      const res = await reconcilePayment(orderId);

      const isUpdated = res?.action === "updated_to_processing";
      const message = res?.message || (isUpdated ? "Payment matched! Order updated to processing." : "Reconciliation complete.");

      setReconcileFeedback({
        id: orderId,
        type: isUpdated ? "success" : "info",
        message: `Order #${orderId}: ${message}`,
      });

      if (isUpdated) {
        await fetchDashboardData(true);
      }
    } catch (err) {
      setReconcileFeedback({
        id: orderId,
        type: "error",
        message: `Order #${orderId}: ${err?.response?.data?.message || err.message || "Failed to reconcile payment."}`,
      });
    } finally {
      setReconcilingId(null);
    }
  };

  useEffect(() => {
    fetchDashboardData(false);
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-gray-200" />
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {[1, 2, 3].map((n) => (
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
          onClick={() => fetchDashboardData(true)}
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
            onClick={() => fetchDashboardData(true)}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold text-gray-700 shadow-sm transition hover:bg-gray-50"
          >
            <RotateCcw size={14} />
            Refresh Data
          </button>
        </div>
      </div>

      {/* 3 Executive Metric Cards */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
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

        {/* Monthly Sales */}
        <div className="relative overflow-hidden rounded-2xl bg-white p-6 shadow-sm border border-gray-100 transition-all hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
              Monthly Sales
            </span>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Calendar size={20} />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-black tracking-tight text-gray-900">
              ₹{(summary.monthSales ?? 0).toLocaleString("en-IN")}
            </span>
          </div>
          <p className="mt-2 text-xs font-semibold text-blue-600 flex items-center gap-1">
            <TrendingUp size={13} />
            {summary.monthOrdersCount ?? 0} orders this month
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
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm border border-gray-100">
        <div className="mb-4 sm:mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Recent Customer Orders</h2>
            <p className="text-xs font-medium text-gray-500">Live order overview across the store</p>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        </div>

        {/* Reconcile Feedback Banner */}
        {reconcileFeedback && (
          <div
            className={`mb-4 flex items-center justify-between gap-2 rounded-xl p-3 text-xs font-medium border ${
              reconcileFeedback.type === "success"
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : reconcileFeedback.type === "error"
                ? "bg-rose-50 text-rose-800 border-rose-200"
                : "bg-blue-50 text-blue-800 border-blue-200"
            }`}
          >
            <div className="flex items-center gap-2">
              {reconcileFeedback.type === "success" ? (
                <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
              ) : (
                <AlertTriangle size={15} className="shrink-0 text-amber-600" />
              )}
              <span>{reconcileFeedback.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setReconcileFeedback(null)}
              className="text-gray-400 hover:text-gray-700 text-sm font-bold cursor-pointer"
            >
              &times;
            </button>
          </div>
        )}

        {/* Mobile View: Clean Card-Based Layout (md:hidden) */}
        <div className="space-y-3 md:hidden">
          {!recentOrders || recentOrders.length === 0 ? (
            <div className="py-10 text-center text-xs font-medium text-gray-500 bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
              No orders received yet.
            </div>
          ) : (
            recentOrders.map((o) => (
              <div
                key={o.id}
                className="rounded-xl border border-gray-100 bg-white p-3.5 shadow-2xs transition hover:border-gray-200"
              >
                {/* Header: Order ID + Date & Status */}
                <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-gray-100">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-black text-gray-900 shrink-0">
                      #{o.order_number}
                    </span>
                    <span className="text-[11px] font-medium text-gray-400 truncate">
                      • {formatOrderDateTimeIST(o.date)}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${getStatusBadgeClass(
                      o.status
                    )}`}
                  >
                    {o.status}
                  </span>
                </div>

                {/* Customer Details & Item Count */}
                <div className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-xs text-gray-900 truncate">
                      {o.customer_name}
                    </div>
                    {(o.customer_phone || o.customer_email) && (
                      <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1">
                        {o.customer_phone ? (
                          <a
                            href={`tel:${o.customer_phone}`}
                            className="hover:text-primary transition font-medium text-gray-600"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {o.customer_phone}
                          </a>
                        ) : (
                          <span className="truncate">{o.customer_email}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="inline-flex items-center gap-1 rounded-lg bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-700 border border-gray-200/60">
                      <ShoppingBag size={12} className="text-gray-400" />
                      {o.items_count} item{o.items_count !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>

                {/* Footer: Payment Method, Total Price & Reconcile */}
                <div className="flex items-center justify-between pt-2.5 border-t border-gray-100/80 bg-gray-50/50 -mx-3.5 -mb-3.5 px-3.5 py-2.5 rounded-b-xl">
                  <span className="text-[11px] text-gray-500 font-medium flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    {o.payment_method || "Cash on delivery"}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleReconcile(o.id)}
                      disabled={reconcilingId === o.id}
                      title="Reconcile Payment with Gateway"
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-600 shadow-2xs hover:bg-gray-50 hover:text-gray-900 active:scale-95 disabled:opacity-50 cursor-pointer"
                    >
                      {reconcilingId === o.id ? (
                        <Loader2 size={10} className="animate-spin text-[#FF8A00]" />
                      ) : (
                        <RotateCcw size={10} className="text-gray-400" />
                      )}
                      <span>Reconcile</span>
                    </button>
                    <span className="text-sm font-black text-gray-900 tracking-tight">
                      ₹{o.total}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Desktop View: Preserved Table Layout (hidden md:block) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-gray-100 bg-gray-50/50 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">
              <tr>
                <th className="py-3 px-4">Order #</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Items</th>
                <th className="py-3 px-4">Order Total</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 font-medium">
              {!recentOrders || recentOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-xs font-medium text-gray-500">
                    No orders received yet.
                  </td>
                </tr>
              ) : (
                recentOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50/60 transition">
                    <td className="py-4 px-4 font-bold text-gray-900">
                      #{o.order_number}
                      <div className="text-[10px] text-gray-400 font-normal">
                        {formatOrderDateTimeIST(o.date)}
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
                    <td className="py-4 px-4 text-center">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-extrabold ${getStatusBadgeClass(
                          o.status
                        )}`}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleReconcile(o.id)}
                        disabled={reconcilingId === o.id}
                        title="Reconcile payment with Razorpay gateway"
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 shadow-2xs hover:bg-gray-50 hover:text-gray-900 active:scale-95 disabled:opacity-50 cursor-pointer"
                      >
                        {reconcilingId === o.id ? (
                          <Loader2 size={12} className="animate-spin text-[#FF8A00]" />
                        ) : (
                          <RotateCcw size={12} className="text-gray-400" />
                        )}
                        <span>Reconcile</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Overview;
