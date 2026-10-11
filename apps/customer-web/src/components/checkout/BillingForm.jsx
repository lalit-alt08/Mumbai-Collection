import { useEffect, useState, useRef, useCallback } from "react";
import axios from "axios";
import { updateCheckout, removeCartItem } from "../../services/storeApi";
import { createPaymentOrder, verifyPayment, checkPaymentStatus } from "../../services/paymentService.js";
import { useNavigate } from "react-router-dom";
import API_URL from "../../config/api.js";
import safeStorage from "../../utils/safeStorage.js";
import StockNotificationModal from "./StockNotificationModal";
import {
  MapPin,
  CreditCard,
  Loader2,
  Home,
  Building2,
  Plus,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { getIndianStateCode } from "../../data/indianStates";

import {
  CHECKOUT_IDEMP_STORAGE_KEY,
  computeCartFingerprint,
  computeCartItemsFingerprint,
  generateUUID,
  getOrCreateCheckoutIdempotencyKey,
  clearCheckoutIdempotencyKey,
  PENDING_PAYMENT_STORAGE_KEY,
  getPendingPayment,
  setPendingPayment,
  clearPendingPayment,
} from "../../utils/checkoutIdempotency.js";

export {
  CHECKOUT_IDEMP_STORAGE_KEY,
  computeCartFingerprint,
  generateUUID,
  getOrCreateCheckoutIdempotencyKey,
  clearCheckoutIdempotencyKey,
  PENDING_PAYMENT_STORAGE_KEY,
  getPendingPayment,
  setPendingPayment,
  clearPendingPayment,
};

const loadRazorpayScript = () => {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && window.Razorpay) {
      return resolve(true);
    }
    if (typeof document === "undefined") {
      return resolve(false);
    }
    const existingScript = document.getElementById("razorpay-checkout-script");
    if (existingScript) {
      if (window.Razorpay) {
        return resolve(true);
      }
      existingScript.addEventListener("load", () => resolve(true), { once: true });
      existingScript.addEventListener("error", () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = "razorpay-checkout-script";
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

function BillingForm({ storeHours, onStoreClosed }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { cart, refreshCart } = useCart();

  const [addresses, setAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState("cod"); // "cod" | "online"
  const [paymentStep, setPaymentStep] = useState(""); // "" | "preparing" | "opening_gateway" | "verifying"

  const [sessionExpiredPending, setSessionExpiredPending] = useState(false);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stockAlertOpen, setStockAlertOpen] = useState(false);
  const [stockAlertItems, setStockAlertItems] = useState([]);
  const [removingStockItems, setRemovingStockItems] = useState(false);
  const isSubmittingRef = useRef(false);
  const idempotencyKeyRef = useRef(getOrCreateCheckoutIdempotencyKey(cart));

  const handleRemoveUnavailableAndContinue = async () => {
    if (removingStockItems) return;
    try {
      setRemovingStockItems(true);
      if (Array.isArray(stockAlertItems) && stockAlertItems.length > 0) {
        for (const item of stockAlertItems) {
          let targetKey = item.key;
          if (!targetKey && cart?.items) {
            const matched = cart.items.find(
              (c) =>
                (item.id && Number(c.id) === Number(item.id)) ||
                c.name === item.name
            );
            if (matched) targetKey = matched.key;
          }
          if (targetKey) {
            try {
              await removeCartItem(targetKey);
            } catch {
              // continue with remaining
            }
          }
        }
      }
      await refreshCart().catch(() => {});
      setStockAlertOpen(false);
      setStockAlertItems([]);
      setError("");
    } catch {
      setError("Failed to update cart. Please return to your cart.");
    } finally {
      setRemovingStockItems(false);
    }
  };

  const handleReturnToCart = () => {
    setStockAlertOpen(false);
    navigate("/cart");
  };

  const BACKOFF_SCHEDULE = [2000, 4000, 8000, 15000, 30000, 30000, 30000, 30000, 30000];
  const [pollAttempt, setPollAttempt] = useState(0);
  const [isPersistentPending, setIsPersistentPending] = useState(false);
  const [checkingPendingStatus, setCheckingPendingStatus] = useState(false);
  const pollTimerRef = useRef(null);

  const verifyPendingOrder = useCallback(async (isManualOrTrigger = false) => {
    const stored = getPendingPayment();
    if (!stored || !stored.razorpay_order_id) {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      setIsPersistentPending(false);
      return;
    }

    const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
    if (Date.now() - (stored.timestamp || 0) > MAX_AGE_MS) {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      clearPendingPayment();
      setIsPersistentPending(false);
      return;
    }

    // Query payment finalization state by Razorpay order ID FIRST
    try {
      setCheckingPendingStatus(true);
      const res = await checkPaymentStatus(stored.razorpay_order_id);
      if (res?.success && res?.order_id) {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        clearPendingPayment();
        clearCheckoutIdempotencyKey();
        await refreshCart().catch(() => {});
        navigate(`/order-success/${res.order_id}`, {
          state: { paymentMethod: "Online Payment", status: res.orderStatus || "Processing" },
          replace: true,
        });
        return;
      }
      if (res?.refunded || res?.terminal) {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        clearPendingPayment();
        clearCheckoutIdempotencyKey();
        await refreshCart().catch(() => {});
        setError(res.message || "An item in your order went out of stock during checkout. Your payment was automatically refunded.");
        setIsPersistentPending(false);
        return;
      }
    } catch (err) {
      if (err?.response?.status === 401) {
        // Session expired mid-payment: NEVER clear pendingPayment!
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        setSessionExpiredPending(true);
        setError("Your session expired while confirming your payment. Please sign in to resume your order.");
        return;
      }
    } finally {
      setCheckingPendingStatus(false);
    }

    const currentFingerprint = computeCartFingerprint(cart);
    const currentItemsFingerprint = computeCartItemsFingerprint(cart);
    const itemsChanged = stored.itemsFingerprint
      ? stored.itemsFingerprint !== currentItemsFingerprint
      : stored.cartFingerprint && stored.cartFingerprint !== currentFingerprint;

    if (itemsChanged) {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      clearPendingPayment();
      setIsPersistentPending(false);
      return;
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
        // Transition to persistent pending state with manual check button and support contact
        setIsPersistentPending(true);
      }
      return nextAttempt;
    });
  }, [cart, navigate, refreshCart]);

  useEffect(() => {
    idempotencyKeyRef.current = getOrCreateCheckoutIdempotencyKey(cart);
    const currentFingerprint = computeCartFingerprint(cart);
    const currentItemsFingerprint = computeCartItemsFingerprint(cart);
    const stored = getPendingPayment();
    const itemsChanged = stored?.itemsFingerprint
      ? stored.itemsFingerprint !== currentItemsFingerprint
      : stored?.cartFingerprint && stored.cartFingerprint !== currentFingerprint;

    if (itemsChanged) {
      clearPendingPayment();
    }
  }, [cart]);

  // Check pending order status on mount (load), when tab becomes visible, and when network reconnects
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

  // Load saved addresses
  useEffect(() => {
    const loadAddresses = async () => {
      try {
        setLoadingAddresses(true);
        setError("");

        const response = await axios.get(`${API_URL}/addresses`, {
          withCredentials: true,
        });

        const savedAddresses = response.data.addresses || [];

        setAddresses(savedAddresses);

        // Automatically select first saved address
        if (savedAddresses.length > 0) {
          setSelectedAddressId(savedAddresses[0].id);
        }
      } catch (error) {
        setError(
          error.response?.data?.message ||
            "Unable to load your saved addresses.",
        );
      } finally {
        setLoadingAddresses(false);
      }
    };

    loadAddresses();
  }, []);

  const selectedAddress = addresses.find(
    (address) => address.id === selectedAddressId,
  );

  const handlePlaceOrder = async () => {
    if (isSubmittingRef.current) return;

    if (!selectedAddress) {
      setError("Please select a delivery address.");
      return;
    }

    const itemsSubtotal = cart?.totals?.total_items
      ? Number(cart.totals.total_items) / 100
      : (cart?.items || []).reduce(
          (acc, item) =>
            acc +
            (Number(item.totals?.line_subtotal) ||
              Number(item.totals?.line_total) ||
              0),
          0,
        ) / 100;

    const isStoreClosed = storeHours && storeHours.is_open === false;
    if (isStoreClosed) {
      const msg = storeHours?.closed_message || "We are currently closed for new orders.";
      const resumeTime = storeHours?.next_opening?.label ? ` Ordering resumes ${storeHours.next_opening.label}.` : "";
      setError(`${msg}${resumeTime}`);
      return;
    }

    if (itemsSubtotal < 500) {
      const shortfall = Math.max(0, 500 - itemsSubtotal);
      setError(`Add ₹${shortfall} more to reach the minimum order value of ₹500.`);
      return;
    }

    try {
      isSubmittingRef.current = true;
      setLoading(true);
      setError("");

      /*
       * Convert saved address into WooCommerce checkout format with strict validation safeguards.
       */
      let firstName = (selectedAddress.first_name || "").trim();
      let lastName = (selectedAddress.last_name || "").trim();

      if (!firstName || !lastName) {
        const nameParts = (selectedAddress.full_name || "").trim().split(/\s+/);
        if (!firstName) firstName = nameParts[0] || "";
        if (!lastName) lastName = nameParts.slice(1).join(" ");
      }

      if (!firstName) {
        firstName = (user?.first_name || (user?.name || "").trim().split(/\s+/)[0] || "Customer").trim();
      }
      if (!lastName) {
        lastName = (user?.last_name || (user?.name || "").trim().split(/\s+/).slice(1).join(" ") || "").trim();
      }

      const stateCode = getIndianStateCode(selectedAddress.state);
      const cachedEmail = safeStorage.getJSON("user", {})?.email || "";

      const userEmail = (user?.email || selectedAddress.email || cachedEmail || "").trim();
      if (!userEmail) {
        setError("Please ensure your account has a valid email address before placing an order.");
        return;
      }

      const rawPhone = (selectedAddress.phone || user?.phone || "").replace(/\D/g, "");
      const cleanPhone = rawPhone.length === 12 && rawPhone.startsWith("91") ? rawPhone.slice(2) : rawPhone;
      if (!cleanPhone || cleanPhone.length < 10) {
        setError("Please enter a valid 10-digit mobile number on your delivery address so our courier can deliver your order.");
        return;
      }
      const userPhone = cleanPhone;
      const cleanPincode =
        (selectedAddress.pincode || "").replace(/\D/g, "") || "";

      const secondaryPhone = (selectedAddress.secondary_phone || user?.secondary_phone || "").replace(/\D/g, "").slice(0, 10);

      const billingAddress = {
        first_name: firstName,
        last_name: lastName,
        email: userEmail,
        phone: userPhone,
        secondary_phone: secondaryPhone || undefined,
        address_1: selectedAddress.address_line1 || "Street Address",
        address_2: selectedAddress.address_line2 || "",
        city: selectedAddress.city || "Vasai West",
        state: stateCode,
        postcode: cleanPincode,
        country: "IN",
      };

      const shippingAddress = {
        first_name: firstName,
        last_name: lastName,
        phone: userPhone,
        secondary_phone: secondaryPhone || undefined,
        address_1: selectedAddress.address_line1 || "Street Address",
        address_2: selectedAddress.address_line2 || "",
        city: selectedAddress.city || "Vasai West",
        state: stateCode,
        postcode: cleanPincode,
        country: "IN",
      };

      if (paymentMethod === "cod") {
        setPaymentStep("processing");
        const response = await updateCheckout(
          {
            billing_address: billingAddress,
            shipping_address: shippingAddress,
            payment_method: "cod",
            create_account: false,
          },
          {
            headers: {
              "X-Idempotency-Key": idempotencyKeyRef.current,
            },
            timeout: 30000,
          }
        );
        // Clear persisted idempotency key and pending payment on successful order completion
        clearCheckoutIdempotencyKey();
        clearPendingPayment();

        // Refresh cart state to clear items and badges
        await refreshCart().catch(() => {});

        navigate(`/order-success/${response.order_id}`, {
          state: { paymentMethod: "Cash on Delivery", status: "Processing" },
        });
        isSubmittingRef.current = false;
        setLoading(false);
        setPaymentStep("");
        return;
      }

      // ── Pay Online (Razorpay) Flow ──────────────────────────────
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
      };

      const orderRes = await createPaymentOrder(paymentOrderPayload, {
        headers: {
          "X-Idempotency-Key": idempotencyKeyRef.current,
        },
      });

      if (!orderRes || !orderRes.razorpay_order_id) {
        // If the backend reports the order is already paid (e.g. after a Razorpay redirect retry),
        // redirect to the success page rather than opening the gateway again.
        if (orderRes?.already_paid) {
          clearCheckoutIdempotencyKey();
          clearPendingPayment();
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

      setPendingPayment({
        razorpay_order_id: orderRes.razorpay_order_id,
        cartFingerprint: computeCartFingerprint(cart),
        itemsFingerprint: computeCartItemsFingerprint(cart),
        timestamp: Date.now(),
      });

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
          color: "#7C3AED",
        },
        modal: {
          ondismiss: async () => {
            isSubmittingRef.current = false;
            setLoading(false);
            setPaymentStep("");

            // Check whether order was already completed in backend (e.g. via webhook while in UPI app)
            try {
              if (orderRes.razorpay_order_id) {
                const checkRes = await checkPaymentStatus(orderRes.razorpay_order_id);
                if (checkRes?.success && checkRes?.order_id) {
                  clearPendingPayment();
                  clearCheckoutIdempotencyKey();
                  await refreshCart().catch(() => {});
                  navigate(`/order-success/${checkRes.order_id}`, {
                    state: { paymentMethod: "Online Payment", status: checkRes.orderStatus || "Processing" },
                  });
                  return;
                }
                if (checkRes?.refunded || checkRes?.terminal) {
                  clearPendingPayment();
                  clearCheckoutIdempotencyKey();
                  await refreshCart().catch(() => {});
                  setError(checkRes.message || "An item in your order went out of stock. Your payment has been refunded.");
                  return;
                }
              }
            } catch (_) {}

            setError("Payment was cancelled. You can retry paying anytime.");
          },
        },
        handler: async (paymentResponse) => {
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
              clearCheckoutIdempotencyKey();
              clearPendingPayment();
              await refreshCart().catch(() => {});
              navigate(`/order-success/${verifyRes.order_id}`, {
                state: { paymentMethod: "Online Payment", status: verifyRes.orderStatus || "Processing" },
              });
              return;
            }

            if (verifyRes.refunded || verifyRes.terminal) {
              clearCheckoutIdempotencyKey();
              clearPendingPayment();
              await refreshCart().catch(() => {});
              setError(
                verifyRes.message ||
                "An item in your order went out of stock during payment. Your payment was automatically refunded."
              );
              return;
            }

            // Non-terminal response: retain pending payment and let polling loop verify
            throw new Error(verifyRes.message || "Payment verification incomplete");
          } catch (verifyErr) {
            const errCode = verifyErr.response?.data?.code;
            const errMsg = String(verifyErr.response?.data?.message || verifyErr.message || "");
            const isExplicitSignatureFailure =
              errCode === "INVALID_SIGNATURE" ||
              errMsg.toLowerCase().includes("invalid signature") ||
              errMsg.toLowerCase().includes("signature mismatch");

            if (isExplicitSignatureFailure) {
              // Definitive invalid signature: clear storage and allow fresh retry
              clearCheckoutIdempotencyKey();
              clearPendingPayment();
              await refreshCart().catch(() => {});
              setError(
                verifyErr.response?.data?.message ||
                "Payment verification failed: invalid signature. Please try again or contact support."
              );
              return;
            }

            // For ALL other outcomes (401 session expired, 403 CSRF/phone, 404, 409, 5xx, or network drops):
            // The customer's funds were ALREADY debited on Razorpay!
            // Do NOT clear pendingPayment. Run an active backoff polling loop.
            let pollSucceeded = false;
            for (let attempt = 1; attempt <= 5; attempt++) {
              setPaymentStep(`confirming (${attempt}/5)`);
              await new Promise((resolve) => setTimeout(resolve, 2500));
              try {
                const checkRes = await checkPaymentStatus(paymentResponse.razorpay_order_id);
                if (checkRes?.success && checkRes?.order_id) {
                  pollSucceeded = true;
                  clearCheckoutIdempotencyKey();
                  clearPendingPayment();
                  await refreshCart().catch(() => {});
                  navigate(`/order-success/${checkRes.order_id}`, {
                    state: { paymentMethod: "Online Payment", status: checkRes.orderStatus || "Processing" },
                  });
                  return;
                }
                if (checkRes?.refunded || checkRes?.terminal) {
                  pollSucceeded = true;
                  clearCheckoutIdempotencyKey();
                  clearPendingPayment();
                  await refreshCart().catch(() => {});
                  setError(
                    checkRes.message ||
                    "An item in your order went out of stock. Your payment has been refunded automatically."
                  );
                  return;
                }
              } catch (_) {
                // Continue to next polling attempt
              }
            }

            if (!pollSucceeded) {
              // Retain pendingPayment in safeStorage so auto-recovery works upon refresh or reopening the app
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
      rzp.on("payment.failed", (failedRes) => {
        isSubmittingRef.current = false;
        setLoading(false);
        setPaymentStep("");
        const desc = failedRes?.error?.description || "Payment attempt failed. You can retry paying.";
        setError(desc);
      });

      rzp.open();
    } catch (error) {
      const errStatus = error.response?.status;
      const errData = error.response?.data;
      const isProcessingConflict =
        errStatus === 409 &&
        (errData?.message?.includes("currently being processed") ||
          errData?.code === "ORDER_PROCESSING");

      if (errData?.code === "CUSTOMER_SUSPENDED") {
        setError(
          errData?.message ||
            "Your account is currently suspended and you cannot place new orders.",
        );
      } else if (errData?.code === "STORE_CLOSED") {
        const msg = errData?.message || "We are currently closed for new orders.";
        const resumeTime = errData?.next_opening?.label ? ` Ordering resumes ${errData.next_opening.label}.` : "";
        setError(`${msg}${resumeTime}`);
        if (typeof onStoreClosed === "function") {
          onStoreClosed();
        }
      } else if (
        errData?.code === "ITEM_OUT_OF_STOCK" ||
        errData?.code === "INSUFFICIENT_STOCK" ||
        errData?.code === "woocommerce_rest_cart_item_out_of_stock"
      ) {
        clearCheckoutIdempotencyKey();
        idempotencyKeyRef.current = generateUUID();
        await refreshCart().catch(() => {});
        const shortageDetails =
          Array.isArray(errData?.out_of_stock_details) && errData.out_of_stock_details.length > 0
            ? errData.out_of_stock_details
            : Array.isArray(errData?.out_of_stock_items) && errData.out_of_stock_items.length > 0
            ? errData.out_of_stock_items.map((name) => ({ name }))
            : [{ name: "An item in your cart" }];

        setStockAlertItems(shortageDetails);
        setStockAlertOpen(true);
        setError("");
      } else if (errData?.code === "woocommerce_rest_checkout_total_mismatch") {
        clearCheckoutIdempotencyKey();
        idempotencyKeyRef.current = generateUUID();
        await refreshCart().catch(() => {});
        setError(
          errData?.message ||
            "Cart totals have updated. Please review your order summary and try placing your order again.",
        );
      } else if (isProcessingConflict) {
        // Retain current idempotency key to prevent duplicate orders while request is in flight
        setError(
          "Your order is currently being processed. Please wait a moment and check your order history before trying again.",
        );
      } else if (errStatus === 409) {
        clearCheckoutIdempotencyKey();
        idempotencyKeyRef.current = generateUUID();
        await refreshCart().catch(() => {});
        setError(
          errData?.message ||
            "A checkout conflict occurred. Your cart has been updated, please try placing your order again.",
        );
      } else if (errData?.code === "woocommerce_rest_min_order_value" || errData?.code === "MIN_ORDER_VALUE") {
        setError(
          errData?.message ||
            "Minimum product order value of ₹500 is required.",
        );
      } else {
        clearCheckoutIdempotencyKey();
        idempotencyKeyRef.current = generateUUID();
        setError(
          errData?.message ||
            error.message ||
            "Failed to place order. Please try again.",
        );
      }
      isSubmittingRef.current = false;
      setLoading(false);
      setPaymentStep("");
    }
  };

  if (loadingAddresses) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-[20px] border border-[#ECECEC] bg-white">
        <div className="flex items-center gap-2 text-[14px] font-medium text-[#444444]">
          <Loader2 size={19} className="animate-spin text-[#7C3AED]" />
          Loading your saved addresses...
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[20px] border border-[#ECECEC] bg-white p-5 shadow-[0_6px_24px_rgba(0,0,0,0.05)] md:p-6">
      {/* Header */}
      <div className="mb-5">
        <h2 className="text-[25px] font-bold text-[#1E1E1E]">Checkout</h2>

        <p className="mt-1.5 text-[14px] text-[#444444]">
          Select your delivery address and payment method.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-5 rounded-[12px] bg-red-50 px-4 py-3 text-[13px] font-medium text-red-600">
          {error}
        </div>
      )}

      {/* Delivery Address */}
      <div className="mb-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[16px] font-bold text-[#1E1E1E]">
            <MapPin size={18} className="text-[#7C3AED]" />
            Delivery Address
          </h3>

          <button
            type="button"
            onClick={() => navigate("/account/addresses")}
            disabled={loading}
            className={`flex items-center gap-1 text-[13px] font-bold text-[#7C3AED] transition-colors hover:text-[#6C35E8] hover:underline ${
              loading ? "opacity-50 pointer-events-none cursor-not-allowed" : ""
            }`}
          >
            <Plus size={15} />
            Add Address
          </button>
        </div>

        {/* No saved addresses */}
        {addresses.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-[#C4B5FD] bg-[#F1ECFF] p-5 text-center">
            <MapPin size={28} className="mx-auto mb-2 text-[#7C3AED]" />

            <h4 className="text-[14px] font-bold text-[#1E1E1E]">
              No saved addresses
            </h4>

            <p className="mt-1 text-[13px] text-[#444444]">
              Please add a delivery address before placing your order.
            </p>

            <button
              type="button"
              onClick={() => navigate("/account/addresses")}
              disabled={loading}
              className={`mt-3 rounded-xl bg-[#7C3AED] px-4 py-2 text-[13px] font-bold text-white transition hover:bg-[#6C35E8] ${
                loading ? "opacity-50 pointer-events-none cursor-not-allowed" : ""
              }`}
            >
              Add Address
            </button>
          </div>
        ) : (
          <div className={`space-y-3 transition-opacity ${loading ? "opacity-50 pointer-events-none" : ""}`}>
            {addresses.map((address) => {
              const isSelected = selectedAddressId === address.id;

              const isHome = address.type === "home";

              return (
                <button
                  key={address.id}
                  type="button"
                  disabled={loading}
                  onClick={() => setSelectedAddressId(address.id)}
                  className={`w-full rounded-[16px] border-2 p-4 text-left transition-all ${
                    isSelected
                      ? "border-[#7C3AED] bg-[#F1ECFF] shadow-[0_4px_16px_rgba(124,58,237,0.07)]"
                      : "border-[#ECECEC] bg-white hover:border-[#C4B5FD]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div
                      className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
                        isSelected
                          ? "bg-[#7C3AED] text-white"
                          : "bg-[#F5F5F5] text-[#444444]"
                      }`}
                    >
                      {isHome ? <Home size={18} /> : <Building2 size={18} />}
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[14px] font-bold text-[#1E1E1E]">
                          {address.first_name || ""} {address.last_name || ""}
                        </span>

                        <span className="rounded-full bg-[#E9D5FF] px-2.5 py-0.5 text-[11px] font-bold text-[#7C3AED]">
                          {address.type ? address.type.toUpperCase() : "HOME"}
                        </span>
                      </div>

                      <div className="mt-1 text-[13px] text-[#444444]">
                        {address.address_line1 || ""},{" "}
                        {address.address_line2
                          ? `${address.address_line2}, `
                          : ""}
                        {address.city || ""}, {address.state || ""}
                        {address.pincode ? ` - ${address.pincode}` : ""}
                      </div>

                      {address.phone && (
                        <div className="mt-1 text-[12px] font-medium text-[#7C3AED]">
                          📞 {address.phone}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <hr className="my-5 border-[#ECECEC]" />

      {/* Payment Method */}
      <div className="mb-6">
        <h3 className="mb-3 flex items-center gap-2 text-[16px] font-bold text-[#1E1E1E]">
          <CreditCard size={18} className="text-[#7C3AED]" />
          Payment Method
        </h3>

        <div className={`grid gap-3 sm:grid-cols-2 transition-opacity ${loading ? "opacity-50 pointer-events-none" : ""}`}>
          {/* Cash on Delivery */}
          <button
            type="button"
            onClick={() => setPaymentMethod("cod")}
            disabled={loading}
            className={`flex items-start gap-3 rounded-[16px] border-2 p-4 text-left transition-all ${
              loading
                ? "cursor-not-allowed"
                : "cursor-pointer"
            } ${
              paymentMethod === "cod"
                ? "border-[#7C3AED] bg-[#F1ECFF] shadow-[0_4px_16px_rgba(124,58,237,0.07)]"
                : "border-[#ECECEC] bg-white hover:border-[#C4B5FD]"
            }`}
          >
            <div
              className={`flex h-5 w-5 mt-0.5 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                paymentMethod === "cod" ? "border-[#7C3AED]" : "border-gray-300"
              }`}
            >
              {paymentMethod === "cod" && (
                <div className="h-2.5 w-2.5 rounded-full bg-[#7C3AED]" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-bold text-[#1E1E1E]">
                Cash on Delivery (COD)
              </div>
              <div className="mt-0.5 text-[12px] text-[#444444]">
                Pay with cash upon delivery.
              </div>
            </div>
          </button>

          {/* Pay Online */}
          <button
            type="button"
            onClick={() => setPaymentMethod("online")}
            disabled={loading}
            className={`flex items-start gap-3 rounded-[16px] border-2 p-4 text-left transition-all ${
              loading
                ? "cursor-not-allowed"
                : "cursor-pointer"
            } ${
              paymentMethod === "online"
                ? "border-[#7C3AED] bg-[#F1ECFF] shadow-[0_4px_16px_rgba(124,58,237,0.07)]"
                : "border-[#ECECEC] bg-white hover:border-[#C4B5FD]"
            }`}
          >
            <div
              className={`flex h-5 w-5 mt-0.5 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                paymentMethod === "online" ? "border-[#7C3AED]" : "border-gray-300"
              }`}
            >
              {paymentMethod === "online" && (
                <div className="h-2.5 w-2.5 rounded-full bg-[#7C3AED]" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-bold text-[#1E1E1E]">
                Pay Online
              </div>
              <div className="mt-0.5 text-[12px] text-[#444444]">
                UPI, Cards, NetBanking, Wallets
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Place Order / Pay */}
      {(() => {
        const isStoreClosed = storeHours && storeHours.is_open === false;
        const pending = getPendingPayment();
        const hasActivePendingPayment = Boolean(
          pending?.razorpay_order_id &&
          Date.now() - (pending.timestamp || 0) < 30 * 60 * 1000
        );
        const isDisabled =
          loading ||
          addresses.length === 0 ||
          !selectedAddress ||
          isStoreClosed ||
          (paymentMethod === "online" && hasActivePendingPayment);

        return (
          <>
            {sessionExpiredPending && (
              <div className="mb-3 flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
                <span className="font-semibold">
                  Your session expired while confirming payment. Sign in to resume your order.
                </span>
                <button
                  type="button"
                  onClick={() => navigate("/login?redirect=/checkout")}
                  className="rounded-lg bg-[#7C3AED] px-3 py-1 font-bold text-white hover:bg-[#6C35E8] cursor-pointer"
                >
                  Sign In
                </button>
              </div>
            )}
            {isPersistentPending && !sessionExpiredPending && (
              <div className="mb-4 rounded-[20px] border border-amber-200 bg-amber-50/90 p-4 text-xs text-amber-900 shadow-xs">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-200/80 text-amber-800">
                    <Clock size={18} />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-extrabold text-amber-950 text-sm">
                      Payment Pending Confirmation
                    </h4>
                    <p className="mt-1 leading-relaxed text-amber-800 text-[12px]">
                      Your payment is currently being processed by your bank. If the amount was debited from your account, please do not pay again — your order will update as soon as the bank confirms.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => verifyPendingOrder(true)}
                        disabled={checkingPendingStatus}
                        className="rounded-xl bg-[#7C3AED] px-3.5 py-1.5 font-bold text-white shadow-xs hover:bg-[#6C35E8] active:scale-95 cursor-pointer disabled:opacity-50"
                      >
                        {checkingPendingStatus ? "Checking..." : "Check Payment Status"}
                      </button>
                      <a
                        href="https://wa.me/918793601567?text=Hi%2C%20I%20have%20a%20question%20about%20my%20pending%20payment%20on%20Mumbai%20Collection"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-1.5 font-bold text-emerald-800 hover:bg-emerald-100"
                      >
                        WhatsApp Support (+91 87936 01567)
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {hasActivePendingPayment && paymentMethod === "online" && !isPersistentPending && !sessionExpiredPending && (
              <div className="mb-3 flex items-center justify-between rounded-xl border border-purple-200 bg-purple-50/80 px-3.5 py-2.5 text-xs text-[#7C3AED]">
                <span className="font-semibold flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin shrink-0" />
                  Confirming payment with bank (attempt {pollAttempt + 1} of 9)...
                </span>
                <button
                  type="button"
                  onClick={() => verifyPendingOrder(true)}
                  disabled={checkingPendingStatus}
                  className="font-bold underline hover:text-[#6D28D9] cursor-pointer disabled:opacity-50"
                >
                  {checkingPendingStatus ? "Checking..." : "Check Status"}
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={handlePlaceOrder}
              disabled={isDisabled}
              className={`flex h-[54px] w-full shrink-0 items-center justify-center gap-2 rounded-[17px] text-[15px] font-bold whitespace-nowrap transition-colors ${
                isStoreClosed
                  ? "bg-amber-600 text-white shadow-none cursor-not-allowed opacity-90"
                  : hasActivePendingPayment && paymentMethod === "online"
                  ? "bg-purple-100 text-[#7C3AED] border border-[#7C3AED]/30 cursor-wait opacity-90"
                  : "bg-[#7C3AED] text-white shadow-[0_7px_22px_rgba(124,58,237,0.2)] hover:bg-[#6C35E8] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              }`}
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin shrink-0" size={19} />
                  <span>
                    {paymentStep === "preparing"
                      ? "Preparing payment..."
                      : paymentStep === "opening_gateway"
                      ? "Opening payment gateway..."
                      : paymentStep.startsWith("confirming")
                      ? `Confirming with bank ${paymentStep.replace("confirming", "")}...`
                      : paymentStep === "verifying"
                      ? "Verifying payment..."
                      : "Processing..."}
                  </span>
                </>
              ) : hasActivePendingPayment && paymentMethod === "online" ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="animate-spin shrink-0" size={18} />
                  Confirming existing payment...
                </span>
              ) : isStoreClosed ? (
                "Store is Currently Closed for Orders"
              ) : paymentMethod === "online" ? (
                "Pay Online securely →"
              ) : (
                "Place Order securely →"
              )}
            </button>
          </>
        );
      })()}

      {/* Compliance & Policy Links */}
      <p className="mt-3.5 text-center text-[11px] leading-relaxed text-[#6B7280]">
        By placing your order, you agree to Mumbai Collection&apos;s{" "}
        <a
          href="/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[#7C3AED] hover:underline"
        >
          Terms
        </a>
        ,{" "}
        <a
          href="/privacy-policy"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[#7C3AED] hover:underline"
        >
          Privacy Policy
        </a>
        ,{" "}
        <a
          href="/shipping-policy"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[#7C3AED] hover:underline"
        >
          Shipping
        </a>
        , and{" "}
        <a
          href="/return-policy"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[#7C3AED] hover:underline"
        >
          Returns &amp; Refund Policy
        </a>
        .
      </p>

      {/* Out-of-Stock Notification Modal */}
      <StockNotificationModal
        isOpen={stockAlertOpen}
        onClose={() => setStockAlertOpen(false)}
        items={stockAlertItems}
        cartItems={cart?.items || []}
        onRemoveAndContinue={handleRemoveUnavailableAndContinue}
        onReturnToCart={handleReturnToCart}
        removing={removingStockItems}
      />
    </div>
  );
}

export default BillingForm;
