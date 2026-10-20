import { useState, useEffect, useRef } from "react";
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
} from "lucide-react";
import { getOrderById } from "../services/orderService.js";
import { verifyPayment, checkPaymentStatus } from "../services/paymentService.js";
import {
  getPendingPayment,
  clearPendingPayment,
  clearCheckoutIdempotencyKey,
} from "../utils/checkoutIdempotency.js";

function OrderSuccess() {
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
          // If signature was provided in callback URL, verify it directly
          if (rzpPaymentId && rzpSignature) {
            const verifyRes = await verifyPayment({
              razorpay_order_id: rzpOrderId,
              razorpay_payment_id: rzpPaymentId,
              razorpay_signature: rzpSignature,
            });
            if (verifyRes?.success && verifyRes?.order_id) {
              clearPendingPayment();
              clearCheckoutIdempotencyKey();
              setActiveOrderId(String(verifyRes.order_id));
              setPaymentMethodTitle("Online Payment");
              setIsResolvingRzp(false);
              return;
            }
          }

          // Otherwise check status from server/gateway
          const statusRes = await checkPaymentStatus(rzpOrderId);
          if (statusRes?.success && statusRes?.order_id) {
            clearPendingPayment();
            clearCheckoutIdempotencyKey();
            setActiveOrderId(String(statusRes.order_id));
            setPaymentMethodTitle("Online Payment");
            setIsResolvingRzp(false);
            return;
          }
        } catch (_) {}
      }

      // Check localStorage pendingPayment fallback
      const storedPending = getPendingPayment();
      if (storedPending?.razorpay_order_id) {
        try {
          const statusRes = await checkPaymentStatus(storedPending.razorpay_order_id);
          if (statusRes?.success && statusRes?.order_id) {
            clearPendingPayment();
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
  }, [activeOrderId, rzpOrderId, rzpPaymentId, rzpSignature]);

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

        clearPendingPayment();
        clearCheckoutIdempotencyKey();

        if (data?.order?.payment_method_title) {
          setPaymentMethodTitle(data.order.payment_method_title);
        }
        if (data?.order?.display_status || data?.order?.status) {
          setOrderStatus(data.order.display_status || data.order.status);
        }
      } catch (err) {
        if (!isMounted) return;

        // If the user arrived directly from checkout navigation, retain the optimistic state
        if (hasDirectCheckoutState) {
          return;
        }

        const status = err?.response?.status;
        const isTerminalError = status === 404 || status === 403 || status === 401;

        // Automatic retry loop: retry up to 3 times (2.5s apart) before marking terminal
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
          // Network offline, timeout, or 5xx server glitch: do NOT claim "Order Not Found"
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
      <main className="relative min-h-screen w-full overflow-hidden bg-[#0B1425]">
        <div className="relative z-10 flex w-full justify-center px-4 py-16 sm:px-6 lg:items-center">
          <div className="w-full max-w-[480px] rounded-2xl sm:rounded-[24px] border border-[#1E3252] bg-[#111F36] p-7 sm:p-9 text-center shadow-[0_12px_40px_rgba(0,0,0,0.4)]">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#132B45] text-[#42D6E8] border border-[#1E3252]">
              <Loader2 size={30} className="animate-spin" />
            </div>
            <h1 className="text-[20px] font-black tracking-[-0.02em] text-[#F1F5F9]">
              Confirming Your Payment...
            </h1>
            <p className="mt-2 text-xs sm:text-sm leading-relaxed text-[#8FA4BE]">
              We are connecting with your bank to verify your payment status and finalize your order.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (networkError) {
    return (
      <main className="relative min-h-screen w-full overflow-hidden bg-[#0B1425]">
        <div className="relative z-10 flex w-full justify-center px-4 py-16 sm:px-6 lg:items-center">
          <div className="w-full max-w-[480px] rounded-2xl sm:rounded-[24px] border border-[#1E3252] bg-[#111F36] p-7 sm:p-9 text-center shadow-[0_12px_40px_rgba(0,0,0,0.4)]">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#132B45] text-[#42D6E8] border border-[#1E3252]">
              <Package size={30} className="animate-pulse" />
            </div>
            <h1 className="text-[20px] font-black tracking-[-0.02em] text-[#F1F5F9]">
              Checking Your Order Details...
            </h1>
            <p className="mt-2 text-xs sm:text-sm leading-relaxed text-[#8FA4BE]">
              Your order #{activeOrderId || id} is safe. We are reconnecting with the store server to retrieve your confirmation details.
            </p>
            <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
              <button
                type="button"
                onClick={() => setRetryCount((c) => c + 1)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#42D6E8] px-5 py-2.5 text-xs font-black text-[#061220] shadow-sm hover:bg-[#2CC4D8] transition cursor-pointer"
              >
                Retry Now
              </button>
              <Link
                to="/orders"
                className="inline-flex items-center justify-center rounded-xl border border-[#1E3252] bg-transparent px-5 py-2.5 text-xs font-bold text-[#8FA4BE] hover:bg-[#162744] hover:text-[#F1F5F9] transition"
              >
                View My Orders
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (fetchError) {
    return (
      <main className="relative min-h-screen w-full overflow-hidden bg-[#0B1425]">
        <div className="relative z-10 flex w-full justify-center px-4 py-16 sm:px-6 lg:items-center">
          <div className="w-full max-w-[480px] rounded-2xl sm:rounded-[24px] border border-[#1E3252] bg-[#111F36] p-7 sm:p-9 text-center shadow-[0_12px_40px_rgba(0,0,0,0.4)]">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-950/60 text-rose-300 border border-rose-800/60">
              <AlertCircle size={32} />
            </div>
            <h1 className="text-[22px] font-black tracking-[-0.02em] text-[#F1F5F9]">
              Order Not Found
            </h1>
            <p className="mt-2 text-xs sm:text-sm leading-relaxed text-[#8FA4BE]">
              {errorMessage || `We couldn't locate Order #${id}, or you do not have permission to view it.`}
            </p>
            <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                to="/orders"
                className="inline-flex items-center justify-center rounded-xl bg-[#42D6E8] px-5 py-2.5 text-xs font-black text-[#061220] shadow-sm hover:bg-[#2CC4D8] transition"
              >
                View My Orders
              </Link>
              <Link
                to="/"
                className="inline-flex items-center justify-center rounded-xl border border-[#1E3252] bg-transparent px-5 py-2.5 text-xs font-bold text-[#8FA4BE] hover:bg-[#162744] hover:text-[#F1F5F9] transition"
              >
                Return to Shop
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#0B1425] flex flex-col justify-start sm:justify-center">
      {/* Full-width content area */}
      <div className="relative z-10 flex w-full flex-1 justify-center px-0 py-2 sm:px-5 sm:py-8 lg:items-center lg:px-8 lg:py-8">

        <div className="w-full max-w-[960px] animate-[slideUp_0.3s_ease-out]">

          {/* MAIN CARD */}
          <section className="overflow-hidden bg-[#111F36] sm:rounded-[28px] border border-[#1E3252] shadow-[0_12px_40px_rgba(0,0,0,0.4)]">

            <div className="grid lg:grid-cols-[0.9fr_1.1fr]">

              {/* LEFT SIDE */}
              <div className="flex flex-col justify-center px-5 pt-7 pb-5 text-center sm:px-8 sm:py-8 lg:border-r lg:border-[#1E3252]/70 lg:px-10 lg:py-10 lg:text-left">

                {/* Success Icon */}
                <div className="mb-3.5 flex justify-center lg:justify-start">
                  <div className="relative flex h-[64px] w-[64px] items-center justify-center rounded-full bg-[#132B45] sm:h-[68px] sm:w-[68px]">
                    <span className="absolute inset-0 rounded-full bg-[#42D6E8]/35 animate-ping opacity-75" />
                    <span className="absolute -inset-1.5 rounded-full bg-[#42D6E8]/20 animate-pulse" />
                    <div className="relative z-10 flex h-full w-full items-center justify-center rounded-full bg-[#132B45] shadow-[0_4px_16px_rgba(66,214,232,0.25)] border border-[#1E3252]">
                      <CheckCircle2
                        size={36}
                        className="text-[#42D6E8]"
                        style={{ animation: "checkBlink 1.8s ease-in-out infinite" }}
                        strokeWidth={2.4}
                      />
                    </div>
                  </div>
                </div>

                <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#42D6E8]">
                  Order #{activeOrderId || id}
                </p>

                <h1 className="text-[23px] font-black leading-snug tracking-[-0.02em] text-[#F1F5F9] sm:text-[28px] lg:text-[29px]">
                  Order Placed <span className="inline-block">Successfully! 🎉</span>
                </h1>

                <p className="mx-auto mt-2 max-w-[400px] text-[14px] font-medium leading-relaxed text-[#8FA4BE] sm:text-[15px] sm:leading-6 lg:mx-0">
                  Thank you for shopping with Mumbai Collection.
                  Your order is confirmed and is now being processed.
                </p>
              </div>

              {/* RIGHT SIDE */}
              <div className="px-4 pt-1 pb-6 sm:px-7 sm:py-7 lg:px-9 lg:py-9">

                {/* Order Summary */}
                <div className="rounded-2xl border border-[#1E3252] bg-[#080F1C] px-4 py-0.5">

                  <SummaryRow
                    icon={<Package size={17} />}
                    label="Order Number"
                    value={`#${activeOrderId || id}`}
                  />

                  <SummaryRow
                    icon={
                      <span className="h-2.5 w-2.5 rounded-full bg-[#42D6E8]" />
                    }
                    label="Status"
                    value={
                      <span className="rounded-full border border-[#1E3252] bg-[#132B45] px-2.5 py-1 text-[11px] font-extrabold text-[#67E8F9]">
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
                    icon={<Calendar size={17} />}
                    label="Est. Delivery"
                    value={
                      <span className="font-extrabold text-[#42D6E8]">
                        60–90 mins
                      </span>
                    }
                    last
                  />
                </div>

                {/* Short message */}
                <p className="mt-3.5 text-center text-[12px] font-medium leading-relaxed text-[#8FA4BE] sm:text-[13px]">
                  Our local team will begin packing and dispatching your order shortly.
                </p>

                {/* Buttons */}
                <div className="mt-4 space-y-2.5">

                  {/* Track */}
                  <Link
                    to={`/orders/${activeOrderId || id}/track`}
                    className="group flex h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-[#42D6E8] px-4 text-sm font-black text-[#061220] shadow-[0_5px_16px_rgba(66,214,232,0.3)] transition-all hover:bg-[#2CC4D8] active:scale-[0.99]"
                  >
                    <MapPin size={18} strokeWidth={2.3} />

                    <span>Track Live Order</span>

                    <ArrowRight
                      size={16}
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>

                  {/* Continue Shopping */}
                  <Link
                    to="/"
                    className="flex h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-[#1E3252] bg-transparent px-4 text-sm font-bold text-[#8FA4BE] transition-all hover:bg-[#162744] hover:text-[#F1F5F9] active:scale-[0.99]"
                  >
                    <Home size={17} />

                    <span>Continue Shopping</span>
                  </Link>
                </div>

                {/* Support */}
                <p className="mt-3.5 text-center text-[11px] font-medium text-[#6E84A3] sm:text-[12px]">
                  Need help?{" "}
                  <Link
                    to="/contact"
                    className="font-bold text-[#42D6E8] hover:underline"
                  >
                    Contact Support
                  </Link>
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes slideUp {
              from {
                opacity: 0;
                transform: translateY(8px);
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
                filter: drop-shadow(0 0 0px rgba(66, 214, 232, 0));
              }
              50% {
                transform: scale(1.08);
                opacity: 0.65;
                filter: drop-shadow(0 0 8px rgba(66, 214, 232, 0.4));
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
      className={`flex min-h-[52px] items-center justify-between gap-3 ${
        !last ? "border-b border-[#1E3252]/70" : ""
      }`}
    >
      <div className="flex min-w-0 items-center gap-2.5 text-xs font-medium text-[#8FA4BE]">
        <span className="flex w-[18px] shrink-0 items-center justify-center text-[#42D6E8]">
          {icon}
        </span>

        <span>{label}</span>
      </div>

      <div className="shrink-0 text-right text-xs font-extrabold text-[#F1F5F9]">
        {value}
      </div>
    </div>
  );
}

export default OrderSuccess;