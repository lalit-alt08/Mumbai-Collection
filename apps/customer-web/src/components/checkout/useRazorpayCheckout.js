import { loadRazorpayScript } from "../../utils/razorpayLoader.js";
import {
  createPaymentOrder,
  verifyPayment,
  checkPaymentStatus,
  cancelPaymentOrder,
} from "../../services/paymentService.js";
import {
  setPendingPayment,
  clearPendingPayment,
  clearCheckoutIdempotencyKey,
  retireCheckoutIdempotencyKey,
  generateUUID,
  computeCartFingerprint,
  computeCartItemsFingerprint,
} from "../../utils/checkoutIdempotency.js";

export function createRazorpayHandler({
  user,
  cart,
  finalTotal,
  billingAddress,
  shippingAddress,
  idempotencyKeyRef,
  activeOrderRef,
  activeUserRef,
  isSubmittingRef,
  pollTimerRef,
  setLoading,
  setPaymentStep,
  setError,
  setIsPersistentPending,
  refreshCart,
  navigate,
}) {
  return async function startPayment() {
    const requestUserId = user?.id;
    const isSameUser = () => String(activeUserRef.current) === String(requestUserId);

    setPaymentStep("preparing");
    const scriptLoaded = await loadRazorpayScript();
    if (!isSameUser()) return;
    if (!scriptLoaded) {
      setError("Unable to load secure payment gateway. Please check your connection and try again.");
      isSubmittingRef.current = false;
      setLoading(false);
      setPaymentStep("");
      return;
    }

    setPaymentStep("opening_gateway");
    const paymentOrderPayload = {
      billing_address: billingAddress,
      shipping_address: shippingAddress,
      expected_total_paise: Math.round(Number(finalTotal) * 100),
    };

    const orderRes = await createPaymentOrder(paymentOrderPayload, {
      headers: {
        "X-Idempotency-Key": idempotencyKeyRef.current,
      },
    });
    if (!isSameUser()) return;

    if (!orderRes || !orderRes.razorpay_order_id) {
      if (orderRes?.already_paid) {
        clearCheckoutIdempotencyKey(requestUserId);
        clearPendingPayment(requestUserId);
        refreshCart().catch(() => {});
        if (!isSameUser()) return;
        navigate(`/order-success/${orderRes.order_id}`, {
          state: { paymentMethod: "Online Payment", status: orderRes.orderStatus || "Processing", confirmedUserId: requestUserId },
        });
        isSubmittingRef.current = false;
        setLoading(false);
        setPaymentStep("");
        return;
      }
      throw new Error("Invalid payment order response from server.");
    }

    const requestOrderId = orderRes.razorpay_order_id;
    const isCurrentAttempt = () =>
      String(activeUserRef.current) === String(requestUserId) &&
      activeOrderRef.current === requestOrderId;

    const recordSupportRequired = (message) => {
      const safeMessage =
        message ||
        "This payment requires staff review. Please do not pay again; contact support with your checkout reference.";
      setPendingPayment(
        {
          razorpay_order_id: requestOrderId,
          amount: orderRes.amount,
          cartFingerprint: computeCartFingerprint(cart),
          itemsFingerprint: computeCartItemsFingerprint(cart),
          heldItems: (cart?.items || []).map((i) => ({
            id: Number(i.id),
            key: i.key,
            quantity: Number(i.quantity || 1),
          })),
          timestamp: Date.now(),
          support_required: true,
          message: safeMessage,
        },
        requestUserId
      );
      setIsPersistentPending(true);
      setError(safeMessage);
    };

    setPendingPayment(
      {
        razorpay_order_id: requestOrderId,
        cartFingerprint: computeCartFingerprint(cart),
        itemsFingerprint: computeCartItemsFingerprint(cart),
        heldItems: (cart?.items || []).map((i) => ({
          id: Number(i.id),
          key: i.key,
          quantity: Number(i.quantity || 1),
        })),
        timestamp: Date.now(),
      },
      requestUserId
    );

    activeOrderRef.current = requestOrderId;
    activeUserRef.current = requestUserId;

    // Prefetch order confirmation page while shopper completes payment
    import("../../pages/OrderSuccess.jsx").catch(() => {});

    const firstName = billingAddress?.first_name || user?.first_name || "";
    const lastName = billingAddress?.last_name || user?.last_name || "";
    const userEmail = billingAddress?.email || user?.email || "";
    const userPhone = billingAddress?.phone || user?.phone || "";

    const options = {
      key: orderRes.key_id,
      amount: orderRes.amount,
      currency: orderRes.currency || "INR",
      name: "Mumbai Collection",
      description: "Mumbai Collection Online Payment",
      order_id: requestOrderId,
      prefill: {
        name: `${firstName} ${lastName}`.trim(),
        email: userEmail,
        contact: userPhone,
      },
      notes: {},
      theme: {
        color: "#22499F",
      },
      modal: {
        ondismiss: async () => {
          if (!isCurrentAttempt()) {
            return;
          }
          isSubmittingRef.current = false;
          setLoading(false);
          setPaymentStep("");

          try {
            if (requestOrderId) {
              const checkRes = await checkPaymentStatus(requestOrderId);
              if (!isCurrentAttempt()) {
                return;
              }
              if (checkRes?.success && checkRes?.order_id) {
                clearPendingPayment(requestUserId);
                clearCheckoutIdempotencyKey(requestUserId);
                activeOrderRef.current = null;
                refreshCart().catch(() => {});
                if (!isSameUser()) return;
                navigate(`/order-success/${checkRes.order_id}`, {
                  state: { paymentMethod: "Online Payment", status: checkRes.orderStatus || "Processing", confirmedUserId: requestUserId },
                });
                return;
              }
              if (checkRes?.support_required) {
                recordSupportRequired(checkRes.message);
                return;
              }
              if (checkRes?.refunded || checkRes?.terminal) {
                clearPendingPayment(requestUserId);
                retireCheckoutIdempotencyKey(requestUserId);
                activeOrderRef.current = null;
                idempotencyKeyRef.current = generateUUID();
                await refreshCart().catch(() => {});
                if (!isSameUser()) return;
                setError(checkRes.message || "Checkout attempt completed or cancelled.");
                return;
              }
              if (checkRes?.captured || checkRes?.authorized || checkRes?.processing) {
                setIsPersistentPending(true);
                setError("Payment is processing or confirmed. Please check payment status before trying again.");
                return;
              }
            }
          } catch (_) {
            // Preserved recovery
          }

          if (requestOrderId) {
            try {
              const cancelRes = await cancelPaymentOrder(requestOrderId);
              if (!isCurrentAttempt()) {
                return;
              }
              if (cancelRes?.support_required) {
                recordSupportRequired(cancelRes.message);
                return;
              }
              if (!cancelRes?.cancelled && !cancelRes?.terminal) {
                setIsPersistentPending(true);
                setError("Payment status is still being checked. Please do not pay again.");
                return;
              }
            } catch (cancelErr) {
              if (!isCurrentAttempt()) {
                return;
              }
              setIsPersistentPending(true);
              setError(cancelErr?.response?.data?.message || "Payment status is still being checked. Please do not pay again.");
              return;
            }
          }

          if (!isCurrentAttempt()) {
            return;
          }
          clearPendingPayment(requestUserId);
          retireCheckoutIdempotencyKey(requestUserId);
          activeOrderRef.current = null;
          idempotencyKeyRef.current = generateUUID();
          setIsPersistentPending(false);
          setError("Payment was cancelled. You can retry paying anytime.");
        },
      },
      handler: async (paymentResponse) => {
        if (
          !isCurrentAttempt() ||
          paymentResponse.razorpay_order_id !== requestOrderId
        ) {
          return;
        }

        try {
          setPaymentStep("verifying");
          setLoading(true);
          setError("");

          const verifyRes = await verifyPayment({
            razorpay_order_id: paymentResponse.razorpay_order_id,
            razorpay_payment_id: paymentResponse.razorpay_payment_id,
            razorpay_signature: paymentResponse.razorpay_signature,
          });
          if (!isCurrentAttempt()) {
            return;
          }

          if (verifyRes.success && verifyRes.order_id) {
            clearCheckoutIdempotencyKey(requestUserId);
            clearPendingPayment(requestUserId);
            activeOrderRef.current = null;
            refreshCart().catch(() => {});
            if (!isSameUser()) return;
            navigate(`/order-success/${verifyRes.order_id}`, {
              state: { paymentMethod: "Online Payment", status: verifyRes.orderStatus || "Processing", confirmedUserId: requestUserId },
            });
            return;
          }

          if (verifyRes.support_required) {
            recordSupportRequired(verifyRes.message);
            return;
          }

          if (verifyRes.refunded || verifyRes.terminal) {
            clearCheckoutIdempotencyKey(requestUserId);
            clearPendingPayment(requestUserId);
            activeOrderRef.current = null;
            await refreshCart().catch(() => {});
            if (!isSameUser()) return;
            setError(
              verifyRes.message ||
                "An item in your order went out of stock during payment. Your payment was automatically refunded."
            );
            return;
          }

          throw new Error(verifyRes.message || "Payment verification incomplete");
        } catch (verifyErr) {
          if (!isCurrentAttempt()) {
            return;
          }
          if (verifyErr?.response?.data?.support_required) {
            recordSupportRequired(verifyErr.response.data.message);
            return;
          }

          const errCode = verifyErr.response?.data?.code;
          const errMsg = String(verifyErr.response?.data?.message || verifyErr.message || "");
          const isExplicitSignatureFailure =
            errCode === "INVALID_SIGNATURE" ||
            errMsg.toLowerCase().includes("invalid signature") ||
            errMsg.toLowerCase().includes("signature mismatch");

          if (isExplicitSignatureFailure) {
            setIsPersistentPending(true);
            setError("We couldn’t confirm your payment. Please don’t pay again. Check payment status or contact the store.");
            return;
          }

          let pollSucceeded = false;
          for (let attempt = 1; attempt <= 5; attempt++) {
            if (!isCurrentAttempt()) {
              return;
            }
            setPaymentStep(`confirming (${attempt}/5)`);
            await new Promise((resolve) => setTimeout(resolve, 2500));
            if (!isCurrentAttempt()) {
              return;
            }
            try {
              const checkRes = await checkPaymentStatus(paymentResponse.razorpay_order_id);
              if (!isCurrentAttempt()) {
                return;
              }
              if (checkRes?.success && checkRes?.order_id) {
                pollSucceeded = true;
                clearCheckoutIdempotencyKey(requestUserId);
                clearPendingPayment(requestUserId);
                activeOrderRef.current = null;
                refreshCart().catch(() => {});
                if (!isSameUser()) return;
                navigate(`/order-success/${checkRes.order_id}`, {
                  state: { paymentMethod: "Online Payment", status: checkRes.orderStatus || "Processing", confirmedUserId: requestUserId },
                });
                return;
              }
              if (checkRes?.support_required) {
                pollSucceeded = true;
                recordSupportRequired(checkRes.message);
                return;
              }
              if (checkRes?.refunded || checkRes?.terminal) {
                pollSucceeded = true;
                clearCheckoutIdempotencyKey(requestUserId);
                clearPendingPayment(requestUserId);
                activeOrderRef.current = null;
                await refreshCart().catch(() => {});
                if (!isSameUser()) return;
                setError(
                  checkRes.message ||
                    "An item in your order went out of stock. Your payment has been refunded automatically."
                );
                return;
              }
            } catch (_) {
              // Continue
            }
          }

          if (!pollSucceeded && isCurrentAttempt()) {
            setIsPersistentPending(true);
            setError(
              "We couldn’t confirm your payment yet. If money was debited, please do not pay again."
            );
          }
        } finally {
          if (isSameUser() && (activeOrderRef.current === requestOrderId || activeOrderRef.current === null)) {
            isSubmittingRef.current = false;
            setLoading(false);
            setPaymentStep("");
          }
        }
      },
    };

    const rzp = new window.Razorpay(options);
    rzp.on("payment.failed", async (failedRes) => {
      const failedOrderId = failedRes?.error?.metadata?.order_id || requestOrderId;

      if (!isCurrentAttempt()) {
        return;
      }

      if (failedOrderId) {
        try {
          const cancelled = await cancelPaymentOrder(failedOrderId);
          if (!isCurrentAttempt()) {
            return;
          }
          if (cancelled?.support_required) {
            isSubmittingRef.current = false;
            setLoading(false);
            setPaymentStep("");
            recordSupportRequired(cancelled.message);
            return;
          }
          if (!cancelled?.cancelled && !cancelled?.terminal) throw new Error("Cancellation not confirmed");
        } catch {
          if (!isCurrentAttempt()) {
            return;
          }
          isSubmittingRef.current = false;
          setLoading(false);
          setPaymentStep("");
          setIsPersistentPending(true);
          setError("Payment status is uncertain. Please check status before paying again.");
          return;
        }
      }

      if (!isCurrentAttempt()) {
        return;
      }

      isSubmittingRef.current = false;
      setLoading(false);
      setPaymentStep("");
      clearPendingPayment(requestUserId);
      retireCheckoutIdempotencyKey(requestUserId);
      activeOrderRef.current = null;
      idempotencyKeyRef.current = generateUUID();
      setIsPersistentPending(false);
      const desc = failedRes?.error?.description || "Payment attempt failed. You can retry paying.";
      setError(desc);
    });

    rzp.open();
  };
}
