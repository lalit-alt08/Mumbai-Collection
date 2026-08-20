import { useEffect, useState } from "react";
import {
  TrendingUp,
  IndianRupee,
  ShoppingBag,
  CheckCircle2,
  RotateCcw,
  PieChart,
  BarChart3,
  Award,
  Users,
  Package,
  Truck,
  AlertCircle,
  Boxes,
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
      if (res.success) {
        setData(res.data);
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

  if (loading || !data) {
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

  const { revenue, orders, payments, topProducts, topCustomers, customerMetrics } = data;

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

      {/* Orders Status Distribution & Payment Split */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Order Fulfillment Pipeline */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 space-y-4">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Package size={18} className="text-[#FF8A00]" /> Order Pipeline Breakdown
          </h3>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-blue-50/60 p-3 border border-blue-100">
              <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">To Pack</div>
              <div className="text-xl font-black text-blue-900 mt-1">{orders.processing}</div>
            </div>

            <div className="rounded-xl bg-orange-50/60 p-3 border border-orange-100">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#FF8A00]">On the Way</div>
              <div className="text-xl font-black text-gray-900 mt-1">{orders.outForDelivery}</div>
            </div>

            <div className="rounded-xl bg-emerald-50/60 p-3 border border-emerald-100">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Delivered</div>
              <div className="text-xl font-black text-emerald-900 mt-1">{orders.completed}</div>
            </div>
          </div>

          <div className="flex justify-between items-center text-xs text-gray-500 pt-2 border-t border-gray-100">
            <span>Cancelled / Failed Orders</span>
            <span className="font-bold text-rose-600">{orders.cancelled} orders</span>
          </div>
        </div>

        {/* Payment Methods */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 space-y-4">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <PieChart size={18} className="text-[#FF8A00]" /> Payment Method Share
          </h3>

          <div className="space-y-4 pt-1">
            <div>
              <div className="flex justify-between text-xs font-bold text-gray-700 mb-1.5">
                <span>Cash on Delivery (COD) ({payments.cod.count} orders)</span>
                <span>₹{payments.cod.revenue.toLocaleString("en-IN")} ({payments.cod.percentage}%)</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-gray-100 overflow-hidden">
                <div
                  style={{ width: `${payments.cod.percentage}%` }}
                  className="h-full bg-[#FF8A00] rounded-full transition-all duration-500"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-bold text-gray-700 mb-1.5">
                <span>Online / UPI ({payments.online.count} orders)</span>
                <span>₹{payments.online.revenue.toLocaleString("en-IN")} ({payments.online.percentage}%)</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-gray-100 overflow-hidden">
                <div
                  style={{ width: `${payments.online.percentage}%` }}
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                />
              </div>
            </div>
          </div>
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
