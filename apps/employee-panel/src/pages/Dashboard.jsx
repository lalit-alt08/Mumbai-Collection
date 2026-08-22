import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Package,
  Truck,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Boxes,
  ArrowRight,
  Clock,
  ChevronRight,
  Eye,
  ShoppingBag,
  MapPin,
  Phone,
  Radio,
  Check,
  Send,
} from "lucide-react";
import { getOverview, updateOrderStatus } from "../services/employeeApi.js";

function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);

  const isFetchingRef = useRef(false);
  const pollTimerRef = useRef(null);

  // Authenticated Overview Fetcher
  const fetchOverview = async (isBackground = false) => {
    if (isFetchingRef.current) return;

    try {
      isFetchingRef.current = true;
      if (!isBackground) {
        setLoading(true);
        setError(null);
      }
      const res = await getOverview();
      if (res && res.success) {
        setData(res.data || res);
        setError(null);
      } else if (!isBackground) {
        setError(res?.message || "Failed to load operations dashboard.");
      }
    } catch (err) {
      if (!isBackground) {
        setError(err.response?.data?.message || err.message || "Network error loading operations dashboard.");
      }
    } finally {
      isFetchingRef.current = false;
      if (!isBackground) {
        setLoading(false);
      }
    }
  };

  // Initial load + 6s live background polling
  useEffect(() => {
    fetchOverview(false);

    pollTimerRef.current = setInterval(() => {
      fetchOverview(true);
    }, 6000);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  // 1-Click Operational Status Transition
  const handleQuickStatusUpdate = async (orderId, newStatus) => {
    try {
      setUpdatingId(orderId);
      await updateOrderStatus(orderId, newStatus);
      await fetchOverview(true);
    } catch (err) {
      alert(err.response?.data?.message || "Failed to update order status.");
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            Loading Operations Console...
          </p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-700">
        <p className="font-bold text-sm">{error}</p>
        <button
          onClick={() => fetchOverview(false)}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 transition cursor-pointer"
        >
          <RotateCcw size={14} /> Try Again
        </button>
      </div>
    );
  }

  const overviewData = data?.data || data || {};
  const summary = overviewData?.summary || {};
  const ordersNeedingAction = overviewData?.ordersNeedingAction || overviewData?.recentOrders || [];
  const lowStockProducts = overviewData?.lowStockProducts || [];

  const ordersToPackCount = summary.ordersToPack ?? 0;
  const ordersOutForDeliveryCount = summary.ordersOutForDelivery ?? 0;
  const completedTodayCount = summary.completedToday ?? 0;
  const lowStockCount = summary.lowStockCount ?? 0;

  const ordersPackedCount = summary.ordersPacked ?? 0;
  const receivedTodayCount = summary.receivedToday ?? 0;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* 4 TOP OPERATIONAL CURRENT-STATE CARDS */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* CARD 1: ORDERS TO PACK (Primary Emphasis) */}
        <div className="relative overflow-hidden rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50/80 via-white to-amber-50/30 p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-amber-900">
              Orders to Pack
            </span>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm">
              <Package size={20} />
            </div>
          </div>
          <p className="mt-3 text-3xl sm:text-4xl font-black tracking-tight text-gray-900">
            {ordersToPackCount}
          </p>
          <div className="mt-3 flex items-center justify-between pt-2 border-t border-amber-200/60">
            <span className="text-xs font-bold text-amber-700">
              Need fulfillment
            </span>
            <Link
              to="/orders?status=processing"
              className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-extrabold text-white hover:bg-amber-700 transition"
            >
              PACK NOW <ChevronRight size={13} />
            </Link>
          </div>
        </div>

        {/* CARD 2: OUT FOR DELIVERY */}
        <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Out for Delivery
            </span>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Truck size={20} />
            </div>
          </div>
          <p className="mt-3 text-3xl sm:text-4xl font-black tracking-tight text-gray-900">
            {ordersOutForDeliveryCount}
          </p>
          <div className="mt-3 flex items-center justify-between pt-2 border-t border-gray-100">
            <span className="text-xs font-medium text-blue-600">
              Currently on the road
            </span>
            <Link
              to="/orders?status=out-for-delivery"
              className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-0.5"
            >
              VIEW DISPATCH <ChevronRight size={12} />
            </Link>
          </div>
        </div>

        {/* CARD 3: COMPLETED TODAY */}
        <div className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Completed Today
            </span>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <CheckCircle2 size={20} />
            </div>
          </div>
          <p className="mt-3 text-3xl sm:text-4xl font-black tracking-tight text-gray-900">
            {completedTodayCount}
          </p>
          <div className="mt-3 flex items-center justify-between pt-2 border-t border-gray-100">
            <span className="text-xs font-medium text-emerald-600">
              Successfully delivered today
            </span>
            <Link
              to="/orders?status=completed"
              className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-0.5"
            >
              VIEW TODAY <ChevronRight size={12} />
            </Link>
          </div>
        </div>

        {/* CARD 4: STOCK ACTIONS */}
        <div className="rounded-2xl border border-rose-100 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Stock Actions
            </span>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <AlertTriangle size={20} />
            </div>
          </div>
          <p className="mt-3 text-3xl sm:text-4xl font-black tracking-tight text-rose-600">
            {lowStockCount}
          </p>
          <div className="mt-3 flex items-center justify-between pt-2 border-t border-gray-100">
            <span className="text-xs font-medium text-rose-600">
              Needs stock update
            </span>
            <Link
              to="/products?stock_status=outofstock"
              className="text-xs font-bold text-rose-600 hover:text-rose-700 flex items-center gap-0.5"
            >
              UPDATE STOCK <ChevronRight size={12} />
            </Link>
          </div>
        </div>
      </div>

      {/* TODAY'S WORK SUMMARY BAR */}
      <div className="rounded-2xl bg-white p-4 border border-gray-200 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2 font-black uppercase tracking-wider text-gray-500">
            <Clock size={14} className="text-[#7C3AED]" /> Today's Workload:
          </div>

          <div className="flex flex-wrap items-center gap-3 sm:gap-6 font-semibold text-gray-700">
            <div>
              <span className="text-gray-400">Received Today: </span>
              <span className="font-bold text-gray-900">{receivedTodayCount}</span>
            </div>
            <div className="hidden sm:block text-gray-300">|</div>
            <div>
              <span className="text-amber-600">To Pack: </span>
              <span className="font-bold text-amber-700">{ordersToPackCount}</span>
            </div>
            <div className="hidden sm:block text-gray-300">|</div>
            <div>
              <span className="text-purple-600">Packed: </span>
              <span className="font-bold text-purple-700">{ordersPackedCount}</span>
            </div>
            <div className="hidden sm:block text-gray-300">|</div>
            <div>
              <span className="text-blue-600">Out for Delivery: </span>
              <span className="font-bold text-blue-700">{ordersOutForDeliveryCount}</span>
            </div>
            <div className="hidden sm:block text-gray-300">|</div>
            <div>
              <span className="text-emerald-600">Delivered Today: </span>
              <span className="font-bold text-emerald-700">{completedTodayCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN TASK FORCE WORKSPACE: Orders Needing Action & Stock Actions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* PRIMARY SECTION: Orders Needing Action (2 Columns) */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 shadow-sm lg:col-span-2 flex flex-col">
          <div className="flex items-center justify-between border-b border-gray-100 pb-4 mb-4">
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-tight text-gray-900 flex items-center gap-2">
                Orders Needing Action
                <span className="rounded-full bg-[#7C3AED]/10 px-2.5 py-0.5 text-xs font-bold text-[#7C3AED]">
                  {ordersNeedingAction.filter(o => ["processing", "packed", "out-for-delivery", "dispatched"].includes(o.status)).length} Active
                </span>
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Process today's incoming orders and hand over to dispatch riders
              </p>
            </div>

            <Link
              to="/orders"
              className="inline-flex items-center gap-1 text-xs font-bold text-[#7C3AED] hover:text-purple-700"
            >
              All Orders <ArrowRight size={13} />
            </Link>
          </div>

          {ordersNeedingAction.length === 0 ? (
            <div className="py-16 text-center my-auto">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <CheckCircle2 size={28} />
              </div>
              <h3 className="text-sm font-bold text-gray-900">You're all caught up!</h3>
              <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
                No orders waiting for fulfillment or packing right now. New incoming customer orders will appear here automatically.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 space-y-2 overflow-y-auto max-h-[600px] pr-1">
              {ordersNeedingAction.map((order) => {
                const status = order.status;
                const isProcessing = status === "processing" || status === "pending" || status === "on-hold";
                const isPacked = status === "packed";
                const isOutForDelivery = status === "out-for-delivery" || status === "dispatched";
                const isUpdating = updatingId === order.id;

                return (
                  <div
                    key={order.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between py-4 gap-4 rounded-xl px-3 transition hover:bg-gray-50/80"
                  >
                    {/* Order Details */}
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 font-black text-sm text-slate-800 border border-slate-200">
                        #{order.order_number || order.id}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-gray-900 truncate">
                            {order.customer_name || "Customer"}
                          </p>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-extrabold capitalize ${
                              status === "completed"
                                ? "bg-emerald-100 text-emerald-800"
                                : status === "processing" || status === "pending"
                                ? "bg-amber-100 text-amber-800"
                                : status === "packed"
                                ? "bg-purple-100 text-purple-800"
                                : status === "out-for-delivery" || status === "dispatched"
                                ? "bg-blue-100 text-blue-800"
                                : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {status === "processing"
                              ? "To Pack"
                              : status === "packed"
                              ? "Packed"
                              : status === "out-for-delivery" || status === "dispatched"
                              ? "Out For Delivery"
                              : status}
                          </span>
                        </div>

                        <p className="text-xs text-gray-500 mt-1">
                          {order.items_count || 1} item(s) · <span className="font-bold text-gray-900">₹{order.total || 0}</span>
                          {order.phone ? ` · ${order.phone}` : ""}
                        </p>

                        {order.delivery_address && (
                          <p className="text-[11px] text-gray-400 mt-0.5 truncate flex items-center gap-1">
                            <MapPin size={11} className="shrink-0 text-gray-400" />
                            {order.delivery_address}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* PROMINENT OPERATIONAL 1-CLICK ACTION BUTTONS (42-46px height) */}
                    <div className="flex items-center gap-2 self-stretch sm:self-center shrink-0">
                      {isProcessing && (
                        <button
                          onClick={() => handleQuickStatusUpdate(order.id, "packed")}
                          disabled={isUpdating}
                          className="flex-1 sm:flex-none flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-purple-600 text-white font-extrabold text-xs shadow-sm hover:bg-purple-500 active:scale-95 transition cursor-pointer disabled:opacity-50"
                        >
                          <Package size={16} />
                          PACK NOW →
                        </button>
                      )}

                      {isPacked && (
                        <button
                          onClick={() => handleQuickStatusUpdate(order.id, "out-for-delivery")}
                          disabled={isUpdating}
                          className="flex-1 sm:flex-none flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-blue-600 text-white font-extrabold text-xs shadow-sm hover:bg-blue-500 active:scale-95 transition cursor-pointer disabled:opacity-50"
                        >
                          <Truck size={16} />
                          DISPATCH →
                        </button>
                      )}

                      {isOutForDelivery && (
                        <button
                          onClick={() => handleQuickStatusUpdate(order.id, "completed")}
                          disabled={isUpdating}
                          className="flex-1 sm:flex-none flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-emerald-600 text-white font-extrabold text-xs shadow-sm hover:bg-emerald-500 active:scale-95 transition cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle2 size={16} />
                          MARK DELIVERED
                        </button>
                      )}

                      {status === "completed" && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 px-3 py-2">
                          <Check size={14} /> Completed
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* SIDEBAR: Stock Actions (1 Column) */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 shadow-sm flex flex-col">
          <div className="flex items-center justify-between border-b border-gray-100 pb-4 mb-4">
            <div>
              <h2 className="text-base font-black tracking-tight text-gray-900 flex items-center gap-1.5">
                <AlertTriangle size={16} className="text-rose-500" />
                Stock Actions
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Products needing inventory replenishment
              </p>
            </div>
            <Link
              to="/products"
              className="text-xs font-bold text-[#7C3AED] hover:text-purple-700"
            >
              Inventory <ArrowRight size={13} className="inline" />
            </Link>
          </div>

          <div className="flex-1 divide-y divide-gray-100 overflow-y-auto max-h-[460px]">
            {lowStockProducts.length === 0 ? (
              <div className="py-12 text-center my-auto">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <CheckCircle2 size={20} />
                </div>
                <p className="text-xs text-emerald-700 font-bold">
                  ✓ All stock levels are healthy
                </p>
              </div>
            ) : (
              lowStockProducts.map((product) => (
                <div key={product.id} className="flex items-center justify-between py-3 gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={product.image || "https://placehold.co/40x40?text=Item"}
                      alt={product.name}
                      className="h-10 w-10 rounded-lg object-cover bg-gray-100 border border-gray-200 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-gray-900 truncate">
                        {product.name}
                      </p>
                      <p className="text-[11px] text-gray-500">
                        ₹{product.price || 0}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        (product.stock_quantity ?? 0) <= 0
                          ? "bg-rose-100 text-rose-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {(product.stock_quantity ?? 0) <= 0 ? "Out of Stock" : `${product.stock_quantity} left`}
                    </span>
                    <Link
                      to={`/products`}
                      className="text-[11px] font-bold text-rose-600 hover:text-rose-700"
                    >
                      Update Stock →
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-gray-100">
            <Link
              to="/products"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-100 px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-200 transition"
            >
              <Boxes size={14} />
              Open Stock Manager
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
