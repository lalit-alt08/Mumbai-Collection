import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ShoppingBag,
  Package,
  Truck,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  MapPin,
  Receipt,
  AlertCircle,
} from "lucide-react";
import { getMyOrders } from "../services/orderService";
import { useAuth } from "../context/AuthContext";

function Orders() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [expandedOrderId, setExpandedOrderId] = useState(null);

  const [page, setPage] = useState(1);
  const [totalOrders, setTotalOrders] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const hasMore = page < totalPages;
  const userEmail = user?.email || "";

  const fetchOrders = async (targetPage = 1, isLoadMore = false) => {
    try {
      if (isLoadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError("");
      }

      const data = await getMyOrders({ page: targetPage, per_page: 10, email: userEmail });

      if (data.success && Array.isArray(data.orders)) {
        if (isLoadMore) {
          setOrders((prev) => {
            const existingIds = new Set(prev.map((o) => o.id));
            const newUnique = data.orders.filter((o) => !existingIds.has(o.id));
            const merged = [...prev, ...newUnique];
            // Preserve newest orders first
            merged.sort((a, b) => new Date(b.date_created) - new Date(a.date_created));
            return merged;
          });
        } else {
          setOrders(data.orders);
        }

        setPage(data.page || targetPage);
        setTotalOrders(data.total !== undefined ? data.total : (isLoadMore ? orders.length + data.orders.length : data.orders.length));
        setTotalPages(data.totalPages || 1);
      } else {
        if (!isLoadMore) {
          setOrders([]);
          setTotalOrders(0);
          setTotalPages(1);
        }
      }
    } catch (err) {
      if (!isLoadMore) {
        setError("Unable to load your orders right now. Please try again.");
      }
    } finally {
      if (isLoadMore) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchOrders(1, false);
  }, [userEmail]);

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      fetchOrders(page + 1, true);
    }
  };

  const toggleExpandOrder = (id) => {
    setExpandedOrderId((prev) => (prev === id ? null : id));
  };

  const getStatusBadge = (status, displayStatus) => {
    switch (status) {
      case "completed":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
            <CheckCircle2 size={13} />
            {displayStatus || "Delivered"}
          </span>
        );
      case "processing":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 border border-blue-200">
            <Package size={13} className="animate-pulse" />
            {displayStatus || "Preparing & Packing"}
          </span>
        );
      case "packed":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-3 py-1 text-xs font-bold text-purple-700 border border-purple-200">
            <Package size={13} />
            {displayStatus || "Packed & Ready"}
          </span>
        );
      case "out-for-delivery":
      case "dispatched":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F1ECFF] px-3 py-1 text-xs font-bold text-[#7C3AED] border border-[#C4B5FD]">
            <Truck size={13} className="animate-bounce" />
            {displayStatus || "Out for Delivery"}
          </span>
        );
      case "cancelled":
      case "failed":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700 border border-rose-200">
            <AlertCircle size={13} />
            {displayStatus || "Cancelled"}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 border border-amber-200">
            <Clock size={13} />
            {displayStatus || "Order Placed"}
          </span>
        );
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F7FB] px-4 pt-6 pb-28 sm:pb-24 md:pt-10 md:pb-16">
      <div className="mx-auto max-w-4xl">
        {/* Top Header Bar */}
        <div className="mb-4 sm:mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/account")}
              aria-label="Back to Account"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#1F2937] shadow-xs border border-gray-200 transition-all hover:border-[#7C3AED]/40 hover:bg-[#F5F3FF] hover:text-[#7C3AED] active:scale-95 cursor-pointer"
            >
              <ArrowLeft size={17} strokeWidth={2.4} />
            </button>
            <h1 className="text-xl font-extrabold tracking-tight text-[#111827] sm:text-2xl">
              My Orders
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="flex h-9 items-center rounded-full bg-[#7C3AED] px-4 py-1.5 text-xs font-extrabold text-white shadow-xs transition-all hover:bg-[#6C35E8] active:scale-95 cursor-pointer"
            >
              Shop More
            </Link>
          </div>
        </div>

        {/* Loading Skeletons */}
        {loading && (
          <div className="space-y-4">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="animate-pulse rounded-[24px] bg-white p-6 shadow-sm"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div className="h-5 w-32 rounded-lg bg-gray-200" />
                  <div className="h-6 w-24 rounded-full bg-gray-200" />
                </div>
                <div className="flex gap-4">
                  <div className="h-16 w-16 rounded-xl bg-gray-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 rounded bg-gray-200" />
                    <div className="h-4 w-1/2 rounded bg-gray-200" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="rounded-[24px] border border-red-100 bg-red-50 p-6 text-center text-red-600 shadow-sm">
            <p className="font-semibold">{error}</p>
            <button
              onClick={fetchOrders}
              className="mt-3 rounded-full bg-red-600 px-5 py-2 text-xs font-bold text-white transition hover:bg-red-700"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && orders.length === 0 && (
          <div className="rounded-[28px] bg-white p-10 text-center shadow-[0_8px_30px_rgba(0,0,0,0.03)] md:p-16">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[#F1ECFF] text-[#7C3AED]">
              <ShoppingBag size={38} />
            </div>

            <h2 className="text-xl font-bold text-[#1E1E1E]">
              No Orders Found
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-gray-500 leading-relaxed">
              Looks like you haven't placed any orders yet. Discover our premium stationery, art supplies, and toys!
            </p>

            <div className="mt-8 flex justify-center gap-3">
              <Link
                to="/"
                className="rounded-full bg-[#7C3AED] px-8 py-3.5 text-sm font-bold text-white shadow-[0_4px_20px_rgba(124,58,237,0.25)] transition hover:bg-[#6C35E8] active:scale-95"
              >
                Start Shopping &rarr;
              </Link>
            </div>
          </div>
        )}

        {/* Orders List (Blinkit / Zepto style cards) */}
        {!loading && !error && orders.length > 0 && (
          <div className="space-y-5">
            {orders.map((order) => {
              const isExpanded = expandedOrderId === order.id;
              const isLive = ["pending", "processing", "on-hold", "out-for-delivery", "dispatched"].includes(
                order.status
              );

              return (
                <div
                  key={order.id}
                  className="overflow-hidden rounded-[26px] bg-white shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100 transition-all hover:shadow-[0_12px_40px_rgba(0,0,0,0.07)]"
                >
                  {/* Order Card Header */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/60 px-5 py-4 sm:px-6">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-gray-700 shadow-sm border border-gray-200/80">
                        <Package size={17} />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                          Order #{order.order_number}
                        </span>
                        <div className="text-xs text-gray-500 font-medium">
                          {formatDate(order.date_created)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {getStatusBadge(order.status, order.display_status)}
                    </div>
                  </div>

                  {/* Live Progress Bar (Blinkit / Zepto style) */}
                  {isLive && order.tracking_stage > 0 && (
                    <div className="border-b border-[#C4B5FD]/40 bg-[#F1ECFF]/40 px-5 py-4 sm:px-6">
                      <div className="mb-2 flex items-center justify-between text-xs font-bold">
                        <span className="flex items-center gap-1.5 text-[#7C3AED]">
                          <Truck size={15} className="animate-pulse" />
                          Delivery in 20-30 mins (Vasai Store Dispatch)
                        </span>
                        <span className="text-gray-500 font-medium">Stage {order.tracking_stage} of 4</span>
                      </div>

                      {/* 4-Step Progress Indicator */}
                      <div className="grid grid-cols-4 gap-2 pt-1">
                        {[
                          { label: "Placed", stage: 1 },
                          { label: "Packing", stage: 2 },
                          { label: "On the Way", stage: 3 },
                          { label: "Delivered", stage: 4 },
                        ].map((step) => {
                          const isDone = order.tracking_stage >= step.stage;
                          const isCurrent = order.tracking_stage === step.stage;

                          return (
                            <div key={step.stage} className="flex flex-col gap-1.5">
                              <div
                                className={`h-1.5 w-full rounded-full transition-all duration-500 ${
                                  isDone
                                    ? "bg-[#7C3AED]"
                                    : "bg-gray-200"
                                } ${isCurrent ? "animate-pulse" : ""}`}
                              />
                              <span
                                className={`text-[10px] font-semibold text-center ${
                                  isDone ? "text-[#7C3AED]" : "text-gray-400"
                                }`}
                              >
                                {step.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Items Preview */}
                  <div className="p-5 sm:p-6">
                    <div className="space-y-3">
                      {order.line_items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-4"
                        >
                          <div className="flex items-center gap-3.5">
                            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-100 bg-white p-1 shadow-sm">
                              {item.image ? (
                                <img
                                  src={item.image}
                                  alt={item.name}
                                  loading="lazy"
                                  className="h-full w-full object-contain"
                                />
                              ) : (
                                <Package size={22} className="text-gray-300" />
                              )}
                            </div>
                            <div>
                              <h3 className="line-clamp-1 text-sm font-bold text-[#1E1E1E]">
                                {item.name}
                              </h3>
                              <div className="text-xs text-gray-500 font-medium">
                                Qty: <span className="font-bold text-gray-800">{item.quantity}</span> × ₹{item.price || (Number(item.total) / (item.quantity || 1)).toFixed(0)}
                              </div>
                            </div>
                          </div>

                          <div className="text-right">
                            <span className="text-sm font-extrabold text-[#1E1E1E]">
                              ₹{item.total}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Summary Footer Bar */}
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-gray-100 pt-4">
                      <div className="flex items-center gap-4">
                        <div>
                          <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                            Total Paid ({order.payment_method_title})
                          </span>
                          <div className="text-lg font-black text-[#1E1E1E]">
                            ₹{order.total}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <button
                          onClick={() => toggleExpandOrder(order.id)}
                          className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-50"
                        >
                          <Receipt size={14} />
                          {isExpanded ? "Hide Details" : "Invoice Details"}
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>

                        {!["cancelled", "failed", "refunded"].includes(order.status) && (
                          <Link
                            to={`/orders/${order.id}/track`}
                            className="flex items-center gap-1.5 rounded-xl bg-[#F1ECFF] px-4 py-2 text-xs font-bold text-[#7C3AED] transition hover:bg-[#E0D4FC]"
                          >
                            <Truck size={14} />
                            Track Live
                          </Link>
                        )}
                      </div>
                    </div>

                    {/* Expandable Full Bill & Address Details */}
                    {isExpanded && (
                      <div className="mt-5 rounded-2xl bg-gray-50 p-4 sm:p-5 border border-gray-100 space-y-4 animate-in fade-in duration-200">
                        {/* Delivery Address */}
                        <div>
                          <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                            <MapPin size={13} className="text-[#7C3AED]" />
                            Delivery Address
                          </h4>
                          <p className="text-xs text-gray-700 font-medium leading-relaxed">
                            <span className="font-bold text-gray-900">
                              {(() => {
                                const f = (order.shipping?.first_name || order.billing?.first_name || "").trim();
                                const l = (order.shipping?.last_name || order.billing?.last_name || "").trim();
                                if (!f && !l) return "Customer";
                                if (!l) return f;
                                if (!f) return l;
                                if (f.toLowerCase() === l.toLowerCase()) return f;
                                return `${f} ${l}`;
                              })()}
                            </span>
                            <br />
                            {order.shipping?.address_1 || order.billing?.address_1}
                            {order.shipping?.address_2 ? `, ${order.shipping.address_2}` : order.billing?.address_2 ? `, ${order.billing.address_2}` : ""}, {order.shipping?.city || order.billing?.city}, {order.shipping?.state || order.billing?.state} - {order.shipping?.postcode || order.billing?.postcode}
                            <br />
                            Phone: {order.billing?.phone || "Not specified"}
                          </p>
                        </div>

                        {/* Itemized Bill Details */}
                        <div className="border-t border-gray-200/80 pt-3 space-y-1.5 text-xs text-gray-600">
                          <div className="flex justify-between">
                            <span>Items Subtotal</span>
                            <span className="font-semibold text-gray-800">
                              ₹{(Number(order.total) - Number(order.shipping_total) + Number(order.discount_total)).toFixed(2)}
                            </span>
                          </div>
                          {Number(order.discount_total) > 0 && (
                            <div className="flex justify-between text-emerald-700 font-semibold">
                              <span>Order Discount</span>
                              <span>-₹{order.discount_total}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span>Delivery Fee</span>
                            <span className="font-semibold text-gray-800">
                              {Number(order.shipping_total) === 0 ? "FREE" : `₹${order.shipping_total}`}
                            </span>
                          </div>
                          {Number(order.total_tax) > 0 && (
                            <div className="flex justify-between">
                              <span>Taxes</span>
                              <span className="font-semibold text-gray-800">₹{order.total_tax}</span>
                            </div>
                          )}
                          <div className="flex justify-between border-t border-gray-200/80 pt-2 text-sm font-bold text-gray-900">
                            <span>Grand Total</span>
                            <span>₹{order.total}</span>
                          </div>
                        </div>

                        {/* Customer Support CTA */}
                        <div className="flex items-center justify-between border-t border-gray-200/80 pt-3 text-xs">
                          <span className="text-gray-500 font-medium">Have an issue with this order?</span>
                          <Link
                            to="/contact"
                            className="flex items-center gap-1 font-bold text-[#7C3AED] hover:underline"
                          >
                            <HelpCircle size={13} />
                            Get Help & Support
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Compact Load More Orders Button */}
        {!loading && !error && hasMore && (
          <div className="pt-6 pb-2 text-center">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-6 py-2.5 text-xs font-bold text-gray-700 shadow-xs transition-all hover:bg-gray-50 hover:border-gray-300 active:scale-95 disabled:opacity-60 cursor-pointer"
            >
              {loadingMore ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#7C3AED] border-t-transparent" />
                  <span>Loading older orders...</span>
                </>
              ) : (
                <>
                  <span>Load More Orders</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-extrabold text-gray-500">
                    {orders.length} of {totalOrders}
                  </span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Orders;
