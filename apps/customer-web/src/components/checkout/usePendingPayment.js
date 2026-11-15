import { useState, useRef, useEffect, useCallback } from "react";
import { checkPaymentStatus, cancelPaymentOrder } from "../../services/paymentService.js";
import {
  getPendingPayment,
  setPendingPayment,
  clearPendingPayment,
  clearCheckoutIdempotencyKey,
  retireCheckoutIdempotencyKey,
  generateUUID,
} from "../../utils/checkoutIdempotency.js";

const BACKOFF_SCHEDULE = [2000, 4000, 8000, 15000, 30000, 30000, 30000, 30000, 30000];

export function usePendingPayment({
  user,
  checkoutExpiredUserId,
  isAuthenticated,
  handleSessionExpired,
  cart,
  navigate,
  refreshCart,
  setError,
  setUnconfirmedQuote,
  idempotencyKeyRef,
  activeOrderRef,
  activeUserRef,
}) {
  const [pollAttempt, setPollAttempt] = useState(0);
  const [isPersistentPending, setIsPersistentPending] = useState(false);
  const [checkingPendingStatus, setCheckingPendingStatus] = useState(false);
  const [cancellingPending, setCancellingPending] = useState(false);
  const [sessionExpiredPending, setSessionExpiredPending] = useState(false);
  const pollTimerRef = useRef(null);

  const verifyPendingOrder = useCallback(
    async (isManualOrTrigger = false) => {
      const stored = getPendingPayment(user?.id || checkoutExpiredUserId);
      if (!stored || !stored.razorpay_order_id) {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        setIsPersistentPending(false);
        if (activeOrderRef) activeOrderRef.current = null;
        return;
      }

      if (!isAuthenticated || !user?.id) return;
      const requestUserId = user.id;
      const requestOrderId = stored.razorpay_order_id;
      if (activeOrderRef) activeOrderRef.current = requestOrderId;

      // Query payment finalization state by Razorpay order ID FIRST
      try {
        setCheckingPendingStatus(true);
        const res = await checkPaymentStatus(requestOrderId);
        if (
          String(activeUserRef?.current) !== String(requestUserId) ||
          activeOrderRef?.current !== requestOrderId
        ) {
          return;
        }

        if (res?.success && res?.order_id) {
          if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
          clearPendingPayment(user?.id);
          clearCheckoutIdempotencyKey(user?.id);
          await refreshCart().catch(() => {});
          navigate(`/order-success/${res.order_id}`, {
            state: { paymentMethod: "Online Payment", status: res.orderStatus || "Processing" },
            replace: true,
          });
          return;
        }

        if (res?.support_required) {
          if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
          const pending = getPendingPayment(user?.id);
          if (pending) {
            setPendingPayment(
              {
                ...pending,
                support_required: true,
                message: res.message || "This payment requires staff review. Please do not pay again.",
              },
              user?.id
            );
          }
          setIsPersistentPending(true);
          setError(
            res.message ||
              "This payment requires staff review. Please do not pay again; contact support with your checkout reference."
          );
          return;
        }

        if (res?.refunded || res?.terminal || res?.cancelled) {
          if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
          clearPendingPayment(user?.id);
          retireCheckoutIdempotencyKey(user?.id);
          if (idempotencyKeyRef) idempotencyKeyRef.current = generateUUID();
          await refreshCart().catch(() => {});
          setError(
            res.message ||
              (res.refunded
                ? "Your payment was refunded."
                : "This payment attempt has ended. You can start a fresh checkout.")
          );
          setIsPersistentPending(false);
          return;
        }
      } catch (err) {
        if (String(activeUserRef?.current) !== String(requestUserId)) return;
        if (err?.response?.status === 401) {
          if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
          setSessionExpiredPending(true);
          setError("");
          handleSessionExpired?.({ checkout: true });
          return;
        }
        setError(
          "Could not verify payment status with gateway. Please tap 'Check Payment Status' to retry."
        );
      } finally {
        setCheckingPendingStatus(false);
      }

      // Schedule next backoff attempt: 2s, 4s, 8s, 15s, then every 30s (~3 min)
      setPollAttempt((prev) => {
        const nextAttempt = isManualOrTrigger ? 0 : prev + 1;
        if (nextAttempt < BACKOFF_SCHEDULE.length) {
          const delay = BACKOFF_SCHEDULE[nextAttempt];
          if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
          pollTimerRef.current = setTimeout(() => {
            verifyPendingOrder(false);
          }, delay);
          setIsPersistentPending(false);
        } else {
          setIsPersistentPending(true);
        }
        return nextAttempt;
      });
    },
    [cart, navigate, refreshCart, user?.id, isAuthenticated, checkoutExpiredUserId, handleSessionExpired, activeOrderRef, activeUserRef, idempotencyKeyRef, setError]
  );

  const handleCancelUnpaidCheckout = async () => {
    const stored = getPendingPayment(user?.id || checkoutExpiredUserId);
    if (!stored?.razorpay_order_id || cancellingPending) return;
    const requestUserId = user?.id;
    const requestOrderId = stored.razorpay_order_id;

    try {
      setCancellingPending(true);
      setError("");
      const res = await cancelPaymentOrder(requestOrderId);
      if (
        String(activeUserRef?.current) !== String(requestUserId) ||
        activeOrderRef?.current !== requestOrderId
      ) {
        return;
      }

      if (res?.cancelled || res?.terminal) {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        clearPendingPayment(user?.id);
        retireCheckoutIdempotencyKey(user?.id);
        if (idempotencyKeyRef) idempotencyKeyRef.current = generateUUID();
        setIsPersistentPending(false);
        if (setUnconfirmedQuote) setUnconfirmedQuote(null);
        setError("Checkout session cancelled. You can retry paying anytime.");
        await refreshCart().catch(() => {});
      } else if (
        res?.status === 409 ||
        res?.code === "PAYMENT_ALREADY_CAPTURED" ||
        res?.code === "PAYMENT_PROCESSING"
      ) {
        setError(res.message || "A payment is processing. Please check status before paying again.");
        setIsPersistentPending(true);
      } else {
        setError(res?.message || "Unable to confirm cancellation. Please retry.");
      }
    } catch (err) {
      if (
        String(activeUserRef?.current) !== String(requestUserId) ||
        activeOrderRef?.current !== requestOrderId
      ) {
        return;
      }
      setError(
        err.response?.data?.message || err.message || "Failed to cancel checkout session. Please retry."
      );
    } finally {
      setCancellingPending(false);
    }
  };

  // Check pending order status on mount, when tab becomes visible, and on network reconnect
  useEffect(() => {
    verifyPendingOrder(true);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        verifyPendingOrder(true);
      }
    };

    const handleOnline = () => {
      verifyPendingOrder(true);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [verifyPendingOrder]);

  return {
    isPersistentPending,
    setIsPersistentPending,
    checkingPendingStatus,
    cancellingPending,
    sessionExpiredPending,
    verifyPendingOrder,
    handleCancelUnpaidCheckout,
    pollTimerRef,
  };
}
