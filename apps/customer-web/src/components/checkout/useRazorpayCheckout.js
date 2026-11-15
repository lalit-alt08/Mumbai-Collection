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
    setPaymentStep("preparing");
    const scriptLoaded = await loadRazorpayScript();
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

    if (!orderRes || !orderRes.razorpay_order_id) {
      if (orderRes?.already_paid) {
        clearCheckoutIdempotencyKey();
        clearPendingPayment(user?.id);
        await refreshCart().catch(() => {});
        navigate(`/order-success/${orderRes.order_id}`, {
          state: { paymentMethod: "Online Payment", status: orderRes.orderStatus || "Processing" },
        });
        isSubmittingRef.current = false;
        setLoading(false);
        setPaymentStep("");
        return;
      }
      throw new Error("Invalid payment order response from server.");
    }

    setPendingPayment(
      {
        razorpay_order_id: orderRes.razorpay_order_id,
        cartFingerprint: computeCartFingerprint(cart),
        itemsFingerprint: computeCartItemsFingerprint(cart),
        timestamp: Date.now(),
      },
      user?.id
    );

    activeOrderRef.current = orderRes.razorpay_order_id;
    activeUserRef.current = user?.id;

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
      order_id: orderRes.razorpay_order_id,
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
          isSubmittingRef.current = false;
          setLoading(false);
          setPaymentStep("");

          const requestUserId = user?.id;
          const requestOrderId = orderRes?.razorpay_order_id;

          if (
            String(activeUserRef.current) !== String(requestUserId) ||
            activeOrderRef.current !== requestOrderId
          ) {
            return;
          }

          try {
            if (requestOrderId) {
              const checkRes = await checkPaymentStatus(requestOrderId);
              if (
                String(activeUserRef.current) !== String(requestUserId) ||
                activeOrderRef.current !== requestOrderId
              ) {
                return;
              }
              if (checkRes?.success && checkRes?.order_id) {
                clearPendingPayment(requestUserId);
                clearCheckoutIdempotencyKey(requestUserId);
                activeOrderRef.current = null;
                await refreshCart().catch(() => {});
                navigate(`/order-success/${checkRes.order_id}`, {
                  state: { paymentMethod: "Online Payment", status: checkRes.orderStatus || "Processing" },
                });
                return;
              }
              if (checkRes?.refunded || checkRes?.terminal) {
                clearPendingPayment(requestUserId);
                retireCheckoutIdempotencyKey(requestUserId);
                activeOrderRef.current = null;
                idempotencyKeyRef.current = generateUUID();
                await refreshCart().catch(() => {});
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
              if (
                String(activeUserRef.current) !== String(requestUserId) ||
                activeOrderRef.current !== requestOrderId
              ) {
                return;
              }
              if (!cancelRes?.cancelled && !cancelRes?.terminal) {
                setIsPersistentPending(true);
                setError("Payment status is still being checked. Please do not pay again.");
                return;
              }
            } catch (cancelErr) {
              if (
                String(activeUserRef.current) !== String(requestUserId) ||
                activeOrderRef.current !== requestOrderId
              ) {
                return;
              }
              setIsPersistentPending(true);
              setError(cancelErr?.response?.data?.message || "Payment status is still being checked. Please do not pay again.");
              return;
            }
          }

          if (
            String(activeUserRef.current) !== String(requestUserId) ||
            activeOrderRef.current !== requestOrderId
          ) {
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
        const requestUserId = user?.id;
        const requestOrderId = orderRes?.razorpay_order_id;

        if (
          String(activeUserRef.current) !== String(requestUserId) ||
          activeOrderRef.current !== requestOrderId ||
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

          if (verifyRes.success && verifyRes.order_id) {
            if (
              String(activeUserRef.current) === String(requestUserId) &&
              activeOrderRef.current === requestOrderId
            ) {
              clearCheckoutIdempotencyKey(requestUserId);
              clearPendingPayment(requestUserId);
              activeOrderRef.current = null;
            }
            await refreshCart().catch(() => {});
            navigate(`/order-success/${verifyRes.order_id}`, {
              state: { paymentMethod: "Online Payment", status: verifyRes.orderStatus || "Processing" },
            });
            return;
          }

          if (verifyRes.support_required) {
            setPendingPayment(
              {
                orderId: requestOrderId,
                amount: unconfirmedQuote?.amount || amountInPaise,
                createdAt: Date.now(),
                support_required: true,
                message: verifyRes.message || "This payment requires staff review. Please do not pay again.",
              },
              requestUserId
            );
            setError(
              verifyRes.message ||
                "This payment requires staff review. Please do not pay again; contact support with your checkout reference."
            );
            return;
          }

          if (verifyRes.refunded || verifyRes.terminal) {
            if (
              String(activeUserRef.current) === String(requestUserId) &&
              activeOrderRef.current === requestOrderId
            ) {
              clearCheckoutIdempotencyKey(requestUserId);
              clearPendingPayment(requestUserId);
              activeOrderRef.current = null;
            }
            await refreshCart().catch(() => {});
            setError(
              verifyRes.message ||
                "An item in your order went out of stock during payment. Your payment was automatically refunded."
            );
            return;
          }

          throw new Error(verifyRes.message || "Payment verification incomplete");
        } catch (verifyErr) {
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
            setPaymentStep(`confirming (${attempt}/5)`);
            await new Promise((resolve) => setTimeout(resolve, 2500));
            try {
              const checkRes = await checkPaymentStatus(paymentResponse.razorpay_order_id);
              if (checkRes?.success && checkRes?.order_id) {
                pollSucceeded = true;
                if (
                  String(activeUserRef.current) === String(requestUserId) &&
                  activeOrderRef.current === requestOrderId
                ) {
                  clearCheckoutIdempotencyKey(requestUserId);
                  clearPendingPayment(requestUserId);
                  activeOrderRef.current = null;
                }
                await refreshCart().catch(() => {});
                navigate(`/order-success/${checkRes.order_id}`, {
                  state: { paymentMethod: "Online Payment", status: checkRes.orderStatus || "Processing" },
                });
                return;
              }
              if (checkRes?.refunded || checkRes?.terminal) {
                pollSucceeded = true;
                if (
                  String(activeUserRef.current) === String(requestUserId) &&
                  activeOrderRef.current === requestOrderId
                ) {
                  clearCheckoutIdempotencyKey(requestUserId);
                  clearPendingPayment(requestUserId);
                  activeOrderRef.current = null;
                }
                await refreshCart().catch(() => {});
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

          if (!pollSucceeded) {
            setIsPersistentPending(true);
            setError(
              "Payment was received by the bank, but order confirmation is taking longer than usual. Please do not pay again — refresh this page shortly or check 'My Orders'."
            );
          }
        } finally {
          isSubmittingRef.current = false;
          setLoading(false);
          setPaymentStep("");
        }
      },
    };

    const rzp = new window.Razorpay(options);
    rzp.on("payment.failed", async (failedRes) => {
      const requestUserId = user?.id;
      const requestOrderId = orderRes?.razorpay_order_id;
      const failedOrderId = failedRes?.error?.metadata?.order_id || requestOrderId;

      if (
        String(activeUserRef.current) !== String(requestUserId) ||
        activeOrderRef.current !== requestOrderId
      ) {
        return;
      }

      if (failedOrderId) {
        try {
          const cancelled = await cancelPaymentOrder(failedOrderId);
          if (
            String(activeUserRef.current) !== String(requestUserId) ||
            activeOrderRef.current !== requestOrderId
          ) {
            return;
          }
          if (!cancelled?.cancelled && !cancelled?.terminal) throw new Error("Cancellation not confirmed");
        } catch {
          if (
            String(activeUserRef.current) !== String(requestUserId) ||
            activeOrderRef.current !== requestOrderId
          ) {
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

      if (
        String(activeUserRef.current) !== String(requestUserId) ||
        activeOrderRef.current !== requestOrderId
      ) {
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
