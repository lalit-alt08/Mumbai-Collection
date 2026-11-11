import { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getScheduledFulfillmentLabel, isPaymentAwaitingDeliveryReview, isScheduledFulfillmentOrder } from "../utils/scheduledDelivery.js";
import {
  ArrowLeft,
  ChevronLeft,
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
  Moon,
} from "lucide-react";
import { triggerHaptic } from "../utils/haptics";
import { getMyOrders } from "../services/orderService";
import { checkPaymentStatus } from "../services/paymentService";
import {
  getPendingPayment,
  clearPendingPayment,
  clearCheckoutIdempotencyKey,
} from "../utils/checkoutIdempotency";
import { useAuth } from "../context/AuthContext";
import { useNoIndex } from "../hooks/useNoIndex";

function Orders() {
  useNoIndex();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [expandedOrderId, setExpandedOrderId] = useState(null);

  const [pendingPayment, setPendingPayment] = useState(null);
  const [checkingPending, setCheckingPending] = useState(false);
  const [pendingFeedback, setPendingFeedback] = useState("");

  const [page, setPage] = useState(1);
  const [totalOrders, setTotalOrders] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const hasMore = page < totalPages;
  const userEmail = user?.email || "";
  const abortControllerRef = useRef(null);

  const fetchOrders = async (targetPage = 1, isLoadMore = false) => {
    let controller = null;
    if (!isLoadMore) {
      abortControllerRef.current?.abort();
      controller = new AbortController();
      abortControllerRef.current = controller;
    }
    const currentSignal = isLoadMore ? undefined : controller?.signal;

    try {
      if (isLoadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError("");
      }

      const data = await getMyOrders({
        page: targetPage,
        per_page: 10,
        email: userEmail,
        signal: currentSignal,
      });

      if (controller?.signal?.aborted) return;

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
      if (controller?.signal?.aborted || err.name === "CanceledError" || err.code === "ERR_CANCELED") return;
      if (!isLoadMore) {
        setError("Unable to load your orders right now. Please try again.");
      }
    } finally {
      if (controller?.signal?.aborted) return;
      if (isLoadMore) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchOrders(1, false);
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [userEmail]);

  useEffect(() => {
    const checkStoredPending = () => {
      const stored = getPendingPayment(user?.id);
      if (stored?.razorpay_order_id && Date.now() - (stored.timestamp || 0) < 30 * 60 * 1000) {
        setPendingPayment(stored);
      } else {
        setPendingPayment(null);
      }
    };

    checkStoredPending();
    window.addEventListener("focus", checkStoredPending);
    return () => window.removeEventListener("focus", checkStoredPending);
  }, [user?.id]);

  const handleCheckPending = async (rzpOrderId) => {
    const idToCheck = rzpOrderId || pendingPayment?.razorpay_order_id;
    if (!idToCheck) return;

    try {
      setCheckingPending(true);
      setPendingFeedback("");
      const res = await checkPaymentStatus(idToCheck);
      if (res?.success && res?.order_id) {
        clearPendingPayment(user?.id);
        clearCheckoutIdempotencyKey();
        setPendingPayment(null);
        navigate(`/order-success/${res.order_id}`, {
          state: { paymentMethod: "Online Payment", status: res.orderStatus || "Processing" },
        });
        return;
      }
      if (res?.refunded || res?.terminal) {
        clearPendingPayment(user?.id);
        setPendingPayment(null);
        setPendingFeedback(res.message || (res.refunded ? "Your payment was refunded." : "This payment attempt has ended."));
        fetchOrders(1, false);
        return;
      }
      setPendingFeedback("Payment is still being confirmed by your bank. Please try checking again in a moment.");
    } catch (_) {
      setPendingFeedback("Unable to reach payment gateway right now. Please check again in a few moments.");
    } finally {
      setCheckingPending(false);
    }
  };

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
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFFFFF] px-3 py-1 text-xs font-bold text-[#22499F] border border-[#E2E8F0]">
            <CheckCircle2 size={13} />
            {displayStatus || "Delivered"}
          </span>
        );
      case "processing":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#22499F]/10 px-3 py-1 text-xs font-bold text-[#22499F] border border-[#22499F]/40">
            <Package size={13} className="animate-pulse" />
            {displayStatus || "Preparing & Packing"}
          </span>
        );
      case "pending":
      case "on-hold":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFFFFF] px-3 py-1 text-xs font-bold text-[#22499F] border border-[#E2E8F0]">
            <Clock size={13} className="animate-spin" />
            {displayStatus || "Payment Pending"}
          </span>
        );
      case "packed":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFFFFF] px-3 py-1 text-xs font-bold text-[#22499F] border border-[#E2E8F0]">
            <Package size={13} />
            {displayStatus || "Packed & Ready"}
          </span>
        );
      case "out-for-delivery":
      case "dispatched":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFFFFF] px-3 py-1 text-xs font-bold text-[#22499F] border border-[#E2E8F0]">
            <Truck size={13} className="animate-bounce" />
            {displayStatus || "Out for Delivery"}
          </span>
        );
      case "cancelled":
      case "failed":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-950/40 px-3 py-1 text-xs font-bold text-rose-300 border border-rose-800/60">
            <AlertCircle size={13} />
            {displayStatus || "Cancelled"}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFFFFF] px-3 py-1 text-xs font-bold text-[#22499F] border border-[#E2E8F0]">
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
    <div className="min-h-screen bg-[#F0F8E8] px-4 pt-6 pb-28 sm:pb-24 md:pt-10 md:pb-16">
      <div className="mx-auto max-w-4xl">
        {/* Top Header Bar */}
        <div className="mb-4 sm:mb-6 flex items-center justify-between gap-2.5 sm:gap-3">
          {/* Left: Circular Back Button */}
          <button
            onClick={() => {
              triggerHaptic("light");
              if (window.history.length > 1) {
                navigate(-1);
              } else {
                navigate("/account");
              }
            }}
            aria-label="Back"
            className="flex h-12 w-12 sm:h-[52px] sm:w-[52px] shrink-0 items-center justify-center rounded-full bg-[#FFFFFF]/90 backdrop-blur-md text-white border border-[#E2E8F0] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.25)] transition-all hover:bg-[#FFFFFF] hover:border-[#22499F]/40 active:scale-95 cursor-pointer"
          >
            <ChevronLeft size={23} strokeWidth={2.5} />
          </button>

          {/* Center: Capsule utilizing available space with clear typography and no inner pill */}
          <div className="flex-1 min-w-0 flex items-center justify-center rounded-full bg-[#FFFFFF]/95 backdrop-blur-md border border-[#E2E8F0] px-5 sm:px-7 py-2.5 sm:py-3 min-h-[48px] sm:min-h-[52px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.12),0_2px_10px_rgba(0,0,0,0.3)]">
            <h1 className="text-[19px] sm:text-[20px] font-extrabold text-[#1E293B] tracking-[-0.01em] leading-normal antialiased select-none">
              My Orders
            </h1>
          </div>

          {/* Right: Shop More Button moved cleanly to the side */}
          <Link
            to="/"
            onClick={() => triggerHaptic("light")}
            aria-label="Shop More"
            className="flex h-12 sm:h-[52px] shrink-0 items-center justify-center rounded-full bg-[#22499F] px-4.5 sm:px-5.5 text-xs sm:text-sm font-extrabold text-[#FFFFFF] shadow-[0_2px_10px_rgba(66,214,232,0.3)] transition-all hover:bg-[#1B3B82] hover:shadow-[0_4px_16px_rgba(66,214,232,0.45)] active:scale-95 cursor-pointer whitespace-nowrap"
          >
            Shop More
          </Link>
        </div>

        {/* Payment-Pending Active Order Banner */}
        {pendingPayment && (
          <div className="mb-6 rounded-[24px] border border-[#E2E8F0] bg-[#FFFFFF] p-5 sm:p-6 shadow-[0_8px_30px_rgba(0,0,0,0.3)]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0]">
                  <Clock size={22} className="animate-spin" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-extrabold text-[#1E293B]">
                      Payment Pending Confirmation
                    </h3>
                    <span className="rounded-full bg-[#FFFFFF] px-2.5 py-0.5 text-[10px] font-bold text-[#22499F] border border-[#E2E8F0]">
                      VERIFYING
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[#64748B] leading-relaxed">
                    We&apos;re confirming your payment with your bank. If money was debited from your account, please do not pay again.
                  </p>
                  {pendingFeedback && (
                    <p className="mt-1.5 text-xs font-semibold text-[#22499F]">
                      {pendingFeedback}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                <button
                  type="button"
                  onClick={() => handleCheckPending(pendingPayment.razorpay_order_id)}
                  disabled={checkingPending}
                  className="rounded-xl bg-[#22499F] px-4 py-2 text-xs font-black text-[#FFFFFF] shadow-xs hover:bg-[#1B3B82] active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {checkingPending ? "Checking..." : "Check payment"}
                </button>
                <a
                  href="https://wa.me/918793601567?text=Hi%2C%20I%20have%20a%20question%20about%20my%20pending%20payment%20on%20Mumbai%20Collection"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] px-3.5 py-2 text-xs font-bold text-[#1E293B] hover:bg-[#1C3358]"
                >
                  Help (+91 87936 01567)
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Loading Skeletons */}
        {loading && (
          <div className="space-y-4">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="animate-pulse rounded-[24px] bg-[#FFFFFF] border border-[#E2E8F0] p-6 shadow-sm"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div className="h-5 w-32 rounded-lg bg-[#E2E8F0]/60" />
                  <div className="h-6 w-24 rounded-full bg-[#E2E8F0]/60" />
                </div>
                <div className="flex gap-4">
                  <div className="h-16 w-16 rounded-xl bg-[#E2E8F0]/60" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 rounded bg-[#E2E8F0]/60" />
                    <div className="h-4 w-1/2 rounded bg-[#E2E8F0]/60" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="rounded-[24px] border border-rose-800/60 bg-rose-950/30 p-6 text-center text-rose-300 shadow-sm">
            <p className="font-semibold">{error}</p>
            <button
              onClick={fetchOrders}
              className="mt-3 rounded-full bg-rose-900/60 border border-rose-700/60 px-5 py-2 text-xs font-bold text-rose-200 transition hover:bg-rose-800/60 cursor-pointer"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && orders.length === 0 && (
          <div className="rounded-[28px] bg-[#FFFFFF] border border-[#E2E8F0] p-10 text-center shadow-[0_8px_30px_rgba(0,0,0,0.3)] md:p-16">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0]">
              <ShoppingBag size={38} />
            </div>

            <h2 className="text-xl font-bold text-[#1E293B]">
              No Orders Found
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-[#64748B] leading-relaxed">
              Looks like you haven't placed any orders yet. Discover our premium stationery, art supplies, and toys!
            </p>

            <div className="mt-8 flex justify-center gap-3">
              <Link
                to="/"
                className="rounded-full bg-[#22499F] px-8 py-3.5 text-sm font-black text-[#FFFFFF] shadow-[0_4px_20px_rgba(66,214,232,0.3)] transition hover:bg-[#1B3B82] active:scale-95"
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
                  className="overflow-hidden rounded-[26px] bg-[#FFFFFF] shadow-[0_8px_30px_rgba(0,0,0,0.25)] border border-[#E2E8F0]/80 transition-all hover:border-[#22499F]/50"
                >
                  {/* Order Card Header */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0]/70 bg-[#F0F8E8] px-5 py-4 sm:px-6">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FFFFFF] text-[#64748B] shadow-sm border border-[#E2E8F0]">
                        <Package size={17} />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider">
                          Order #{order.order_number}
                        </span>
                        <div className="text-xs text-[#64748B] font-medium">
                          {formatDate(order.date_created)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isPaymentAwaitingDeliveryReview(order) ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/35 bg-amber-950/50 px-2.5 py-0.5 text-[10.5px] font-bold text-amber-200">
                          <AlertCircle size={11} />
                          <span>Delivery timing to be confirmed</span>
                        </span>
                      ) : isScheduledFulfillmentOrder(order) && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-indigo-400/35 bg-indigo-950/50 px-2.5 py-0.5 text-[10.5px] font-bold text-indigo-300 shadow-xs">
                          <Moon size={11} className="text-indigo-400" />
                          <span>Scheduled · {getScheduledFulfillmentLabel(order)}</span>
                        </span>
                      )}
                      {getStatusBadge(order.status, order.display_status)}
                    </div>
                  </div>

                  {/* Items Preview */}
                  <div className="p-5 sm:p-6">
                    <div className="space-y-3">
                      {order.line_items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-4"
                        >
                          <div className="flex items-center gap-3.5">
                            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#E2E8F0]/60 bg-[#F0F8E8] p-1 shadow-sm">
                              {item.image ? (
                                <img
                                  src={item.image}
                                  alt={item.name}
                                  loading="lazy"
                                  className="h-full w-full object-contain"
                                />
                              ) : (
                                <Package size={22} className="text-[#64748B]" />
                              )}
                            </div>
                            <div>
                              <h3 className="line-clamp-1 text-sm font-bold text-[#1E293B]">
                                {item.name}
                              </h3>
                              <div className="text-xs text-[#64748B] font-medium">
                                Qty: <span className="font-bold text-[#1E293B]">{item.quantity}</span> × ₹{item.price || (Number(item.total) / (item.quantity || 1)).toFixed(0)}
                              </div>
                            </div>
                          </div>

                          <div className="text-right">
                            <span className="text-sm font-extrabold text-[#1E293B]">
                              ₹{item.total}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Summary Footer Bar */}
                    <div className="mt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3.5 sm:gap-4 border-t border-[#E2E8F0]/70 pt-4">
                      <div className="flex items-baseline justify-between sm:flex-col sm:justify-start gap-1">
                        <span className="text-xs font-bold uppercase tracking-wider text-[#64748B]">
                          Total Paid ({order.payment_method_title})
                        </span>
                        <div className="text-lg sm:text-xl font-black text-[#1E293B] tracking-tight">
                          ₹{order.total}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:gap-2.5 w-full sm:w-auto">
                        <button
                          type="button"
                          onClick={() => toggleExpandOrder(order.id)}
                          className={`col-span-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-xl border px-3 sm:px-4 text-xs font-bold transition-all select-none cursor-pointer whitespace-nowrap active:scale-[0.98] ${
                            isExpanded
                              ? "border-[#22499F]/50 bg-[#112440] text-[#22499F] shadow-xs"
                              : "border-[#E2E8F0] bg-[#FFFFFF] text-[#475569] hover:bg-[#F0F8E8] hover:text-[#22499F] hover:border-[#22499F]/50"
                          }`}
                        >
                          <Receipt size={14} className={`shrink-0 transition-colors ${isExpanded ? "text-[#22499F]" : "text-[#64748B]"}`} />
                          <span>{isExpanded ? "Hide Details" : "Invoice Details"}</span>
                          {isExpanded ? (
                            <ChevronUp size={13} className="shrink-0 text-[#22499F]" />
                          ) : (
                            <ChevronDown size={13} className="shrink-0 text-[#64748B]" />
                          )}
                        </button>

                        {["pending", "on-hold"].includes(order.status) && (
                          <button
                            type="button"
                            onClick={() => handleCheckPending(order.meta_data?.find((m) => m.key === "_razorpay_order_id")?.value || order.id)}
                            disabled={checkingPending}
                            className="col-span-2 sm:col-auto inline-flex items-center justify-center gap-1.5 h-10 rounded-xl bg-[#22499F] px-3.5 sm:px-4 text-xs font-black text-[#FFFFFF] transition-all select-none whitespace-nowrap hover:bg-[#1B3B82] active:scale-[0.98] disabled:opacity-50 cursor-pointer shadow-xs"
                          >
                            <Clock size={14} className="shrink-0" />
                            <span>{checkingPending ? "Checking..." : "Check payment"}</span>
                          </button>
                        )}

                        {isLive ? (
                          <Link
                            to={`/orders/${order.id}/track`}
                            className="col-span-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-xl bg-[#22499F] px-3.5 sm:px-4 text-xs font-black text-[#FFFFFF] transition-all select-none whitespace-nowrap hover:bg-[#1B3B82] active:scale-[0.98] shadow-sm shadow-[#22499F]/20"
                          >
                            <Truck size={14} className="shrink-0" />
                            <span>Track Order</span>
                          </Link>
                        ) : (
                          <Link
                            to={`/orders/${order.id}/track`}
                            className="col-span-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-xl border border-[#22499F]/35 bg-[#FFFFFF] px-3.5 sm:px-4 text-xs font-bold text-[#22499F] transition-all select-none whitespace-nowrap hover:bg-[#FFFFFF] hover:border-[#22499F]/70 active:scale-[0.98]"
                          >
                            <Package size={14} className="shrink-0 text-[#22499F]" />
                            <span>Order Details</span>
                          </Link>
                        )}
                      </div>
                    </div>

                    {/* Expandable Full Bill & Address Details */}
                    {isExpanded && (
                      <div className="mt-5 rounded-2xl bg-[#F0F8E8] p-4 sm:p-5 border border-[#E2E8F0] space-y-4 animate-in fade-in duration-200">
                        {/* Delivery Address */}
                        <div>
                          <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#22499F] mb-1.5">
                            <MapPin size={13} className="text-[#22499F]" />
                            Delivery Address
                          </h4>
                          <p className="text-xs text-[#64748B] font-medium leading-relaxed">
                            <span className="font-bold text-[#1E293B]">
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
                        <div className="border-t border-[#E2E8F0]/70 pt-3 space-y-1.5 text-xs text-[#64748B]">
                          <div className="flex justify-between items-start">
                            <div>
                              <span className="text-[#1E293B]">Items Subtotal</span>
                              <span className="block text-xs text-[#64748B]">(Incl. of all taxes)</span>
                            </div>
                            <span className="font-semibold text-[#1E293B]">
                              ₹{(Number(order.total) - Number(order.shipping_total) + Number(order.discount_total)).toFixed(2)}
                            </span>
                          </div>
                          {Number(order.discount_total) > 0 && (
                            <div className="flex justify-between text-[#22499F] font-semibold">
                              <span>Order Discount</span>
                              <span>-₹{order.discount_total}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span>Delivery Fee</span>
                            <span className="font-semibold text-[#1E293B]">
                              {Number(order.shipping_total) === 0 ? "FREE" : `₹${order.shipping_total}`}
                            </span>
                          </div>
                          <div className="flex justify-between items-start border-t border-[#E2E8F0]/70 pt-2 text-sm font-bold text-[#1E293B]">
                            <div>
                              <span>Grand Total</span>
                              <span className="block text-xs font-medium text-[#64748B]">Inclusive of all taxes (GST)</span>
                            </div>
                            <span className="text-[#22499F] font-black">₹{order.total}</span>
                          </div>
                        </div>

                        {/* Customer Support CTA */}
                        <div className="flex items-center justify-between border-t border-[#E2E8F0]/70 pt-3 text-xs">
                          <span className="text-[#64748B] font-medium">Have an issue with this order?</span>
                          <Link
                            to="/contact"
                            className="flex items-center gap-1 font-bold text-[#22499F] hover:underline"
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
              className="inline-flex items-center justify-center rounded-full bg-[#22499F] px-7 py-2.5 text-xs sm:text-sm font-black text-[#FFFFFF] shadow-sm shadow-[#22499F]/20 transition-all hover:bg-[#1B3B82] active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
            >
              Load More
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Orders;
