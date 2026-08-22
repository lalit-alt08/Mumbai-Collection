import { useEffect, useState } from "react";
import {
  TrendingUp,
  IndianRupee,
  ShoppingBag,
  CheckCircle2,
  RotateCcw,
  BarChart3,
  Award,
  Users,
  Package,
  Truck,
  AlertCircle,
  Boxes,
  XCircle,
} from "lucide-react";
import { getAnalytics } from "../services/adminApi";

function Analytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchAnalyticsData = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await getAnalytics();

      if (res?.success) {
        setData(res.data);
      } else {
        throw new Error(res?.message || "Failed to load store analytics.");
      }
    } catch (err) {
      console.error("Fetch analytics error:", err);
      setError("Failed to load store analytics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalyticsData();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-60 animate-pulse rounded-lg bg-gray-200" />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-32 animate-pulse rounded-2xl bg-white p-6 shadow-sm" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-3xl bg-white p-8 border border-gray-100 text-center shadow-sm space-y-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
          <AlertCircle size={24} />
        </div>
        <div>
          <h3 className="text-base font-black text-gray-900">Unable to load analytics</h3>
          <p className="text-xs text-gray-500 mt-1">{error || "Analytics reporting data is temporarily unavailable."}</p>
        </div>
        <button
          onClick={fetchAnalyticsData}
          className="inline-flex items-center gap-2 rounded-xl bg-[#FF8A00] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#FF7300] shadow-sm transition"
        >
          <RotateCcw size={14} /> Retry Analytics
        </button>
      </div>
    );
  }

  const { revenue, orders, topProducts, topCustomers, customerMetrics } = data;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 md:text-3xl">
            Store Sales Analytics & Reports
          </h1>
          <p className="text-xs font-medium text-gray-500 mt-1">
            Comprehensive revenue breakdown, product performance, and customer retention metrics
          </p>
        </div>

        <button
          onClick={fetchAnalyticsData}
          className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold text-gray-700 shadow-sm transition hover:bg-gray-50"
        >
          <RotateCcw size={14} /> Refresh
        </button>
      </div>

      {/* 4 Executive KPI Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Store Revenue */}
        <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Total Revenue
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <IndianRupee size={18} />
            </div>
          </div>
          <div className="mt-3 text-2xl font-black text-gray-900">
            ₹{revenue.totalRevenue.toLocaleString("en-IN")}
          </div>
          <p className="mt-1 text-[11px] text-gray-500">
            Completed: ₹{revenue.completedRevenue.toLocaleString("en-IN")}
          </p>
        </div>

        {/* Average Order Value (AOV) */}
        <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Average Order Value (AOV)
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-50 text-[#FF8A00]">
              <TrendingUp size={18} />
            </div>
          </div>
          <div className="mt-3 text-2xl font-black text-gray-900">
            ₹{revenue.avgOrderValue.toLocaleString("en-IN")}
          </div>
          <p className="mt-1 text-[11px] text-gray-500">
            Per customer checkout basket
          </p>
        </div>

        {/* Total Orders & Delivery */}
        <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Total Orders
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <ShoppingBag size={18} />
            </div>
          </div>
          <div className="mt-3 text-2xl font-black text-gray-900">
            {orders.total}
          </div>
          <p className="mt-1 text-[11px] text-emerald-600 font-bold">
            {orders.completed} Delivered ({orders.fulfillmentRate}%)
          </p>
        </div>

        {/* Repeat Customer Rate */}
        <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Repeat Customers
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
              <Users size={18} />
            </div>
          </div>
          <div className="mt-3 text-2xl font-black text-gray-900">
            {customerMetrics.repeatCustomerRate}%
          </div>
          <p className="mt-1 text-[11px] text-gray-500">
            {customerMetrics.totalUniqueCustomers} unique store buyers
          </p>
        </div>
      </div>

      {/* Cancelled Orders Summary */}
      <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <XCircle size={18} className="text-rose-500" /> Cancelled Orders Summary
          </h3>
          <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-bold text-rose-600">
            {orders.cancelled || 0} Total Cancelled
          </span>
        </div>

        <div className="rounded-xl bg-gray-50/70 p-6 text-center border border-dashed border-gray-200">
          <p className="text-sm font-bold text-gray-800">
            {orders.cancelled || 0} orders cancelled ({orders.total > 0 ? ((orders.cancelled / orders.total) * 100).toFixed(1) : 0}% of total catalog orders)
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Order fulfillment and dispatch pipeline operations are managed exclusively in the Employee Panel.
          </p>
        </div>
      </div>

      {/* Top Products & Top Customers Grids */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Selling Products */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 space-y-4">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Award size={18} className="text-[#FF8A00]" /> Top Performing Products
          </h3>

          {topProducts.length === 0 ? (
            <p className="text-xs text-gray-400">No product sales data recorded yet.</p>
          ) : (
            <div className="space-y-2.5">
              {topProducts.map((p, idx) => (
                <div
                  key={p.id || idx}
                  className="flex items-center justify-between rounded-xl bg-gray-50 p-3 border border-gray-100"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-white border border-gray-200">
                      {p.image ? (
                        <img src={p.image} alt={p.name} className="h-full w-full object-contain" />
                      ) : (
                        <Boxes size={16} className="text-gray-400" />
                      )}
                    </div>
                    <div>
                      <div className="font-bold text-gray-900 text-xs line-clamp-1">{p.name}</div>
                      <div className="text-[10px] text-gray-500">
                        {p.totalQuantitySold} unit{p.totalQuantitySold !== 1 ? "s" : ""} sold
                      </div>
                    </div>
                  </div>
                  <div className="font-black text-gray-900 text-xs">
                    ₹{p.totalRevenue.toLocaleString("en-IN")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Valued Customers */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 space-y-4">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Users size={18} className="text-purple-600" /> Top Customers by Lifetime Value
          </h3>

          {topCustomers.length === 0 ? (
            <p className="text-xs text-gray-400">No customer records available.</p>
          ) : (
            <div className="space-y-2.5">
              {topCustomers.map((c, idx) => (
                <div
                  key={c.email || idx}
                  className="flex items-center justify-between rounded-xl bg-gray-50 p-3 border border-gray-100"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-tr from-[#FF8A00] to-[#FFA726] text-white font-bold text-xs">
                      {(c.name || "C").slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-bold text-gray-900 text-xs">{c.name}</div>
                      <div className="text-[10px] text-gray-500">
                        {c.ordersCount} order{c.ordersCount !== 1 ? "s" : ""} • {c.email}
                      </div>
                    </div>
                  </div>
                  <div className="font-black text-gray-900 text-xs">
                    ₹{c.lifetimeSpent.toLocaleString("en-IN")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Analytics;
