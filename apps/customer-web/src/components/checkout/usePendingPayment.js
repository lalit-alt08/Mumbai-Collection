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
  const [pendingStatusFeedback, setPendingStatusFeedback] = useState("");
  const [cancelPermission, setCancelPermission] = useState(null);
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
        setCancelPermission(null);
        setCheckingPendingStatus(true);
        const res = await checkPaymentStatus(requestOrderId);
        if (!isCurrentAttempt()) return;
        if (res?.can_cancel === true && !res?.support_required && !res?.terminal) {
          setCancelPermission({ userId: String(requestUserId), orderId: requestOrderId });
        }

        if (res?.success && res?.order_id) {
          if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
          if (!isCurrentAttempt()) return;
          clearPendingPayment(requestUserId);
          clearCheckoutIdempotencyKey(requestUserId);
          refreshCart().catch(() => {});
          if (!isCurrentAttempt()) return;
          navigate(`/order-success/${res.order_id}`, {
            state: { paymentMethod: "Online Payment", status: res.orderStatus || "Processing", confirmedUserId: requestUserId },
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
          const finalMsg = res.message ||
            (res.refunded
              ? "Your payment was refunded."
              : "This payment attempt has ended. You can start a fresh checkout.");
          setError(finalMsg);
          setPendingStatusFeedback(finalMsg);
          setIsPersistentPending(false);
          return;
        }

        if (res?.processing) {
          setPendingStatusFeedback("Payment is processing with your bank. Please check again in a moment.");
        } else {
          setPendingStatusFeedback(
            "No payment confirmed yet. If you did not complete payment on UPI, you can end this checkout attempt."
          );
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
        const errorMsg = "Could not verify payment status with gateway. Please tap to retry.";
        setError(errorMsg);
        setPendingStatusFeedback(errorMsg);
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
    if (!stored?.razorpay_order_id || cancellingPending || checkingPendingStatus || cancelPermission?.userId !== String(requestUserId) || cancelPermission?.orderId !== stored.razorpay_order_id) return;
    const requestOrderId = stored.razorpay_order_id;
    if (activeOrderRef?.current && activeOrderRef.current !== requestOrderId) return;
    if (activeOrderRef) activeOrderRef.current = requestOrderId;
    const requestSequence = ++cancelRequestSequenceRef.current;
    const isCurrentAttempt = () =>
      requestSequence === cancelRequestSequenceRef.current &&
      String(activeUserRef?.current) === String(requestUserId) &&
      activeOrderRef?.current === requestOrderId;

    try {
      setCancelPermission(null);
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
        setPendingStatusFeedback("");
        if (setUnconfirmedQuote) setUnconfirmedQuote(null);
        setError(res?.message || "Checkout attempt ended and reserved items released.");
      } else if (
        res?.status === 409 ||
        res?.code === "PAYMENT_ALREADY_CAPTURED" ||
        res?.code === "PAYMENT_PROCESSING"
      ) {
        const busyMsg = res.message || "A payment is processing. Please check status before paying again.";
        setError(busyMsg);
        setPendingStatusFeedback(busyMsg);
        setIsPersistentPending(true);
      } else {
        const failMsg = res?.message || "Unable to confirm cancellation. Please retry.";
        setError(failMsg);
        setPendingStatusFeedback(failMsg);
      }
    } catch (err) {
      if (!isCurrentAttempt()) return;
      const errMsg = err.response?.data?.message || err.message || "Failed to cancel checkout session. Please retry.";
      setError(errMsg);
      setPendingStatusFeedback(errMsg);
    } finally {
      if (requestSequence === cancelRequestSequenceRef.current) {
        setCancellingPending(false);
      }
    }
  };

  // Check pending order status on mount, when tab becomes visible, and on network reconnect
  useEffect(() => {
    setCancelPermission(null);
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
    pendingStatusFeedback,
    canCancelPending: Boolean(!checkingPendingStatus && cancelPermission && String(user?.id) === cancelPermission.userId && getPendingPayment(user?.id)?.razorpay_order_id === cancelPermission.orderId),
    verifyPendingOrder,
    handleCancelUnpaidCheckout,
    pollTimerRef,
  };
}
