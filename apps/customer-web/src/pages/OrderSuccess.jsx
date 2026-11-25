import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { useParams, Link, useLocation, useSearchParams } from "react-router-dom";
import {
  Package,
  CreditCard,
  Calendar,
  Home,
  MapPin,
  ArrowRight,
  AlertCircle,
  Loader2,
  Moon,
} from "lucide-react";
import { getOrderById } from "../services/orderService.js";
import { getScheduledFulfillmentLabel, isPaymentAwaitingDeliveryReview, isScheduledFulfillmentOrder } from "../utils/scheduledDelivery.js";
import { triggerHaptic } from "../utils/haptics.js";
import { playOrderSuccessSound } from "../utils/successSound.js";
import { verifyPayment, checkPaymentStatus } from "../services/paymentService.js";
import {
  getPendingPayment,
  clearPendingPayment,
  clearCheckoutIdempotencyKey,
  hasMatchingDirectCheckoutCelebration,
  matchesServerConfirmedCheckoutCelebration,
  consumePendingCheckoutCelebration,
} from "../utils/checkoutIdempotency.js";

function OrderSuccess() {
  const { user } = useAuth();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();

  const queryOrderId = searchParams.get("order") || searchParams.get("order_id") || searchParams.get("id");
  const rzpOrderId = searchParams.get("razorpay_order_id");
  const rzpPaymentId = searchParams.get("razorpay_payment_id");
  const rzpSignature = searchParams.get("razorpay_signature");

  const [activeOrderId, setActiveOrderId] = useState(id || queryOrderId || null);
  const [isResolvingRzp, setIsResolvingRzp] = useState(Boolean(!id && !queryOrderId && rzpOrderId));

  const [hasDirectCheckoutState] = useState(() =>
    Boolean(
      user?.id &&
      String(location.state?.confirmedUserId) === String(user.id) &&
      hasMatchingDirectCheckoutCelebration({
        userId: user.id,
        orderId: id || queryOrderId,
        token: location.state?.confirmationToken,
      })
    )
  );
  const [resolvedNewlyPaid, setResolvedNewlyPaid] = useState(Boolean(rzpOrderId));
  const [paymentMethodTitle, setPaymentMethodTitle] = useState(
    location.state?.paymentMethod || "Online Payment"
  );
  const [orderStatus, setOrderStatus] = useState(
    location.state?.status || "Processing"
  );
  const [order, setOrder] = useState(null);
  const [fetchError, setFetchError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [networkError, setNetworkError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [detailsFailed, setDetailsFailed] = useState(false);
  const chimePlayedRef = useRef(false);

  // Apply noindex, nofollow to keep order confirmation private from search engines
  useEffect(() => {
    let metaTag = document.querySelector('meta[name="robots"]');
    let created = false;
    if (!metaTag) {
      metaTag = document.createElement("meta");
      metaTag.name = "robots";
      document.head.appendChild(metaTag);
      created = true;
    }
    const previousContent = metaTag.content;
    metaTag.content = "noindex, nofollow";

    return () => {
      if (created && metaTag.parentNode) {
        metaTag.parentNode.removeChild(metaTag);
      } else if (metaTag) {
        metaTag.content = previousContent || "index, follow";
      }
    };
  }, []);

  // Handle cross-browser / UPI external redirect return with Razorpay query parameters
  useEffect(() => {
    if (activeOrderId) return;

    const resolvePayment = async () => {
      if (rzpOrderId) {
        setIsResolvingRzp(true);
        try {
          if (rzpPaymentId && rzpSignature) {
            const verifyRes = await verifyPayment({
              razorpay_order_id: rzpOrderId,
              razorpay_payment_id: rzpPaymentId,
              razorpay_signature: rzpSignature,
            });
            if (verifyRes?.success && verifyRes?.order_id) {
              clearPendingPayment(user?.id);
              clearCheckoutIdempotencyKey();
              setResolvedNewlyPaid(true);
              setActiveOrderId(String(verifyRes.order_id));
              setPaymentMethodTitle("Online Payment");
              setIsResolvingRzp(false);
              return;
            }
          }

          const statusRes = await checkPaymentStatus(rzpOrderId);
          if (statusRes?.success && statusRes?.order_id) {
            clearPendingPayment(user?.id);
            clearCheckoutIdempotencyKey();
            setResolvedNewlyPaid(true);
            setActiveOrderId(String(statusRes.order_id));
            setPaymentMethodTitle("Online Payment");
            setIsResolvingRzp(false);
            return;
          }
        } catch (_) {}
      }

      const storedPending = getPendingPayment(user?.id);
      if (storedPending?.razorpay_order_id) {
        try {
          const statusRes = await checkPaymentStatus(storedPending.razorpay_order_id);
          if (statusRes?.success && statusRes?.order_id) {
            clearPendingPayment(user?.id);
            clearCheckoutIdempotencyKey();
            setResolvedNewlyPaid(true);
            setActiveOrderId(String(statusRes.order_id));
            setPaymentMethodTitle("Online Payment");
            setIsResolvingRzp(false);
            return;
          }
        } catch (_) {}
      }

      setIsResolvingRzp(false);
      setFetchError(true);
      setErrorMessage("No order number provided.");
    };

    resolvePayment();
  }, [activeOrderId, rzpOrderId, rzpPaymentId, rzpSignature, user?.id]);

  // Fetch Order Details with automatic 3-attempt polling backoff
  useEffect(() => {
    if (!activeOrderId) return;

    let isMounted = true;
    let pollTimeout = null;
    setNetworkError(false);
    setFetchError(false);
    setDetailsFailed(false);

    const loadOrder = async (attempt = 1) => {
      try {
        const data = await getOrderById(activeOrderId);
        if (!isMounted) return;

        if (!data?.order) throw new Error("Order details unavailable");
        setOrder(data.order);

        if (matchesServerConfirmedCheckoutCelebration({ userId: user?.id, order: data.order })) {
          setResolvedNewlyPaid(true);
          const storedPending = getPendingPayment(user?.id);
          if (
            storedPending?.razorpay_order_id &&
            data.order?.razorpay_order_id &&
            String(storedPending.razorpay_order_id) === String(data.order.razorpay_order_id)
          ) {
            clearPendingPayment(user?.id);
            clearCheckoutIdempotencyKey(user?.id);
          }
        }

        if (data?.order?.payment_method_title) {
          setPaymentMethodTitle(data.order.payment_method_title);
        }
        if (data?.order?.display_status || data?.order?.status) {
          setOrderStatus(data.order.display_status || data.order.status);
        }
      } catch (err) {
        if (!isMounted) return;

        if (hasDirectCheckoutState) {
          setDetailsFailed(true);
          return;
        }

        const status = err?.response?.status;
        const isTerminalError = status === 404 || status === 403 || status === 401;

        if (attempt < 3) {
          pollTimeout = setTimeout(() => {
            if (isMounted) loadOrder(attempt + 1);
          }, 2500);
          return;
        }

        if (isTerminalError) {
          setFetchError(true);
          setNetworkError(false);
          setErrorMessage(
            err?.response?.data?.message ||
              `We couldn't locate Order #${activeOrderId}, or you do not have permission to view it.`
          );
        } else {
          setNetworkError(true);
          setFetchError(false);
        }
      }
    };

    loadOrder(1);

    return () => {
      isMounted = false;
      if (pollTimeout) clearTimeout(pollTimeout);
    };
  }, [activeOrderId, hasDirectCheckoutState, retryCount, user?.id]);

  // Play Paytm-style payment confirmation chime + tactile haptic once for newly confirmed orders
  const shouldCelebrate = Boolean(
    activeOrderId &&
    !isResolvingRzp &&
    !fetchError &&
    !networkError &&
    (hasDirectCheckoutState || resolvedNewlyPaid)
  );

  useEffect(() => {
    if (!shouldCelebrate || chimePlayedRef.current) return;
    chimePlayedRef.current = true;
    consumePendingCheckoutCelebration();
    triggerHaptic("success");
    void playOrderSuccessSound(activeOrderId);
  }, [shouldCelebrate, activeOrderId]);

  if (isResolvingRzp) {
    return (
      <main className="order-success-page relative min-h-screen w-full overflow-hidden bg-[#F0F8E8] flex items-center justify-center px-4">
        <div className="order-success-card w-full max-w-[440px] rounded-[28px] border border-[#E2E8F0] bg-[#FFFFFF] p-7 sm:p-9 text-center shadow-[0_14px_40px_rgba(15,23,42,0.09)]">
          <div className="order-success-state-icon mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#F0F8E8] text-[#22499F] border border-[#E2E8F0]">
            <Loader2 size={32} className="animate-spin" />
          </div>
          <h1 className="order-success-title text-[20px] font-black tracking-[-0.02em] text-[#1E293B]">
            Confirming Your Payment...
          </h1>
          <p className="order-success-sub mt-2 text-xs sm:text-sm leading-relaxed text-[#64748B]">
            We are connecting with your bank to verify your payment status and finalize your order.
          </p>
        </div>
      </main>
    );
  }

  if (!hasDirectCheckoutState && activeOrderId && !order && !networkError && !fetchError) {
    return (
      <main className="order-success-page min-h-[60vh] flex items-center justify-center p-8 text-center text-sm font-semibold text-[#64748B]" role="status">
        Loading order details...
      </main>
    );
  }

  if (networkError) {
    return (
      <main className="order-success-page relative min-h-screen w-full overflow-hidden bg-[#F0F8E8] flex items-center justify-center px-4">
        <div className="order-success-card w-full max-w-[440px] rounded-[28px] border border-[#E2E8F0] bg-[#FFFFFF] p-7 sm:p-9 text-center shadow-[0_14px_40px_rgba(15,23,42,0.09)]">
          <div className="order-success-state-icon mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#F0F8E8] text-[#22499F] border border-[#E2E8F0]">
            <Package size={32} className="animate-pulse" />
          </div>
          <h1 className="order-success-title text-[20px] font-black tracking-[-0.02em] text-[#1E293B]">
            Checking Your Order Details...
          </h1>
          <p className="order-success-sub mt-2 text-xs sm:text-sm leading-relaxed text-[#64748B]">
            We are reconnecting with the store server to retrieve your order details.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={() => setRetryCount((c) => c + 1)}
              className="order-success-cta inline-flex items-center justify-center gap-2 rounded-xl bg-[#22499F] px-5 py-2.5 text-xs font-black text-[#FFFFFF] shadow-sm hover:bg-[#1B3B82] transition cursor-pointer"
            >
              Retry Now
            </button>
            <Link
              to="/orders"
              className="order-success-secondary inline-flex items-center justify-center rounded-xl border border-[#E2E8F0] bg-[#F8FAF6] px-5 py-2.5 text-xs font-bold text-[#475569] hover:bg-[#F0F8E8] hover:text-[#1E293B] transition"
            >
              View My Orders
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (fetchError) {
    return (
      <main className="order-success-page relative min-h-screen w-full overflow-hidden bg-[#F0F8E8] flex items-center justify-center px-4">
        <div className="order-success-card w-full max-w-[440px] rounded-[28px] border border-[#E2E8F0] bg-[#FFFFFF] p-7 sm:p-9 text-center shadow-[0_14px_40px_rgba(15,23,42,0.09)]">
          <div className="order-success-error-icon mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-rose-600 border border-rose-200">
            <AlertCircle size={32} />
          </div>
          <h1 className="order-success-title text-[22px] font-black tracking-[-0.02em] text-[#1E293B]">
            Order Not Found
          </h1>
          <p className="order-success-sub mt-2 text-xs sm:text-sm leading-relaxed text-[#64748B]">
            {errorMessage || `We couldn't locate Order #${id}, or you do not have permission to view it.`}
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/orders"
              className="order-success-cta inline-flex items-center justify-center rounded-xl bg-[#22499F] px-5 py-2.5 text-xs font-black text-[#FFFFFF] shadow-sm hover:bg-[#1B3B82] transition"
            >
              View My Orders
            </Link>
            <Link
              to="/"
              className="order-success-secondary inline-flex items-center justify-center rounded-xl border border-[#E2E8F0] bg-[#F8FAF6] px-5 py-2.5 text-xs font-bold text-[#475569] hover:bg-[#F0F8E8] hover:text-[#1E293B] transition"
            >
              Return to Shop
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const scheduledDeliveryMeta = order?.meta_data?.find((m) => m.key === "_scheduled_delivery_label")?.value;
  const isAfterHours = Boolean(location.state?.isAfterHours || isScheduledFulfillmentOrder(order) || scheduledDeliveryMeta);
  const needsDeliveryReview = isPaymentAwaitingDeliveryReview(order);
  const scheduledFulfillmentLabel = getScheduledFulfillmentLabel(order);
  const deliveryEtaText = detailsFailed && !order
    ? "Delivery timing unavailable"
    : !order
      ? "Checking delivery timing…"
      : needsDeliveryReview
        ? "To be confirmed by store"
        : isAfterHours
          ? `${scheduledFulfillmentLabel} (Delivery follows)`
          : "Same Day Delivery";

  return (
    <div className="order-success-page min-h-[calc(100vh-2rem)] w-full bg-[#F0F8E8] text-[#1E293B] flex items-center justify-center px-4 py-8 sm:py-12">
      <div className="order-success-enter w-full max-w-[440px]">
        {/* MAIN CARD */}
        <section className="order-success-card relative overflow-hidden rounded-[28px] border border-[#E2E8F0] bg-[#FFFFFF] p-6 sm:p-8 shadow-[0_18px_50px_rgba(15,23,42,0.10)]">
          {/* Subtle ambient top glow */}
          <div className="order-success-glow pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 h-40 w-72 rounded-full blur-3xl" />

          {/* Celebratory Animated Success Tick */}
          <div className="order-success-tick-wrap relative mx-auto mb-5 flex h-24 w-24 items-center justify-center">
            <span className="order-success-tick-ripple" aria-hidden="true" />
            <span className="order-success-tick-halo" aria-hidden="true" />
            <div className="order-success-tick-disc relative z-10 flex h-20 w-20 items-center justify-center rounded-full shadow-lg">
              <svg
                viewBox="0 0 52 52"
                className="h-11 w-11 text-white"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M14.5 27.5L22.2 35.2L38.5 17.5"
                  stroke="currentColor"
                  strokeWidth="4.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="order-success-check-path"
                />
              </svg>
            </div>
          </div>

          {/* Order Number Badge & Title */}
          <div className="text-center">
            <p className="order-success-badge mb-1.5 text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#22499F]">
              Order #{activeOrderId || id}
            </p>

            <h1 className="order-success-title text-2xl sm:text-[26px] font-black leading-snug tracking-[-0.02em] text-[#1E293B]">
              Order Placed Successfully!
            </h1>
          </div>

          {/* Night Order Notification Card */}
          {isAfterHours && (
            <div className="order-success-scheduled mt-5 rounded-2xl bg-[#0E223D] border border-[#22499F]/35 p-3.5 text-left flex items-center gap-3">
              <div className="order-success-scheduled-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFFFFF] text-[#22499F] border border-[#22499F]/40 shadow-xs">
                <Moon size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-black text-white">
                  Scheduled fulfillment · {scheduledFulfillmentLabel}
                </p>
                <p className="order-success-scheduled-copy text-[11px] font-semibold text-slate-200 mt-0.5 leading-tight">
                  Our team will begin preparing your order when the store opens. Delivery follows preparation.
                </p>
              </div>
            </div>
          )}
          {needsDeliveryReview && (
            <div className="order-success-review mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-left">
              <p className="order-success-review-title text-xs font-black text-amber-900">
                Payment received · Fulfillment confirmation pending
              </p>
              <p className="order-success-review-copy mt-1 text-[11px] font-semibold leading-tight text-amber-800">
                Your payment is safe. The store team will contact you to confirm delivery timing.
              </p>
            </div>
          )}

          {/* Order Summary Details Box */}
          {detailsFailed && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setRetryCount((count) => count + 1)}
                className="order-success-link text-xs font-bold text-[#22499F] underline cursor-pointer"
              >
                Retry delivery details
              </button>
            </div>
          )}

          <div className="order-success-summary mt-6 rounded-2xl border border-[#E2E8F0] bg-[#F8FAF6] px-4 py-1">
            <SummaryRow
              icon={<Package size={17} />}
              label="Order Number"
              value={`#${activeOrderId || id}`}
            />

            <SummaryRow
              icon={<span className="order-success-dot h-2.5 w-2.5 rounded-full bg-[#22499F]" />}
              label="Status"
              value={
                <span className="order-success-status inline-block rounded-full border border-[#22499F]/30 bg-[#FFFFFF] px-3 py-1 text-xs font-extrabold text-[#22499F]">
                  {orderStatus}
                </span>
              }
            />

            <SummaryRow
              icon={<CreditCard size={17} />}
              label="Payment"
              value={paymentMethodTitle}
            />

            <SummaryRow
              icon={isAfterHours ? <Moon size={17} /> : <Calendar size={17} />}
              label={isAfterHours ? "Fulfillment Starts" : "Est. Delivery"}
              value={
                <span className="order-success-eta font-extrabold text-[#22499F]">
                  {deliveryEtaText}
                </span>
              }
              last
            />
          </div>

          {/* Action Buttons */}
          <div className="mt-6 space-y-3">
            {/* Track Order CTA */}
            <Link
              to={`/orders/${activeOrderId || id}/track`}
              onClick={() => triggerHaptic("medium")}
              className="order-success-cta group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#22499F] px-5 text-sm font-black text-[#FFFFFF] shadow-[0_6px_18px_rgba(34,73,159,0.28)] transition-all hover:bg-[#1B3B82] active:scale-[0.99] cursor-pointer"
            >
              <MapPin size={18} strokeWidth={2.3} />
              <span>Track Order</span>
              <ArrowRight
                size={16}
                className="transition-transform group-hover:translate-x-1"
              />
            </Link>

            {/* Continue Shopping */}
            <Link
              to="/"
              onClick={() => triggerHaptic("light")}
              className="order-success-secondary flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] px-5 text-sm font-bold text-[#475569] transition-all hover:bg-[#F0F8E8] hover:text-[#1E293B] active:scale-[0.99] cursor-pointer"
            >
              <Home size={17} />
              <span>Continue Shopping</span>
            </Link>
          </div>

          {/* Support Link */}
          <p className="order-success-support mt-5 text-center text-xs font-medium text-[#64748B]">
            Need help?{" "}
            <Link
              to="/contact"
              className="order-success-link font-bold text-[#22499F] hover:underline"
            >
              Contact Support
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}

function SummaryRow({ icon, label, value, last = false }) {
  return (
    <div
      className={`order-success-row flex min-h-[50px] items-center justify-between gap-3 ${
        !last ? "border-b border-[#E2E8F0]" : ""
      }`}
    >
      <div className="order-success-label flex shrink-0 items-center gap-2.5 text-sm font-medium text-[#64748B] whitespace-nowrap">
        <span className="order-success-row-icon flex w-[18px] shrink-0 items-center justify-center text-[#22499F]">
          {icon}
        </span>
        <span>{label}</span>
      </div>

      <div className="order-success-value min-w-0 text-right text-sm font-extrabold text-[#1E293B] break-words">
        {value}
      </div>
    </div>
  );
}

export default OrderSuccess;
