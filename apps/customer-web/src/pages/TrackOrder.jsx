import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useParams, useSearchParams, useNavigate } from "react-router-dom";
import {
  Search,
  Package,
  MapPin,
  CheckCircle2,
  ArrowLeft,
  Truck,
  AlertCircle,
  Loader2,
  ShoppingBag,
  Phone,
  CreditCard,
  Check,
  ChevronRight,
  HelpCircle,
} from "lucide-react";
import { getOrderById } from "../services/orderService";
import { useAuth } from "../context/AuthContext";
import { isValidPersonName } from "../utils/nameValidator";

function TrackOrder() {
  const { orderId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const urlOrderId = orderId || searchParams.get("id") || "";

  const [orderInput, setOrderInput] = useState(urlOrderId);
  const [activeOrderId, setActiveOrderId] = useState(urlOrderId);
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const pollTimerRef = useRef(null);
  const pollCountRef = useRef(0);
  const requestControllerRef = useRef(null);
  const requestSequenceRef = useRef(0);
  const activeOrderIdRef = useRef(activeOrderId);
  const orderRef = useRef(order);
  activeOrderIdRef.current = activeOrderId;
  orderRef.current = order;

  // Sync state if URL param or query param changes
  useEffect(() => {
    if (urlOrderId) {
      setOrderInput(urlOrderId);
      setActiveOrderId(urlOrderId);
    }
  }, [urlOrderId]);

  // Fetch Order Details
  const fetchOrder = useCallback(async (idToFetch, isBackground = false) => {
    if (!idToFetch) return;

    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const requestSequence = ++requestSequenceRef.current;
    const isCurrentRequest = () =>
      requestSequence === requestSequenceRef.current &&
      idToFetch === activeOrderIdRef.current &&
      !controller.signal.aborted;

    try {
      if (!isBackground) {
        setLoading(true);
        setError("");
        setOrder(null);
      }

      const res = await getOrderById(idToFetch, { signal: controller.signal });
      if (!isCurrentRequest()) return;

      if (res?.success && res?.order) {
        setOrder(res.order);
        setError("");
      } else {
        setError(res?.message || "Order not found.");
        setOrder(null);
      }
    } catch (err) {
      if (controller.signal.aborted || err.code === "ERR_CANCELED" || !isCurrentRequest()) return;

      const status = err.response?.status;
      if (status === 403) {
        setError("You are not authorized to view this order. Please log in to the account that placed this order.");
        setOrder(null);
      } else if (status === 404) {
        setError(`Order #${idToFetch} could not be found.`);
        setOrder(null);
      } else if (status === 401) {
        setError("Please log in to track your orders.");
        setOrder(null);
      } else {
        if (isBackground && orderRef.current) {
          // Keep the last successful order visible if a background refresh fails.
        } else if (!isBackground) {
          setError(err.response?.data?.message || err.message || "Failed to retrieve order tracking information.");
          setOrder(null);
        }
      }
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        requestControllerRef.current = null;
      }
      if (!isBackground && isCurrentRequest()) {
        setLoading(false);
      }
    }
  }, []);

  // Initial fetch on activeOrderId change
  useEffect(() => {
    if (activeOrderId) {
      fetchOrder(activeOrderId, false);
    }

    return () => {
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      requestSequenceRef.current += 1;
    };
  }, [activeOrderId, fetchOrder]);

  // Visibility-aware polling (about every 30 seconds while the order is active).
  useEffect(() => {
    const currentOrder = orderRef.current;
    if (!activeOrderId || !currentOrder) {
      return;
    }

    const isTerminalState =
      currentOrder.status === "completed" ||
      currentOrder.status === "cancelled" ||
      currentOrder.status === "refunded" ||
      currentOrder.status === "failed";

    if (isTerminalState) {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    const scheduleNextPoll = () => {
      if (!pollTimerRef.current && !document.hidden) {
        pollCountRef.current += 1;
        // Adaptive polling interval: 30s initial, 60s medium, 120s long-stay
        const baseInterval =
          pollCountRef.current <= 3
            ? 30000
            : pollCountRef.current <= 10
            ? 60000
            : 120000;
        const jitterMs = Math.floor(Math.random() * 5000);
        pollTimerRef.current = setTimeout(async () => {
          pollTimerRef.current = null;
          if (document.hidden) return;
          await fetchOrder(activeOrderId, true);
          scheduleNextPoll();
        }, baseInterval + jitterMs);
      }
    };

    const stopPolling = () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        pollCountRef.current = 0; // Reset backoff counter when customer returns to tab
        void fetchOrder(activeOrderId, true).finally(scheduleNextPoll);
      }
    };

    scheduleNextPoll();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeOrderId, order?.status, fetchOrder]);

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

  const getRecipientName = () => {
    const f = (order?.shipping?.first_name || order?.billing?.first_name || "").trim();
    const l = (order?.shipping?.last_name || order?.billing?.last_name || "").trim();
    const rawOrderName = `${f} ${l}`.trim();

    // If order shipping name is a valid person name, display it
    if (rawOrderName && isValidPersonName(rawOrderName)) {
      return rawOrderName;
    }

    // Fallback to customer's authentic account profile name
    const userFullName = (
      user?.full_name ||
      user?.name ||
      `${user?.first_name || ""} ${user?.last_name || ""}`
    ).trim();

    if (userFullName && isValidPersonName(userFullName)) {
      return userFullName;
    }

    return rawOrderName || userFullName || "Customer";
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
    <div className="min-h-screen bg-[#0B1425] text-[#F1F5F9] px-3 pt-4 sm:px-6 sm:pt-6 pb-20 sm:pb-24">
      <div className="mx-auto max-w-[1060px]">
        {/* Top Header Bar */}
        <div className="mb-4 sm:mb-6 flex items-center justify-between gap-3">
          {/* Back Action */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleBack}
              aria-label="Back to My Orders"
              className="flex items-center gap-2 rounded-full bg-[#111F36] px-3.5 py-2 text-xs font-bold text-[#F1F5F9] shadow-xs border border-[#1E3252] transition-all hover:border-[#42D6E8]/50 hover:bg-[#162744] hover:text-[#42D6E8] active:scale-95 cursor-pointer"
            >
              <ArrowLeft size={16} strokeWidth={2.4} />
              <span className="hidden sm:inline">Back to My Orders</span>
              <span className="sm:hidden">My Orders</span>
            </button>
          </div>

          {/* Order Reference */}
          <div className="flex items-center gap-2.5">
            {order ? (
              <span className="rounded-full bg-[#111F36] px-3 py-1.5 text-xs font-extrabold text-[#42D6E8] border border-[#1E3252] shadow-xs">
                Order #{order.order_number || order.id}
              </span>
            ) : (
              <span className="text-xs font-extrabold text-[#8FA4BE]">Order Tracking</span>
            )}
          </div>
        </div>
        {/* Search input when no order is specified in route */}
        {!urlOrderId && (
          <div className="mx-auto mb-6 max-w-md rounded-[24px] bg-[#111F36] p-5 border border-[#1E3252]/80 shadow-lg">
            <h2 className="text-base font-extrabold text-[#F1F5F9] mb-1">Track Your Order</h2>
            <p className="text-xs text-[#8FA4BE] mb-4">Enter your Mumbai Collection numeric order reference ID.</p>
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64748B] font-bold text-sm">#</span>
                <input
                  type="text"
                  required
                  value={orderInput}
                  onChange={(e) => setOrderInput(e.target.value.replace(/\D/g, ""))}
                  placeholder="e.g. 441"
                  className="h-10 w-full rounded-xl border border-[#1E3252] bg-[#0B1425] pl-7 pr-3 text-xs font-bold text-[#F1F5F9] placeholder:text-[#64748B] outline-none transition focus:border-[#42D6E8] focus:ring-2 focus:ring-[#42D6E8]/20"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#42D6E8] px-4 text-xs font-black text-[#061220] shadow-sm transition hover:bg-[#38bdf8] active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} strokeWidth={2.4} />}
                Track
              </button>
            </form>
          </div>
        )}

        {/* Loading Spinner */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 text-[#8FA4BE] gap-3">
            <Loader2 size={32} className="animate-spin text-[#42D6E8]" />
            <p className="text-xs font-bold text-[#F1F5F9]">Connecting to Mumbai Collection live dispatch...</p>
          </div>
        )}

        {/* Error Notification */}
        {error && !loading && (
          <div className="mx-auto max-w-lg rounded-[20px] border border-rose-500/30 bg-rose-500/10 p-5 text-rose-300 shadow-sm space-y-2">
            <div className="flex items-center gap-2 font-bold text-sm text-rose-400">
              <AlertCircle size={18} className="shrink-0 text-rose-400" />
              Unable to Retrieve Tracking Details
            </div>
            <p className="text-xs text-rose-300 leading-relaxed">{error}</p>
            <div className="pt-2">
              <Link
                to="/account/orders"
                className="inline-flex items-center gap-1 text-xs font-bold text-[#42D6E8] hover:underline"
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
            <div className="overflow-hidden rounded-[24px] border border-[#1E3252]/80 bg-[#111F36] p-4 sm:p-6 shadow-xl">
              {/* Header Details */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1E3252]/60 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-lg font-black text-[#F1F5F9] sm:text-xl">
                      Order #{order.order_number || order.id}
                    </h1>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-extrabold border ${
                        isDelivered
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                          : order.status === "packed"
                          ? "bg-purple-500/15 text-purple-300 border-purple-500/30"
                          : order.status === "out-for-delivery" || order.status === "dispatched"
                          ? "bg-[#42D6E8]/15 text-[#42D6E8] border border-[#42D6E8]/30"
                          : isCancelled
                          ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                          : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                      }`}
                    >
                      {order.display_status || order.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[#8FA4BE] font-medium">
                    Placed on {formatDateTime(order.date_created)}
                  </p>
                </div>

                {/* Quick ETA pill */}
                {!isCancelled && !isDelivered && (
                  <div className="flex items-center gap-2 rounded-xl bg-[#42D6E8]/10 px-3.5 py-2 text-xs font-bold text-[#42D6E8] border border-[#42D6E8]/30 shadow-xs">
                    <Truck size={16} className="animate-pulse shrink-0" />
                    <span>Est. Delivery: 60–90 Mins</span>
                  </div>
                )}
              </div>

              {/* Cancelled Notice if applicable */}
              {isCancelled ? (
                <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-rose-400">
                    <AlertCircle size={15} /> Order Cancelled
                  </div>
                  <p className="text-rose-300 leading-relaxed">
                    This order was cancelled and live courier tracking is inactive. If you have any questions regarding your refund, please reach out to customer support.
                  </p>
                </div>
              ) : (
                <>
                  {/* ────────────────────────────────────────────────────────── */}
                  {/* DESKTOP HORIZONTAL TIMELINE (>= 768px)                     */}
                  {/* ────────────────────────────────────────────────────────── */}
                  <div className="hidden md:block pt-6 pb-2">
                    <div className="flex items-start">
                      {trackingSteps.map((step, idx) => {
                        const status = getStepStatus(step.stage, order.tracking_stage || 1, order.status);
                        const Icon = step.icon;
                        const isSegmentCompleted =
                          order?.status === "completed" ||
                          (Number(order?.tracking_stage) || 1) > step.stage;

                        return (
                          <div key={idx} className="relative flex-1 flex flex-col items-center text-center">
                            {/* Segmented Connecting Track to next step */}
                            {idx < trackingSteps.length - 1 && (
                              <div
                                className="absolute top-5 -translate-y-1/2 h-1 bg-[#1E3252] rounded-full overflow-hidden"
                                style={{
                                  left: "calc(50% + 28px)",
                                  width: "calc(100% - 56px)",
                                }}
                              >
                                <div
                                  className={`h-full bg-[#42D6E8] transition-all duration-500 ${
                                    isSegmentCompleted ? "w-full" : "w-0"
                                  }`}
                                />
                              </div>
                            )}

                            {/* Checkpoint Circle */}
                            <div
                              className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 ${
                                status === "completed"
                                  ? "bg-emerald-500 text-[#061220] shadow-sm"
                                  : status === "active"
                                  ? "bg-[#42D6E8] text-[#061220] ring-4 ring-[#42D6E8]/25 shadow-[0_0_16px_rgba(66,214,232,0.4)] scale-110"
                                  : "bg-[#0B1425] text-[#475569] border border-[#1E3252]"
                              }`}
                            >
                              {status === "completed" ? (
                                <Check size={18} strokeWidth={3} />
                              ) : (
                                <Icon size={18} strokeWidth={2.2} />
                              )}
                            </div>

                            {/* Title & Subtitle */}
                            <span
                              className={`mt-2 text-xs font-bold ${
                                status === "active"
                                  ? "text-[#42D6E8]"
                                  : status === "completed"
                                  ? "text-[#F1F5F9]"
                                  : "text-[#64748B]"
                              }`}
                            >
                              {step.title}
                            </span>
                            <span className="text-[10px] text-[#8FA4BE] font-medium max-w-[120px] leading-tight mt-0.5">
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
                                  ? "bg-emerald-500 text-[#061220] shadow-sm"
                                  : status === "active"
                                  ? "bg-[#42D6E8] text-[#061220] ring-4 ring-[#42D6E8]/25 shadow-sm"
                                  : "bg-[#0B1425] text-[#475569] border border-[#1E3252]"
                              }`}
                            >
                              {status === "completed" ? (
                                <Check size={14} strokeWidth={3} />
                              ) : (
                                <Icon size={14} strokeWidth={2.2} />
                              )}
                            </div>
                            {idx < trackingSteps.length - 1 && (
                              <div
                                className={`h-8 w-0.5 mt-1 transition-all ${
                                  status === "completed" ? "bg-emerald-500" : "bg-[#1E3252]"
                                }`}
                              />
                            )}
                          </div>

                          {/* Text info */}
                          <div className={`pt-0.5 ${status === "pending" ? "opacity-40" : ""}`}>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-[#F1F5F9]">{step.title}</span>
                              {status === "active" && step.stage !== 4 && (
                                <span className="rounded-md bg-[#42D6E8]/15 px-1.5 py-0.5 text-[9px] font-extrabold text-[#42D6E8] border border-[#42D6E8]/30">
                                  In Progress
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-[#8FA4BE] font-medium leading-tight mt-0.5">
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
                {/* Ordered Items Preview */}
                <div className="rounded-[20px] border border-[#1E3252]/80 bg-[#111F36] p-4 sm:p-5 shadow-lg">
                  <div className="flex items-center justify-between border-b border-[#1E3252]/60 pb-3 mb-3">
                    <div className="flex items-center gap-2">
                      <ShoppingBag size={16} className="text-[#42D6E8]" />
                      <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#8FA4BE]">
                        Items in this Order ({order.line_items?.length || 0})
                      </h3>
                    </div>
                    <span className="text-xs font-bold text-[#42D6E8]">₹{order.total}</span>
                  </div>

                  <div className="divide-y divide-[#1E3252]/50">
                    {order.line_items?.map((item, i) => (
                      <div key={i} className="flex items-center justify-between py-2.5 gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#1E3252] bg-[#0B1425] p-1">
                            {item.image ? (
                              <img
                                src={item.image}
                                alt={item.name}
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <Package size={20} className="text-[#475569]" />
                            )}
                          </div>
                          <div>
                            <p className="line-clamp-1 text-xs font-bold text-[#F1F5F9]">{item.name}</p>
                            <p className="text-[11px] text-[#8FA4BE] font-medium">
                              Qty: <span className="font-bold text-[#F1F5F9]">{item.quantity}</span> × ₹{item.price || (Number(item.total) / (item.quantity || 1)).toFixed(0)}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs font-extrabold text-[#F1F5F9] shrink-0">
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
                <div className="rounded-[20px] border border-[#1E3252]/80 bg-[#111F36] p-4 sm:p-5 shadow-lg">
                  <div className="flex items-center gap-2 border-b border-[#1E3252]/60 pb-2.5 mb-2.5">
                    <MapPin size={15} className="text-[#42D6E8]" />
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#8FA4BE]">
                      Delivery Destination
                    </h3>
                  </div>
                  <div className="text-xs text-[#8FA4BE] leading-relaxed font-medium space-y-1">
                    <p className="font-bold text-[#F1F5F9] text-sm">
                      {getRecipientName()}
                    </p>
                    <p className="text-[#8FA4BE]">
                      {order.shipping?.address_1 || order.billing?.address_1}
                      {order.shipping?.address_2 ? `, ${order.shipping.address_2}` : order.billing?.address_2 ? `, ${order.billing.address_2}` : ""}
                    </p>
                    <p className="text-[#8FA4BE]">
                      {order.shipping?.city || order.billing?.city}, {order.shipping?.state || order.billing?.state} {order.shipping?.postcode || order.billing?.postcode ? `- ${order.shipping?.postcode || order.billing?.postcode}` : ""}
                    </p>
                    {(order.shipping?.phone || order.billing?.phone) && (
                      <p className="flex items-center gap-1 text-[#42D6E8] font-bold pt-1">
                        <Phone size={12} /> {order.shipping?.phone || order.billing?.phone}
                      </p>
                    )}
                  </div>
                </div>

                {/* Bill Summary */}
                <div className="rounded-[20px] border border-[#1E3252]/80 bg-[#111F36] p-4 sm:p-5 shadow-lg">
                  <div className="flex items-center gap-2 border-b border-[#1E3252]/60 pb-2.5 mb-2.5">
                    <CreditCard size={15} className="text-[#42D6E8]" />
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#8FA4BE]">
                      Payment & Bill Summary
                    </h3>
                  </div>

                  <div className="space-y-2 text-xs text-[#8FA4BE]">
                    <div className="flex justify-between">
                      <span>Payment Method</span>
                      <span className="font-bold text-[#F1F5F9]">{order.payment_method_title || "Cash on Delivery"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Delivery Charge</span>
                      <span className="font-bold text-emerald-400">
                        {Number(order.shipping_total) === 0 ? "FREE" : `₹${order.shipping_total}`}
                      </span>
                    </div>
                    {Number(order.discount_total) > 0 && (
                      <div className="flex justify-between text-emerald-400">
                        <span>Discount</span>
                        <span className="font-bold">-₹{order.discount_total}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-[#1E3252]/60 pt-2 text-sm font-black text-[#F1F5F9]">
                      <span>Grand Total</span>
                      <span className="text-[#42D6E8] font-black">₹{order.total}</span>
                    </div>
                  </div>
                </div>

                {/* Need Support Card */}
                <div className="flex items-center justify-between rounded-[20px] border border-[#1E3252]/80 bg-[#111F36] p-4 shadow-lg">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#42D6E8]/10 text-[#42D6E8]">
                      <HelpCircle size={16} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[#F1F5F9]">Need help with this order?</p>
                      <p className="text-[10px] text-[#8FA4BE]">Contact Mumbai Collection support</p>
                    </div>
                  </div>
                  <Link
                    to="/contact"
                    className="flex items-center gap-1 rounded-xl bg-[#1E3252] px-3 py-1.5 text-xs font-bold text-[#42D6E8] transition hover:bg-[#42D6E8] hover:text-[#061220] active:scale-95"
                  >
                    Help <ChevronRight size={13} />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default TrackOrder;
