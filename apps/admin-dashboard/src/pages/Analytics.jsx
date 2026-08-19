import { useEffect, useState } from "react";
import { TrendingUp, IndianRupee, ShoppingBag, CheckCircle2, RotateCcw, PieChart, BarChart3, Award } from "lucide-react";
import { getOverview } from "../services/adminApi";

function Analytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const res = await getOverview();
      if (res.success) {
        setData(res.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-gray-200" />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-32 animate-pulse rounded-2xl bg-white p-6 shadow-sm" />
          ))}
        </div>
      </div>
    );
  }

  const { summary, salesTrend, recentOrders } = data;

  const codOrders = recentOrders.filter((o) =>
    o.payment_method.toLowerCase().includes("cash") || o.payment_method.toLowerCase().includes("cod")
  ).length;
  const prepaidOrders = Math.max(0, recentOrders.length - codOrders);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 md:text-3xl">
            Store Sales Analytics & Reports
          </h1>
          <p className="text-xs font-medium text-gray-500 mt-1">
            Revenue velocity, average order values, and fulfillment efficiency for Vasai store
          </p>
        </div>

        <button
          onClick={fetchAnalytics}
          className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold text-gray-700 shadow-sm transition hover:bg-gray-50"
        >
          <RotateCcw size={14} /> Refresh
        </button>
      </div>

      {/* 3 Executive Analytics Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
              Total Store Volume
            </span>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <IndianRupee size={20} />
            </div>
          </div>
          <div className="mt-4 text-3xl font-black text-gray-900">
            ₹{summary.totalRevenue.toLocaleString("en-IN")}
          </div>
          <p className="mt-2 text-xs font-medium text-gray-500">
            Across {summary.totalOrders} total platform transactions
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
              Average Order Value (AOV)
            </span>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-[#FF8A00]">
              <TrendingUp size={20} />
            </div>
          </div>
          <div className="mt-4 text-3xl font-black text-gray-900">
            ₹{summary.avgOrderValue.toLocaleString("en-IN")}
          </div>
          <p className="mt-2 text-xs font-medium text-gray-500">
            Target per customer basket size in Vasai
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
              Fulfillment Success Rate
            </span>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <CheckCircle2 size={20} />
            </div>
          </div>
          <div className="mt-4 text-3xl font-black text-gray-900">
            {summary.totalOrders > 0
              ? `${Math.round((summary.completedOrders / summary.totalOrders) * 100)}%`
              : "100%"}
          </div>
          <p className="mt-2 text-xs font-medium text-emerald-600 font-bold">
            {summary.completedOrders} orders delivered successfully
          </p>
        </div>
      </div>

      {/* Payment Split & Operations Widget */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Payment Methods */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 space-y-4">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <PieChart size={18} className="text-[#FF8A00]" /> Payment Method Breakdown
          </h3>

          <div className="space-y-3 pt-2">
            <div>
              <div className="flex justify-between text-xs font-bold text-gray-700 mb-1">
                <span>Cash on Delivery (COD)</span>
                <span>{Math.round((codOrders / Math.max(1, recentOrders.length)) * 100)}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                <div
                  style={{ width: `${(codOrders / Math.max(1, recentOrders.length)) * 100}%` }}
                  className="h-full bg-[#FF8A00] rounded-full"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-bold text-gray-700 mb-1">
                <span>Online Payments / UPI</span>
                <span>{Math.round((prepaidOrders / Math.max(1, recentOrders.length)) * 100)}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                <div
                  style={{ width: `${(prepaidOrders / Math.max(1, recentOrders.length)) * 100}%` }}
                  className="h-full bg-emerald-500 rounded-full"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Operational Highlights */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 space-y-4">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Award size={18} className="text-emerald-600" /> Vasai Store Operations
          </h3>

          <div className="rounded-xl bg-gray-50 p-4 border border-gray-100 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Average Local Delivery Speed</span>
              <span className="font-bold text-gray-900">20-30 Mins (Vasai West)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Total Catalog SKU Count</span>
              <span className="font-bold text-gray-900">{summary.totalProducts} Products Active</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Free Shipping Threshold</span>
              <span className="font-bold text-[#FF8A00]">₹499 (Standard)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Analytics;
