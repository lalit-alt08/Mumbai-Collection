import { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ShoppingBag,
} from "lucide-react";
import { CustomerPendingPaymentBanner } from "../components/orders/CustomerPendingPaymentBanner.jsx";
import { CustomerOrderCard } from "../components/orders/CustomerOrderCard.jsx";
import { triggerHaptic } from "../utils/haptics";
import { getMyOrders } from "../services/orderService";
import { checkPaymentStatus, cancelPaymentOrder } from "../services/paymentService";
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
  const [cancellingPending, setCancellingPending] = useState(false);
  const [pendingFeedback, setPendingFeedback] = useState("");
  const [cancelPermission, setCancelPermission] = useState(null);
  const [isPaymentUnpaid, setIsPaymentUnpaid] = useState(false);
  const paymentIdentityRef = useRef(null);
  paymentIdentityRef.current = `${user?.id || ""}:${pendingPayment?.razorpay_order_id || ""}`;

  const [page, setPage] = useState(1);
  const [totalOrders, setTotalOrders] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loadMoreError, setLoadMoreError] = useState("");

  const hasMore = page < totalPages;
  const userEmail = user?.email || "";
  const abortControllerRef = useRef(null);

  const fetchOrders = async (targetPage = 1, isLoadMore = false) => {
    const safePage = typeof targetPage === "number" && Number.isInteger(targetPage) && targetPage > 0 ? targetPage : 1;
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
        setLoadMoreError("");
      } else {
        setLoading(true);
        setError("");
        setLoadMoreError("");
      }

      const data = await getMyOrders({
        page: safePage,
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

        setPage(data.page || safePage);
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
      } else {
        setLoadMoreError("Unable to load more orders right now. Please try again.");
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
    setCancelPermission(null);
    setPendingFeedback("");
    setCheckingPending(false);
    setCancellingPending(false);
    setIsPaymentUnpaid(false);
    const checkStoredPending = () => {
      const stored = getPendingPayment(user?.id);
      if (stored?.razorpay_order_id) {
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

    const identity = `${user?.id || ""}:${idToCheck}`;
    try {
      setCancelPermission(null);
      setCheckingPending(true);
      setPendingFeedback("");
      const res = await checkPaymentStatus(idToCheck);
      if (paymentIdentityRef.current !== identity) return;
      if (res?.can_cancel === true && !res?.support_required && !res?.terminal) setCancelPermission(identity);
      if (res?.success && res?.order_id) {
        clearPendingPayment(user?.id);
        clearCheckoutIdempotencyKey(user?.id);
        setPendingPayment(null);
        navigate(`/order-success/${res.order_id}`, {
          state: { paymentMethod: "Online Payment", status: res.orderStatus || "Processing", confirmedUserId: user.id },
        });
        return;
      }
      if (res?.support_required) {
        setPendingPayment({ ...pendingPayment, support_required: true });
        setPendingFeedback(res.message || "This payment requires staff review. Please do not pay again; contact support with your checkout reference.");
        return;
      }
      if (res?.refunded || res?.terminal || res?.cancelled) {
        clearPendingPayment(user?.id);
        setPendingPayment(null);
        setPendingFeedback(res.message || (res.refunded ? "Your payment was refunded." : "This payment attempt has ended."));
        fetchOrders(1, false);
        return;
      }
      if (res?.processing) {
        setIsPaymentUnpaid(false);
        setPendingFeedback("Payment is processing with your bank. Please check again in a moment.");
      } else {
        setIsPaymentUnpaid(true);
        setPendingFeedback("No money was charged. You can try paying again in Cart or end this attempt.");
      }
    } catch (_) {
      if (paymentIdentityRef.current === identity) setPendingFeedback("Could not check payment status with gateway right now. Please tap to retry.");
    } finally {
      if (paymentIdentityRef.current === identity) setCheckingPending(false);
    }
  };

  const handleCancelPending = async (rzpOrderId) => {
    const idToCancel = rzpOrderId || pendingPayment?.razorpay_order_id;
    const identity = `${user?.id || ""}:${idToCancel}`;
    if (!idToCancel || cancellingPending || checkingPending || cancelPermission !== identity) return;

    try {
      setCancellingPending(true);
      setCancelPermission(null);
      const res = await cancelPaymentOrder(idToCancel);
      if (paymentIdentityRef.current !== identity) return;
      if (res?.cancelled || res?.terminal) {
        clearPendingPayment(user?.id);
        clearCheckoutIdempotencyKey(user?.id);
        setPendingPayment(null);
        setPendingFeedback(res?.message || "Checkout attempt ended and reserved items released.");
        fetchOrders(1, false);
      } else if (res?.code === "PAYMENT_ALREADY_CAPTURED" || res?.code === "PAYMENT_PROCESSING") {
        setPendingFeedback(res.message || "A payment is processing. Please check status before paying again.");
      } else {
        setPendingFeedback(res?.message || "Unable to end checkout attempt. Please try checking status.");
      }
    } catch (err) {
      if (paymentIdentityRef.current === identity) setPendingFeedback(err.response?.data?.message || err.message || "Failed to end checkout attempt.");
    } finally {
      if (paymentIdentityRef.current === identity) setCancellingPending(false);
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
        {!pendingPayment && pendingFeedback && (
          <p role="status" className="mb-4 rounded-xl bg-blue-50 p-4 text-sm text-[#1E293B]">{pendingFeedback}</p>
        )}
        <CustomerPendingPaymentBanner
          pendingPayment={pendingPayment}
          pendingFeedback={pendingFeedback}
          checkingPending={checkingPending}
          cancellingPending={cancellingPending}
          canCancelPending={!checkingPending && cancelPermission === paymentIdentityRef.current}
          isPaymentUnpaid={isPaymentUnpaid}
          onCheckPending={handleCheckPending}
          onCancelPending={handleCancelPending}
        />

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
              type="button"
              onClick={() => fetchOrders(1, false)}
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
            {orders.map((order) => (
              <CustomerOrderCard
                key={order.id}
                order={order}
                isExpanded={expandedOrderId === order.id}
                onToggleExpand={toggleExpandOrder}
                checkingPending={checkingPending}
                onCheckPending={handleCheckPending}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}

        {/* Compact Load More Orders Button */}
        {!loading && !error && hasMore && (
          <div className="pt-6 pb-2 text-center">
            {loadMoreError && (
              <p role="alert" className="mb-2 text-xs font-semibold text-rose-500">
                {loadMoreError}
              </p>
            )}
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="inline-flex items-center justify-center rounded-full bg-[#22499F] px-7 py-2.5 text-xs sm:text-sm font-black text-[#FFFFFF] shadow-sm shadow-[#22499F]/20 transition-all hover:bg-[#1B3B82] active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
            >
              {loadingMore ? "Loading..." : "Load More"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Orders;
