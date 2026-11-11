import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useParams, Link, useLocation, useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
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
import { verifyPayment, checkPaymentStatus } from "../services/paymentService.js";
import {
  getPendingPayment,
  clearPendingPayment,
  clearCheckoutIdempotencyKey,
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

  const hasDirectCheckoutState = Boolean(
    location.state?.paymentMethod || location.state?.status
  );
  const [paymentMethodTitle, setPaymentMethodTitle] = useState(
    location.state?.paymentMethod || "Online Payment"
  );
  const [orderStatus, setOrderStatus] = useState(
    location.state?.status || "Processing"
  );
  const [fetchError, setFetchError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [networkError, setNetworkError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [pollAttempt, setPollAttempt] = useState(0);

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

    const loadOrder = async (attempt = 1) => {
      try {
        setPollAttempt(attempt);
        const data = await getOrderById(activeOrderId);
        if (!isMounted) return;

        if (data?.order?.payment_method_title) {
          setPaymentMethodTitle(data.order.payment_method_title);
        }
        if (data?.order?.display_status || data?.order?.status) {
          setOrderStatus(data.order.display_status || data.order.status);
        }
      } catch (err) {
        if (!isMounted) return;

        if (hasDirectCheckoutState) {
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
  }, [activeOrderId, hasDirectCheckoutState, retryCount]);

  if (isResolvingRzp) {
    return (
      <main className="relative min-h-screen w-full overflow-hidden bg-[#F0F8E8] flex items-center justify-center px-4">
        <div className="w-full max-w-[440px] rounded-3xl border border-[#E2E8F0] bg-[#FFFFFF] p-7 sm:p-9 text-center shadow-[0_12px_40px_rgba(0,0,0,0.4)]">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0]">
            <Loader2 size={30} className="animate-spin" />
          </div>
          <h1 className="text-[20px] font-black tracking-[-0.02em] text-[#1E293B]">
            Confirming Your Payment...
          </h1>
          <p className="mt-2 text-xs sm:text-sm leading-relaxed text-[#64748B]">
            We are connecting with your bank to verify your payment status and finalize your order.
          </p>
        </div>
      </main>
    );
  }

  if (networkError) {
    return (
      <main className="relative min-h-screen w-full overflow-hidden bg-[#F0F8E8] flex items-center justify-center px-4">
        <div className="w-full max-w-[440px] rounded-3xl border border-[#E2E8F0] bg-[#FFFFFF] p-7 sm:p-9 text-center shadow-[0_12px_40px_rgba(0,0,0,0.4)]">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0]">
            <Package size={30} className="animate-pulse" />
          </div>
          <h1 className="text-[20px] font-black tracking-[-0.02em] text-[#1E293B]">
            Checking Your Order Details...
          </h1>
          <p className="mt-2 text-xs sm:text-sm leading-relaxed text-[#64748B]">
            Your order #{activeOrderId || id} is safe. We are reconnecting with the store server to retrieve your confirmation details.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={() => setRetryCount((c) => c + 1)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#22499F] px-5 py-2.5 text-xs font-black text-[#FFFFFF] shadow-sm hover:bg-[#1B3B82] transition cursor-pointer"
            >
              Retry Now
            </button>
            <Link
              to="/orders"
              className="inline-flex items-center justify-center rounded-xl border border-[#E2E8F0] bg-transparent px-5 py-2.5 text-xs font-bold text-[#64748B] hover:bg-[#FFFFFF] hover:text-[#1E293B] transition"
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
      <main className="relative min-h-screen w-full overflow-hidden bg-[#F0F8E8] flex items-center justify-center px-4">
        <div className="w-full max-w-[440px] rounded-3xl border border-[#E2E8F0] bg-[#FFFFFF] p-7 sm:p-9 text-center shadow-[0_12px_40px_rgba(0,0,0,0.4)]">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-950/60 text-rose-300 border border-rose-800/60">
            <AlertCircle size={32} />
          </div>
          <h1 className="text-[22px] font-black tracking-[-0.02em] text-[#1E293B]">
            Order Not Found
          </h1>
          <p className="mt-2 text-xs sm:text-sm leading-relaxed text-[#64748B]">
            {errorMessage || `We couldn't locate Order #${id}, or you do not have permission to view it.`}
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/orders"
              className="inline-flex items-center justify-center rounded-xl bg-[#22499F] px-5 py-2.5 text-xs font-black text-[#FFFFFF] shadow-sm hover:bg-[#1B3B82] transition"
            >
              View My Orders
            </Link>
            <Link
              to="/"
              className="inline-flex items-center justify-center rounded-xl border border-[#E2E8F0] bg-transparent px-5 py-2.5 text-xs font-bold text-[#64748B] hover:bg-[#FFFFFF] hover:text-[#1E293B] transition"
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
  const deliveryEtaText = needsDeliveryReview
    ? "To be confirmed by the store"
    : isAfterHours
      ? scheduledFulfillmentLabel
    : "60–90 mins";

  return (
    <div className="min-h-[calc(100vh-2rem)] w-full bg-[#F0F8E8] text-[#1E293B] flex items-center justify-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-[460px] animate-[slideUp_0.3s_ease-out]">

        {/* MAIN CARD */}
        <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#FFFFFF]/95 backdrop-blur-xl p-6 sm:p-8 shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
          {/* Subtle ambient cyan glow */}
          <div className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 h-36 w-64 rounded-full bg-[#22499F]/15 blur-3xl" />

          {/* Success Icon */}
          <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#FFFFFF] shadow-[0_4px_20px_rgba(66,214,232,0.3)] border border-[#22499F]/35">
            <span className="absolute -inset-1.5 rounded-full bg-[#22499F]/20 animate-pulse" />
            <CheckCircle2
              size={36}
              className="text-[#22499F] relative z-10"
              strokeWidth={2.4}
              style={{ animation: "checkBlink 2s ease-in-out infinite" }}
            />
          </div>

          {/* Order Number Badge */}
          <div className="text-center">
            <p className="mb-1 text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#22499F]">
              Order #{activeOrderId || id}
            </p>

            <h1 className="text-2xl sm:text-[26px] font-black leading-snug tracking-[-0.02em] text-[#1E293B]">
              Order Placed Successfully! 🎉
            </h1>

            <p className="mt-2 text-xs sm:text-[13px] font-medium leading-relaxed text-[#64748B]">
              Thank you for shopping with Mumbai Collection. Your order is confirmed and is now being processed.
            </p>
          </div>

          {/* Night Order Notification Card */}
          {isAfterHours && (
            <div className="mt-4 rounded-2xl bg-[#0E223D] border border-[#22499F]/35 p-3.5 text-left flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFFFFF] text-[#22499F] border border-[#22499F]/40 shadow-xs">
                <Moon size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-black text-white">
                  🌙 Scheduled fulfillment · {scheduledFulfillmentLabel}
                </p>
                <p className="text-[11px] font-semibold text-[#22499F] mt-0.5 leading-tight">
                  Our team will begin preparing your order when the store opens. Delivery follows preparation and is not guaranteed at opening time.
                </p>
              </div>
            </div>
          )}
          {needsDeliveryReview && (
            <div className="mt-4 rounded-2xl border border-amber-400/35 bg-amber-950/30 p-3.5 text-left">
              <p className="text-xs font-black text-amber-200">Payment received · Fulfillment confirmation pending</p>
              <p className="mt-1 text-[11px] font-semibold leading-tight text-amber-100/90">Your payment is safe. The store team will contact you to confirm delivery timing.</p>
            </div>
          )}

          {/* Order Summary Details Box */}
          <div className="mt-6 rounded-2xl border border-white/10 bg-[#F0F8E8]/80 px-4 py-1 shadow-inner">
            <SummaryRow
              icon={<Package size={17} />}
              label="Order Number"
              value={`#${activeOrderId || id}`}
            />

            <SummaryRow
              icon={<span className="h-2.5 w-2.5 rounded-full bg-[#22499F]" />}
              label="Status"
              value={
                <span className="rounded-full border border-[#22499F]/30 bg-[#FFFFFF] px-2.5 py-1 text-[11px] font-extrabold text-[#22499F]">
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
              icon={isAfterHours ? <Moon size={17} className="text-[#22499F]" /> : <Calendar size={17} />}
              label="Est. Delivery"
              value={
                <span className="font-extrabold text-[#22499F]">
                  {deliveryEtaText}
                </span>
              }
              last
            />
          </div>

          {/* Short Helper Notice */}
          <p className="mt-4 text-center text-xs font-medium leading-relaxed text-[#64748B]">
            {needsDeliveryReview
              ? "Payment is confirmed. Our store team will contact you to arrange fulfillment."
              : isAfterHours
              ? `Fulfillment begins when the store opens (${scheduledFulfillmentLabel}); delivery follows preparation.`
              : "Our local team will begin packing and dispatching your order shortly."}
          </p>

          {/* Action Buttons */}
          <div className="mt-6 space-y-3">
            {/* Track Order CTA */}
            <Link
              to={`/orders/${activeOrderId || id}/track`}
              onClick={() => triggerHaptic("medium")}
              className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#22499F] px-5 text-sm font-black text-[#FFFFFF] shadow-[0_4px_16px_rgba(66,214,232,0.3)] transition-all hover:bg-[#1B3B82] active:scale-[0.99] cursor-pointer"
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
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-bold text-[#64748B] transition-all hover:bg-white/10 hover:text-white active:scale-[0.99] cursor-pointer"
            >
              <Home size={17} />
              <span>Continue Shopping</span>
            </Link>
          </div>

          {/* Support Link */}
          <p className="mt-4 text-center text-[11px] font-medium text-[#64748B]">
            Need help?{" "}
            <Link
              to="/contact"
              className="font-bold text-[#22499F] hover:underline"
            >
              Contact Support
            </Link>
          </p>
        </section>

      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes slideUp {
              from {
                opacity: 0;
                transform: translateY(12px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
            @keyframes checkBlink {
              0%, 100% {
                transform: scale(1);
                opacity: 1;
              }
              50% {
                transform: scale(1.06);
                opacity: 0.85;
              }
            }
          `,
        }}
      />
    </div>
  );
}

function SummaryRow({ icon, label, value, last = false }) {
  return (
    <div
      className={`flex min-h-[50px] items-center justify-between gap-3 ${
        !last ? "border-b border-white/8" : ""
      }`}
    >
      <div className="flex min-w-0 items-center gap-2.5 text-xs font-medium text-[#64748B]">
        <span className="flex w-[18px] shrink-0 items-center justify-center text-[#22499F]">
          {icon}
        </span>
        <span>{label}</span>
      </div>

      <div className="shrink-0 text-right text-xs font-extrabold text-[#1E293B]">
        {value}
      </div>
    </div>
  );
}

export default OrderSuccess;
