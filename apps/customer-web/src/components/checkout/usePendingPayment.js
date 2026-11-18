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
  const statusRequestRef = useRef(null);
  const statusRequestSequenceRef = useRef(0);
  const cancelRequestSequenceRef = useRef(0);

  const verifyPendingOrder = useCallback(
    async (isManualOrTrigger = false) => {
      const requestUserId = user?.id;
      if (
        (requestUserId && String(activeUserRef?.current) !== String(requestUserId)) ||
        (!requestUserId && activeUserRef?.current != null)
      ) {
        return;
      }
      const stored = getPendingPayment(requestUserId || checkoutExpiredUserId);
      if (!stored || !stored.razorpay_order_id) {
        statusRequestSequenceRef.current += 1;
        statusRequestRef.current = null;
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        setCheckingPendingStatus(false);
        setIsPersistentPending(false);
        if (activeOrderRef) activeOrderRef.current = null;
        return;
      }

      if (!isAuthenticated || !requestUserId) {
        statusRequestSequenceRef.current += 1;
        statusRequestRef.current = null;
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        setCheckingPendingStatus(false);
        return;
      }

      const requestOrderId = stored.razorpay_order_id;
      if (
        statusRequestRef.current?.userId === String(requestUserId) &&
        statusRequestRef.current?.orderId === requestOrderId
      ) {
        return;
      }

      const requestSequence = ++statusRequestSequenceRef.current;
      statusRequestRef.current = {
        userId: String(requestUserId),
        orderId: requestOrderId,
        sequence: requestSequence,
      };
      if (activeOrderRef) activeOrderRef.current = requestOrderId;
      const isCurrentAttempt = () =>
        requestSequence === statusRequestSequenceRef.current &&
        String(activeUserRef?.current) === String(requestUserId) &&
        activeOrderRef?.current === requestOrderId;

      // Query payment finalization state by Razorpay order ID FIRST
      try {
        setCheckingPendingStatus(true);
        const res = await checkPaymentStatus(requestOrderId);
        if (!isCurrentAttempt()) return;

        if (res?.success && res?.order_id) {
          if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
          if (!isCurrentAttempt()) return;
          await refreshCart().catch(() => {});
          // The payment is final for this user even if they switched accounts
          // while the cart refresh was in flight. Only clear that user's record.
          clearPendingPayment(requestUserId);
          clearCheckoutIdempotencyKey(requestUserId);
          if (!isCurrentAttempt()) return;
          navigate(`/order-success/${res.order_id}`, {
            state: { paymentMethod: "Online Payment", status: res.orderStatus || "Processing" },
            replace: true,
          });
          return;
        }

        if (res?.support_required) {
          if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
          const pending = getPendingPayment(requestUserId);
          if (pending) {
            setPendingPayment(
              {
                ...pending,
                support_required: true,
                message: res.message || "This payment requires staff review. Please do not pay again.",
              },
              requestUserId
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
          await refreshCart().catch(() => {});
          clearPendingPayment(requestUserId);
          retireCheckoutIdempotencyKey(requestUserId);
          if (!isCurrentAttempt()) return;
          if (idempotencyKeyRef) idempotencyKeyRef.current = generateUUID();
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
        if (!isCurrentAttempt()) return;
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
        if (requestSequence === statusRequestSequenceRef.current) {
          statusRequestRef.current = null;
          if (String(activeUserRef?.current) === String(requestUserId)) {
            setCheckingPendingStatus(false);
          }
        }
      }

      if (!isCurrentAttempt()) return;

      // Schedule next backoff attempt: 2s, 4s, 8s, 15s, then every 30s (~3 min)
      setPollAttempt((prev) => {
        if (!isCurrentAttempt()) return prev;
        const nextAttempt = isManualOrTrigger ? 0 : prev + 1;
        if (nextAttempt < BACKOFF_SCHEDULE.length) {
          const delay = BACKOFF_SCHEDULE[nextAttempt];
          if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
          pollTimerRef.current = setTimeout(() => {
            if (isCurrentAttempt()) verifyPendingOrder(false);
          }, delay);
          setIsPersistentPending(false);
        } else {
          setIsPersistentPending(true);
        }
        return nextAttempt;
      });
    },
    [navigate, refreshCart, user?.id, isAuthenticated, checkoutExpiredUserId, handleSessionExpired, activeOrderRef, activeUserRef, idempotencyKeyRef, setError]
  );

  const handleCancelUnpaidCheckout = async () => {
    const requestUserId = user?.id || checkoutExpiredUserId;
    if (!requestUserId || String(activeUserRef?.current) !== String(requestUserId)) return;
    const stored = getPendingPayment(requestUserId);
    if (!stored?.razorpay_order_id || cancellingPending) return;
    const requestOrderId = stored.razorpay_order_id;
    if (activeOrderRef?.current && activeOrderRef.current !== requestOrderId) return;
    if (activeOrderRef) activeOrderRef.current = requestOrderId;
    const requestSequence = ++cancelRequestSequenceRef.current;
    const isCurrentAttempt = () =>
      requestSequence === cancelRequestSequenceRef.current &&
      String(activeUserRef?.current) === String(requestUserId) &&
      activeOrderRef?.current === requestOrderId;

    try {
      setCancellingPending(true);
      setError("");
      const res = await cancelPaymentOrder(requestOrderId);
      if (!isCurrentAttempt()) return;

      if (res?.support_required) {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        const pending = getPendingPayment(requestUserId);
        if (pending) {
          setPendingPayment(
            {
              ...pending,
              support_required: true,
              message: res.message || "This payment requires staff review. Please do not pay again.",
            },
            requestUserId
          );
        }
        setIsPersistentPending(true);
        setError(
          res.message ||
            "This payment requires staff review. Please do not pay again; contact support with your checkout reference."
        );
        return;
      }

      if (res?.cancelled || res?.terminal) {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        await refreshCart().catch(() => {});
        clearPendingPayment(requestUserId);
        retireCheckoutIdempotencyKey(requestUserId);
        if (!isCurrentAttempt()) return;
        if (idempotencyKeyRef) idempotencyKeyRef.current = generateUUID();
        setIsPersistentPending(false);
        if (setUnconfirmedQuote) setUnconfirmedQuote(null);
        setError("Checkout session cancelled. You can retry paying anytime.");
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
      if (!isCurrentAttempt()) return;
      setError(
        err.response?.data?.message || err.message || "Failed to cancel checkout session. Please retry."
      );
    } finally {
      if (requestSequence === cancelRequestSequenceRef.current) {
        setCancellingPending(false);
      }
    }
  };

  // Check pending order status on mount, when tab becomes visible, and on network reconnect
  useEffect(() => {
    setCancellingPending(false);
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
      statusRequestSequenceRef.current += 1;
      statusRequestRef.current = null;
      cancelRequestSequenceRef.current += 1;
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
