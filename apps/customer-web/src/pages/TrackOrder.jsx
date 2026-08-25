import { useState, useEffect, useRef } from "react";
import { Link, useParams, useSearchParams, useNavigate } from "react-router-dom";
import {
  Search,
  Package,
  MapPin,
  CheckCircle2,
  Clock,
  ArrowLeft,
  Truck,
  AlertCircle,
  Loader2,
  RefreshCw,
  ShoppingBag,
  Phone,
  CreditCard,
  Check,
  ChevronRight,
  HelpCircle,
  Store,
} from "lucide-react";
import { getOrderById } from "../services/orderService";

function TrackOrder() {
  const { orderId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const urlOrderId = orderId || searchParams.get("id") || "";

  const [orderInput, setOrderInput] = useState(urlOrderId);
  const [activeOrderId, setActiveOrderId] = useState(urlOrderId);
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isPolling, setIsPolling] = useState(false);

  const pollTimerRef = useRef(null);

  // Sync state if URL param or query param changes
  useEffect(() => {
    if (urlOrderId) {
      setOrderInput(urlOrderId);
      setActiveOrderId(urlOrderId);
    }
  }, [urlOrderId]);

  // Fetch Order Details
  const fetchOrder = async (idToFetch, isBackground = false) => {
    if (!idToFetch) return;

    try {
      if (!isBackground) {
        setLoading(true);
        setError("");
      }

      const res = await getOrderById(idToFetch);

      if (res?.success && res?.order) {
        setOrder(res.order);
        setError("");
      } else {
        setError(res?.message || "Order not found.");
        setOrder(null);
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 403) {
        setError("You are not authorized to view this order. Please log in to the account that placed this order.");
      } else if (status === 404) {
        setError(`Order #${idToFetch} could not be found.`);
      } else if (status === 401) {
        setError("Please log in to track your orders.");
      } else {
        if (!isBackground) {
          setError(err.response?.data?.message || err.message || "Failed to retrieve order tracking information.");
        }
      }
      if (!isBackground) {
        setOrder(null);
      }
    } finally {
      if (!isBackground) {
        setLoading(false);
      }
    }
  };

  // Initial fetch on activeOrderId change
  useEffect(() => {
    if (activeOrderId) {
      fetchOrder(activeOrderId, false);
    }
  }, [activeOrderId]);

  // Lightweight Polling (every 5 seconds while order is actively being fulfilled)
  useEffect(() => {
    if (!activeOrderId || !order) return;

    const isTerminalState =
      order.status === "completed" ||
      order.status === "cancelled" ||
      order.status === "refunded" ||
      order.status === "failed";

    if (isTerminalState) {
      setIsPolling(false);
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    setIsPolling(true);
    pollTimerRef.current = setInterval(() => {
      fetchOrder(activeOrderId, true);
    }, 5000);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [activeOrderId, order?.status]);

  const handleSearch = (e) => {
    e.preventDefault();
    const cleanId = orderInput.trim().replace(/\D/g, "");
    if (!cleanId) return;

    if (orderId) {
      navigate(`/orders/${cleanId}/track`);
    } else {
      setSearchParams({ id: cleanId });
    }
    setActiveOrderId(cleanId);
  };

  const handleBack = () => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate("/account/orders", { replace: true });
    }
  };

  const formatDateTime = (dateString) => {
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

  const getStepStatus = (stepStage, currentStage, orderStatus) => {
    if (orderStatus === "cancelled" || orderStatus === "failed" || orderStatus === "refunded") {
      return "cancelled";
    }
    if (orderStatus === "completed" || currentStage >= 4) {
      return "completed";
    }
    if (currentStage > stepStage) return "completed";
    if (currentStage === stepStage) return "active";
    return "pending";
  };

  const trackingSteps = [
    {
      stage: 1,
      title: "Order Placed",
      subtitle: "Order verified & confirmed",
      icon: CheckCircle2,
    },
    {
      stage: 2,
      title: "Packing",
      subtitle: "Quality check at Vasai Store",
      icon: Package,
    },
    {
      stage: 3,
      title: "Out for Delivery",
      subtitle: "Local delivery rider dispatched",
      icon: Truck,
    },
    {
      stage: 4,
      title: "Delivered",
      subtitle: order?.date_completed ? `Delivered on ${formatDateTime(order.date_completed)}` : "Handed over to recipient",
      icon: MapPin,
    },
  ];

  const isCancelled = order?.status === "cancelled" || order?.status === "failed" || order?.status === "refunded";
  const isDelivered = order?.status === "completed";

  return (
    <div className="min-h-screen bg-[#F7F7FB] text-[#1F2937] pb-12">
      {/* ────────────────────────────────────────────────────────── */}
      {/* COMPACT DEDICATED TRACKING HEADER (DESKTOP & MOBILE)     */}
      {/* ────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-gray-200/80 bg-white/95 px-4 backdrop-blur-md sm:px-6 lg:px-8">
        <div className="mx-auto flex h-14 max-w-[1060px] items-center justify-between gap-3">
          {/* Back Action */}
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 rounded-full bg-gray-100/80 px-3 py-1.5 text-xs font-bold text-gray-700 transition hover:bg-[#F1ECFF] hover:text-[#7C3AED] active:scale-95 cursor-pointer"
          >
            <ArrowLeft size={15} />
            <span className="hidden sm:inline">Back to My Orders</span>
            <span className="sm:hidden">My Orders</span>
          </button>

          {/* Right Status Badge / Live Sync Indicator */}
          <div className="flex items-center gap-2.5">
            {isPolling && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 border border-emerald-200/60">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                Live Sync
              </span>
            )}

            {order ? (
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-extrabold text-gray-900 border border-gray-200">
                Order #{order.order_number || order.id}
              </span>
            ) : (
              <span className="text-xs font-extrabold text-gray-500">Live Order Tracking</span>
            )}
          </div>
        </div>
      </header>

      {/* ────────────────────────────────────────────────────────── */}
      {/* MAIN TRACKING WORKSPACE                                   */}
      {/* ────────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-[1060px] px-3 pt-4 sm:px-6 sm:pt-6">
        {/* Search input when no order is specified in route */}
        {!urlOrderId && (
          <div className="mx-auto mb-6 max-w-md rounded-2xl bg-white p-5 border border-gray-200/70 shadow-sm">
            <h2 className="text-base font-extrabold text-gray-900 mb-1">Track Your Order</h2>
            <p className="text-xs text-gray-500 mb-4">Enter your Mumbai Collection numeric order reference ID.</p>
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">#</span>
                <input
                  type="text"
                  required
                  value={orderInput}
                  onChange={(e) => setOrderInput(e.target.value.replace(/\D/g, ""))}
                  placeholder="e.g. 95"
                  className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 pl-7 pr-3 text-xs font-bold text-gray-900 outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-2 focus:ring-[#7C3AED]/10"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#7C3AED] px-4 text-xs font-bold text-white shadow-sm transition hover:bg-[#6C35E8] active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Track
              </button>
            </form>
          </div>
        )}

        {/* Loading Spinner */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500 gap-3">
            <Loader2 size={32} className="animate-spin text-[#7C3AED]" />
            <p className="text-xs font-bold text-gray-600">Connecting to Mumbai Collection live dispatch...</p>
          </div>
        )}

        {/* Error Notification */}
        {error && !loading && (
          <div className="mx-auto max-w-lg rounded-2xl border border-rose-200 bg-rose-50/90 p-5 text-rose-800 shadow-sm space-y-2">
            <div className="flex items-center gap-2 font-bold text-sm">
              <AlertCircle size={18} className="shrink-0 text-rose-600" />
              Unable to Retrieve Tracking Details
            </div>
            <p className="text-xs text-rose-700 leading-relaxed">{error}</p>
            <div className="pt-2">
              <Link
                to="/account/orders"
                className="inline-flex items-center gap-1 text-xs font-bold text-rose-800 hover:underline"
              >
                &larr; View all your active orders
              </Link>
            </div>
          </div>
        )}

        {/* ────────────────────────────────────────────────────────── */}
        {/* ORDER DETAILS & TIMELINE CONTENT                           */}
        {/* ────────────────────────────────────────────────────────── */}
        {order && !loading && (
          <div className="space-y-4 sm:space-y-5 animate-in fade-in duration-200">
            {/* 1. TOP SUMMARY CARD & FULFILLMENT TIMELINE */}
            <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] sm:p-6">
              {/* Header Details */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-lg font-black text-gray-900 sm:text-xl">
                      Order #{order.order_number || order.id}
                    </h1>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${
                        isDelivered
                          ? "bg-emerald-100 text-emerald-800"
                          : order.status === "packed"
                          ? "bg-purple-100 text-purple-800"
                          : order.status === "out-for-delivery" || order.status === "dispatched"
                          ? "bg-blue-100 text-blue-800"
                          : isCancelled
                          ? "bg-rose-100 text-rose-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {order.display_status || order.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500 font-medium">
                    Placed on {formatDateTime(order.date_created)} • {order.item_count} {order.item_count === 1 ? "item" : "items"} (₹{order.total})
                  </p>
                </div>

                {/* Quick ETA pill */}
                {!isCancelled && !isDelivered && (
                  <div className="flex items-center gap-2 rounded-xl bg-[#F1ECFF] px-3.5 py-2 text-xs font-bold text-[#7C3AED] border border-[#C4B5FD]/40">
                    <Truck size={16} className="animate-pulse shrink-0" />
                    <span>Est. Delivery: 20–30 Mins</span>
                  </div>
                )}
                {isDelivered && (
                  <div className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-700 border border-emerald-200">
                    <CheckCircle2 size={16} className="shrink-0" />
                    <span>Delivered</span>
                  </div>
                )}
              </div>

              {/* Cancelled Notice if applicable */}
              {isCancelled ? (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-xs text-rose-800 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <AlertCircle size={15} /> Order Cancelled
                  </div>
                  <p className="text-rose-700 leading-relaxed">
                    This order was cancelled and live courier tracking is inactive. If you have any questions regarding your refund, please reach out to customer support.
                  </p>
                </div>
              ) : (
                <>
                  {/* ────────────────────────────────────────────────────────── */}
                  {/* DESKTOP HORIZONTAL TIMELINE (>= 768px)                     */}
                  {/* ────────────────────────────────────────────────────────── */}
                  <div className="hidden md:block pt-6 pb-2">
                    <div className="relative flex items-center justify-between">
                      {/* Background Bar */}
                      <div className="absolute left-6 right-6 top-5 -z-0 h-1 bg-gray-200" />
                      {/* Active Progress Bar */}
                      <div
                        className="absolute left-6 top-5 -z-0 h-1 bg-[#7C3AED] transition-all duration-500"
                        style={{
                          width: `${
                            order.tracking_stage >= 4
                              ? 100
                              : order.tracking_stage === 3
                              ? 66
                              : order.tracking_stage === 2
                              ? 33
                              : 0
                          }%`,
                          maxWidth: "calc(100% - 48px)",
                        }}
                      />

                      {trackingSteps.map((step, idx) => {
                        const status = getStepStatus(step.stage, order.tracking_stage || 1, order.status);
                        const Icon = step.icon;

                        return (
                          <div key={idx} className="relative z-10 flex flex-col items-center text-center">
                            <div
                              className={`flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 ${
                                status === "completed"
                                  ? "bg-emerald-600 text-white shadow-sm"
                                  : status === "active"
                                  ? "bg-[#7C3AED] text-white ring-4 ring-[#7C3AED]/20 shadow-md scale-110"
                                  : "bg-white text-gray-400 border-2 border-gray-300"
                              }`}
                            >
                              {status === "completed" ? (
                                <Check size={18} strokeWidth={3} />
                              ) : (
                                <Icon size={18} />
                              )}
                            </div>
                            <span
                              className={`mt-2 text-xs font-bold ${
                                status === "active"
                                  ? "text-[#7C3AED]"
                                  : status === "completed"
                                  ? "text-gray-900"
                                  : "text-gray-400"
                              }`}
                            >
                              {step.title}
                            </span>
                            <span className="text-[10px] text-gray-500 font-medium max-w-[120px] leading-tight mt-0.5">
                              {step.subtitle}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* ────────────────────────────────────────────────────────── */}
                  {/* MOBILE VERTICAL TIMELINE (< 768px)                         */}
                  {/* ────────────────────────────────────────────────────────── */}
                  <div className="md:hidden pt-4 space-y-4">
                    {trackingSteps.map((step, idx) => {
                      const status = getStepStatus(step.stage, order.tracking_stage || 1, order.status);
                      const Icon = step.icon;

                      return (
                        <div key={idx} className="flex items-start gap-3.5">
                          {/* Icon + Vertical Bar */}
                          <div className="flex flex-col items-center">
                            <div
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${
                                status === "completed"
                                  ? "bg-emerald-600 text-white shadow-sm"
                                  : status === "active"
                                  ? "bg-[#7C3AED] text-white ring-4 ring-[#7C3AED]/20 shadow-sm"
                                  : "bg-white text-gray-400 border-2 border-gray-300"
                              }`}
                            >
                              {status === "completed" ? (
                                <Check size={14} strokeWidth={3} />
                              ) : (
                                <Icon size={14} />
                              )}
                            </div>
                            {idx < trackingSteps.length - 1 && (
                              <div
                                className={`h-8 w-0.5 mt-1 transition-all ${
                                  status === "completed" ? "bg-emerald-500" : "bg-gray-200"
                                }`}
                              />
                            )}
                          </div>

                          {/* Text info */}
                          <div className={`pt-0.5 ${status === "pending" ? "opacity-40" : ""}`}>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-900">{step.title}</span>
                              {status === "active" && step.stage !== 4 && (
                                <span className="rounded-md bg-[#7C3AED]/10 px-1.5 py-0.5 text-[9px] font-extrabold text-[#7C3AED]">
                                  In Progress
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-gray-500 font-medium leading-tight mt-0.5">
                              {step.subtitle}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* 2. TWO-COLUMN SPLIT (LEFT: FULFILLMENT & ITEMS, RIGHT: DELIVERY & BILL) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
              {/* LEFT COLUMN: LIVE STAGE DETAILS & ORDER ITEMS */}
              <div className="lg:col-span-7 space-y-4">
                {/* Live Dispatch State Box */}
                {!isCancelled && (
                  <div className="rounded-2xl border border-purple-100 bg-gradient-to-br from-[#FAF8FF] to-white p-4 sm:p-5 shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F1ECFF] text-[#7C3AED]">
                        <Store size={18} />
                      </div>
                      <div>
                        <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#7C3AED]">
                          Fulfillment Hub
                        </h3>
                        <p className="text-xs font-bold text-gray-900 mt-0.5">
                          Mumbai Collection Store — Vasai West
                        </p>
                        <p className="text-[11px] text-gray-500 font-medium leading-relaxed mt-0.5">
                          {order.tracking_stage === 1 && "Order received. Our staff will begin processing and packing shortly."}
                          {order.tracking_stage === 2 && "Items are currently being packed and double-checked for quality."}
                          {order.tracking_stage === 3 && "Delivery rider has picked up your package and is on the way to your address."}
                          {order.tracking_stage >= 4 && "Order has been successfully delivered. Thank you for shopping with us!"}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Ordered Items Preview */}
                <div className="rounded-2xl border border-gray-200/80 bg-white p-4 sm:p-5 shadow-sm">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-3">
                    <div className="flex items-center gap-2">
                      <ShoppingBag size={16} className="text-[#7C3AED]" />
                      <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-700">
                        Items in this Order ({order.line_items?.length || 0})
                      </h3>
                    </div>
                    <span className="text-xs font-bold text-gray-500">₹{order.total}</span>
                  </div>

                  <div className="divide-y divide-gray-100">
                    {order.line_items?.map((item, i) => (
                      <div key={i} className="flex items-center justify-between py-2.5 gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-100 bg-gray-50 p-1">
                            {item.image ? (
                              <img
                                src={item.image}
                                alt={item.name}
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <Package size={20} className="text-gray-300" />
                            )}
                          </div>
                          <div>
                            <p className="line-clamp-1 text-xs font-bold text-gray-900">{item.name}</p>
                            <p className="text-[11px] text-gray-500 font-medium">
                              Qty: <span className="font-bold text-gray-800">{item.quantity}</span> × ₹{item.price || (Number(item.total) / (item.quantity || 1)).toFixed(0)}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs font-extrabold text-gray-900 shrink-0">
                          ₹{item.total}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: DESTINATION ADDRESS, BILL & SUPPORT */}
              <div className="lg:col-span-5 space-y-4">
                {/* Destination Address */}
                <div className="rounded-2xl border border-gray-200/80 bg-white p-4 sm:p-5 shadow-sm">
                  <div className="flex items-center gap-2 border-b border-gray-100 pb-2.5 mb-2.5">
                    <MapPin size={15} className="text-[#7C3AED]" />
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-700">
                      Delivery Destination
                    </h3>
                  </div>
                  <div className="text-xs text-gray-700 leading-relaxed font-medium space-y-1">
                    <p className="font-bold text-gray-900">
                      {order.shipping?.first_name || order.billing?.first_name}{" "}
                      {order.shipping?.last_name || order.billing?.last_name}
                    </p>
                    <p className="text-gray-600">
                      {order.shipping?.address_1 || order.billing?.address_1}
                      {order.shipping?.address_2 ? `, ${order.shipping.address_2}` : order.billing?.address_2 ? `, ${order.billing.address_2}` : ""}
                    </p>
                    <p className="text-gray-600">
                      {order.shipping?.city || order.billing?.city}, {order.shipping?.state || order.billing?.state} - {order.shipping?.postcode || order.billing?.postcode}
                    </p>
                    {(order.shipping?.phone || order.billing?.phone) && (
                      <p className="flex items-center gap-1 text-[#7C3AED] font-bold pt-1">
                        <Phone size={12} /> {order.shipping?.phone || order.billing?.phone}
                      </p>
                    )}
                  </div>
                </div>

                {/* Bill Summary */}
                <div className="rounded-2xl border border-gray-200/80 bg-white p-4 sm:p-5 shadow-sm">
                  <div className="flex items-center gap-2 border-b border-gray-100 pb-2.5 mb-2.5">
                    <CreditCard size={15} className="text-[#7C3AED]" />
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-700">
                      Payment & Bill Summary
                    </h3>
                  </div>

                  <div className="space-y-2 text-xs text-gray-600">
                    <div className="flex justify-between">
                      <span>Payment Method</span>
                      <span className="font-bold text-gray-900">{order.payment_method_title || "Cash on Delivery"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Delivery Charge</span>
                      <span className="font-bold text-emerald-600">
                        {Number(order.shipping_total) === 0 ? "FREE" : `₹${order.shipping_total}`}
                      </span>
                    </div>
                    {Number(order.discount_total) > 0 && (
                      <div className="flex justify-between text-emerald-600">
                        <span>Discount</span>
                        <span className="font-bold">-₹{order.discount_total}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-gray-100 pt-2 text-sm font-black text-gray-900">
                      <span>Grand Total</span>
                      <span className="text-[#7C3AED]">₹{order.total}</span>
                    </div>
                  </div>
                </div>

                {/* Need Support Card */}
                <div className="flex items-center justify-between rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F1ECFF] text-[#7C3AED]">
                      <HelpCircle size={16} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-gray-900">Need help with this order?</p>
                      <p className="text-[10px] text-gray-500">Contact Mumbai Collection support</p>
                    </div>
                  </div>
                  <Link
                    to="/contact"
                    className="flex items-center gap-1 rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-bold text-[#7C3AED] transition hover:bg-[#F1ECFF] active:scale-95"
                  >
                    Help <ChevronRight size={13} />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default TrackOrder;
