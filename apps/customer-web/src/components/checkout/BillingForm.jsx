import { useEffect, useState, useRef, useCallback } from "react";
import axios from "axios";
import { updateCheckout, updateCartItem, removeCartItem } from "../../services/storeApi";
import { createPaymentOrder, verifyPayment, checkPaymentStatus, cancelPaymentOrder } from "../../services/paymentService.js";
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
  ShieldCheck,
  Banknote,
  ChevronRight,
  ChevronUp,
  X,
  Check,
  Clock,
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

function BillingForm({
  storeHours,
  onStoreClosed,
  totalAmount,
  standaloneBar = false,
  hasOutOfStock = false,
  stockChecking = false,
}) {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { cart, refreshCart } = useCart();

  const [addresses, setAddresses] = useState(() => {
    try {
      const cached = safeStorage.getJSON("saved_addresses_cache", []);
      return Array.isArray(cached) ? cached : [];
    } catch {
      return [];
    }
  });
  const [selectedAddressId, setSelectedAddressId] = useState(() => {
    try {
      const cachedId = safeStorage.getItem("selected_address_id");
      if (cachedId) return Number(cachedId);
      const cached = safeStorage.getJSON("saved_addresses_cache", []);
      return cached && cached[0] ? cached[0].id : null;
    } catch {
      return null;
    }
  });
  const [paymentMethod, setPaymentMethod] = useState("cod"); // "cod" | "online"
  const [paymentStep, setPaymentStep] = useState(""); // "" | "preparing" | "opening_gateway" | "verifying"

  const [showAddressModal, setShowAddressModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  const [sessionExpiredPending, setSessionExpiredPending] = useState(false);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stockAlertOpen, setStockAlertOpen] = useState(false);
  const [stockAlertItems, setStockAlertItems] = useState([]);
  const [removingStockItems, setRemovingStockItems] = useState(false);
  const isSubmittingRef = useRef(false);
  const idempotencyKeyRef = useRef(getOrCreateCheckoutIdempotencyKey(cart));

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setShowAddressModal(false);
        setShowPaymentModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
              const available = Number(item.available);
              const requested = Number(item.requested);
              if (Number.isFinite(available) && available > 0 && available < requested) {
                await updateCartItem(targetKey, available);
              } else {
                await removeCartItem(targetKey);
              }
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
    if (!isAuthenticated) {
      setAddresses([]);
      setSelectedAddressId(null);
      setLoadingAddresses(false);
      return;
    }

    const loadAddresses = async () => {
      try {
        setLoadingAddresses(true);
        setError("");

        const response = await axios.get(`${API_URL}/addresses`, {
          withCredentials: true,
        });

        const savedAddresses = response.data.addresses || [];

        setAddresses(savedAddresses);
        safeStorage.setJSON("saved_addresses_cache", savedAddresses);

        // Keep current selection if valid, otherwise select first saved address
        if (savedAddresses.length > 0) {
          setSelectedAddressId((prev) => {
            const stillValid = prev && savedAddresses.some((a) => a.id === prev);
            const nextId = stillValid ? prev : savedAddresses[0].id;
            safeStorage.setItem("selected_address_id", nextId);
            return nextId;
          });
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
  }, [isAuthenticated]);

  const selectedAddress = addresses.find(
    (address) => address.id === selectedAddressId,
  );

  const handlePlaceOrder = async () => {
    if (isSubmittingRef.current) return;

    if (!isAuthenticated) {
      navigate("/login", { state: { from: "/cart" } });
      return;
    }

    if (addresses.length === 0) {
      navigate("/account/addresses");
      return;
    }

    if (!selectedAddress) {
      setError("Please select a delivery address.");
      return;
    }

    if (hasOutOfStock) {
      setError("Reduce the highlighted item quantities to continue.");
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
      // CartSummary already explains the minimum and the exact amount needed.
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

      const billingAddress = {
        first_name: firstName,
        last_name: lastName,
        email: userEmail,
        phone: userPhone,
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
          color: "#42D6E8",
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

            if (orderRes?.razorpay_order_id) {
              try {
                const cancelled = await cancelPaymentOrder(orderRes.razorpay_order_id);
                if (!cancelled?.cancelled) throw new Error('Cancellation not confirmed');
              } catch {
                setIsPersistentPending(true);
                setError('Payment status is still being checked. Please do not pay again.');
                return;
              }
            }
            clearPendingPayment();
            setIsPersistentPending(false);
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
      rzp.on("payment.failed", async (failedRes) => {
        if (failedRes?.error?.metadata?.order_id || orderRes?.razorpay_order_id) {
          try {
            const cancelled = await cancelPaymentOrder(failedRes?.error?.metadata?.order_id || orderRes?.razorpay_order_id);
            if (!cancelled?.cancelled) throw new Error('Cancellation not confirmed');
          } catch {
            isSubmittingRef.current = false;
            setLoading(false);
            setPaymentStep('');
            setIsPersistentPending(true);
            setError('Payment status is uncertain. Please check status before paying again.');
            return;
          }
        }
        isSubmittingRef.current = false;
        setLoading(false);
        setPaymentStep("");
        clearPendingPayment();
        setIsPersistentPending(false);
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
            : [];

        if (shortageDetails.length === 0) {
          setError(errData?.message || "Stock changed while you were checking out. Please review your cart before trying again.");
          navigate("/cart");
          return;
        }

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

  const finalTotal =
    totalAmount !== undefined && totalAmount !== null
      ? totalAmount
      : Number(cart?.totals?.total_price || 0) / 100;

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

  const isBelowMin = itemsSubtotal < 500;
  useEffect(() => {
    if (/minimum.*order value|^add ₹/i.test(error)) {
      if (isBelowMin) {
        const currentShortfall = Math.max(0, 500 - itemsSubtotal);
        setError(`Add ₹${currentShortfall} more to reach the minimum order value of ₹500.`);
      } else {
        setError("");
      }
      return;
    }

    if (!hasOutOfStock && /sold out|stock|highlighted item quantities/i.test(error)) {
      setError("");
    }
  }, [error, hasOutOfStock, isBelowMin, itemsSubtotal]);

  const isStoreClosed = storeHours && storeHours.is_open === false;
  const pending = getPendingPayment();
  const hasActivePendingPayment = Boolean(
    pending?.razorpay_order_id
  );
  const isDisabled =
    loading ||
    stockChecking ||
    isStoreClosed ||
    hasOutOfStock ||
    isBelowMin ||
    hasActivePendingPayment ||
    (isAuthenticated && addresses.length > 0 && !selectedAddress);

  if (loadingAddresses && !standaloneBar) {
    return (
      <div className="flex min-h-[160px] items-center justify-center rounded-[22px] border border-[#1E3252] bg-[#111F36] p-6 shadow-[0_4px_24px_rgba(0,0,0,0.3)]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#42D6E8]/20 border-t-[#42D6E8]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {stockChecking && (
        <div className="rounded-xl border border-[#42D6E8]/30 bg-[#132B45] px-3.5 py-2.5 text-xs font-bold text-[#A9EAF2]">
          Checking current availability…
        </div>
      )}
      {/* Error Banner */}
      {error && (
        <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 px-3.5 py-2.5 text-xs font-bold text-rose-300 shadow-xs">
          {error}
        </div>
      )}

      {/* Session Expired Mid-Payment */}
      {sessionExpiredPending && (
        <div className="flex items-center justify-between rounded-xl border border-amber-800/60 bg-amber-950/40 px-3.5 py-2.5 text-xs text-amber-200">
          <span className="font-semibold">
            Your session expired while confirming payment. Sign in to resume your order.
          </span>
          <button
            type="button"
            onClick={() => navigate("/login?redirect=/cart")}
            className="rounded-lg bg-[#42D6E8] px-3 py-1 font-bold text-[#061220] hover:bg-[#2CC4D8] hover:text-[#061220] cursor-pointer"
          >
            Sign In
          </button>
        </div>
      )}

      {/* Persistent Payment Pending Banner */}
      {isPersistentPending && !sessionExpiredPending && (
        <div className="rounded-[20px] border border-amber-800/60 bg-amber-950/40 p-4 text-xs text-amber-200 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-900/60 text-amber-300">
              <Clock size={18} />
            </div>
            <div className="flex-1">
              <h4 className="font-extrabold text-amber-100 text-sm">
                Payment Pending Confirmation
              </h4>
              <p className="mt-1 leading-relaxed text-amber-300/90 text-[12px]">
                Your payment is currently being processed by your bank. If the amount was debited from your account, please do not pay again — your order will update as soon as the bank confirms.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => verifyPendingOrder(true)}
                  disabled={checkingPendingStatus}
                  className="rounded-xl bg-[#42D6E8] px-3.5 py-1.5 font-bold text-[#061220] shadow-xs hover:bg-[#2CC4D8] hover:text-[#061220] active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {checkingPendingStatus ? "Checking..." : "Check Payment Status"}
                </button>
                <a
                  href="https://wa.me/918793601567?text=Hi%2C%20I%20have%20a%20question%20about%20my%20pending%20payment%20on%20Mumbai%20Collection"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl border border-emerald-800/60 bg-emerald-950/50 px-3.5 py-1.5 font-bold text-emerald-400 hover:bg-emerald-900/60"
                >
                  WhatsApp Support (+91 87936 01567)
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {!standaloneBar && (
        <>
          {/* Delivery Address Card (Compact) */}
          <div className="rounded-[22px] border border-[#1E3252]/80 bg-[#111F36] p-4 sm:p-5 shadow-[0_8px_30px_rgba(0,0,0,0.2)]">
            <div className="flex items-center justify-between border-b border-[#1E3252]/70 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#132B45] text-[#42D6E8] border border-[#1E3252]">
                  <MapPin size={16} strokeWidth={2.2} />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-extrabold text-[#F1F5F9]">
                    Delivery Address
                  </h2>
                  <p className="text-[11px] font-medium text-[#8FA4BE]">
                    Where your order will be delivered
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (addresses.length === 0) {
                    navigate("/account/addresses");
                  } else {
                    setShowAddressModal(true);
                  }
                }}
                disabled={loading}
                className="flex items-center gap-1 text-xs font-bold text-[#42D6E8] hover:underline cursor-pointer disabled:opacity-50"
              >
                {addresses.length === 0 ? (
                  <>
                    <Plus size={13} />
                    <span>Add Address</span>
                  </>
                ) : (
                  <span>Change</span>
                )}
              </button>
            </div>

            {/* Selected Address Preview or Empty State */}
            {addresses.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-dashed border-[#1E3252] bg-[#0B1425] p-4 text-center">
                <p className="text-xs font-bold text-[#F1F5F9]">No saved address found</p>
                <p className="mt-0.5 text-[11px] text-[#8FA4BE] font-medium">Please add a delivery address to proceed.</p>
                <button
                  type="button"
                  onClick={() => navigate("/account/addresses")}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-[#42D6E8] px-3.5 py-1.5 text-xs font-black text-[#061220] shadow-xs hover:bg-[#2CC4D8] hover:text-[#061220] active:scale-95 transition cursor-pointer"
                >
                  <Plus size={13} />
                  <span>Add Address</span>
                </button>
              </div>
            ) : selectedAddress ? (
              <div
                onClick={() => !loading && setShowAddressModal(true)}
                className="mt-3 flex items-start gap-3 rounded-2xl border border-[#1E3252] bg-[#0B1425] p-3 sm:p-3.5 hover:border-[#42D6E8]/60 transition cursor-pointer"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#132B45] text-[#42D6E8] border border-[#1E3252] shadow-xs">
                  {selectedAddress.type === "office" || selectedAddress.type === "work" ? (
                    <Building2 size={16} />
                  ) : (
                    <Home size={16} />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs sm:text-sm font-extrabold text-[#F1F5F9] truncate">
                      {selectedAddress.first_name || ""} {selectedAddress.last_name || ""}
                    </span>
                    <span className="rounded-full bg-[#132B45] px-2 py-0.5 text-[9px] font-extrabold uppercase text-[#42D6E8] border border-[#1E3252]">
                      {selectedAddress.type ? selectedAddress.type.toUpperCase() : "HOME"}
                    </span>
                  </div>

                  <p className="mt-1 text-xs font-medium text-[#8FA4BE] line-clamp-2">
                    {selectedAddress.address_line1 || ""}
                    {selectedAddress.address_line2 ? `, ${selectedAddress.address_line2}` : ""}
                    , {selectedAddress.city || ""}, {selectedAddress.state || "MH"}
                    {selectedAddress.pincode ? ` - ${selectedAddress.pincode}` : ""}
                  </p>

                  {selectedAddress.phone && (
                    <p className="mt-1 text-xs font-semibold text-[#42D6E8]">
                      📞 {selectedAddress.phone}
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {/* Payment Method Card (Compact) */}
          <div className="rounded-[22px] border border-[#1E3252]/80 bg-[#111F36] p-4 sm:p-5 shadow-[0_8px_30px_rgba(0,0,0,0.2)]">
            <div className="flex items-center justify-between border-b border-[#1E3252]/70 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#132B45] text-[#42D6E8] border border-[#1E3252]">
                  <CreditCard size={16} strokeWidth={2.2} />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-extrabold text-[#F1F5F9]">
                    Payment Method
                  </h2>
                  <p className="text-[11px] font-medium text-[#8FA4BE]">
                    Select how you wish to pay
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => !loading && setShowPaymentModal(true)}
                disabled={loading}
                className="text-xs font-bold text-[#42D6E8] hover:underline cursor-pointer disabled:opacity-50"
              >
                Change
              </button>
            </div>

            <div
              onClick={() => !loading && setShowPaymentModal(true)}
              className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-[#1E3252] bg-[#0B1425] p-3 sm:p-3.5 hover:border-[#42D6E8]/60 transition cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#132B45] text-[#42D6E8] border border-[#1E3252] shadow-xs">
                  {paymentMethod === "online" ? (
                    <CreditCard size={18} />
                  ) : (
                    <Banknote size={18} className="text-[#42D6E8]" />
                  )}
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-extrabold text-[#F1F5F9]">
                    {paymentMethod === "online" ? "Pay Online" : "Cash on Delivery (COD)"}
                  </h4>
                  <p className="text-[11px] font-medium text-[#8FA4BE] truncate">
                    {paymentMethod === "online" ? "UPI, Cards, NetBanking, Wallets" : "Pay with cash upon delivery"}
                  </p>
                </div>
              </div>

              <span className="text-xs font-bold text-[#42D6E8] shrink-0">
                Switch
              </span>
            </div>
          </div>
        </>
      )}

      {/* Checkout policy notice */}
      <p className="mt-3 flex flex-wrap items-center justify-center gap-x-1 text-center text-[11px] font-medium leading-5 text-[#8FA4BE]">
        <span>By placing your order, you agree to our</span>
        <a href="/terms" target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-semibold text-[#42D6E8] hover:underline">
          Terms and Conditions
        </a>
        <span aria-hidden="true">·</span>
        <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-semibold text-[#42D6E8] hover:underline">
          Privacy Policy
        </a>
        <span aria-hidden="true">·</span>
        <a href="/shipping-policy" target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-semibold text-[#42D6E8] hover:underline">
          Shipping Policy
        </a>
        <span aria-hidden="true">·</span>
        <a href="/return-policy" target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-semibold text-[#42D6E8] hover:underline">
          Returns &amp; Refund Policy
        </a>
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

      {/* Address Selection Modal / Bottom Sheet */}
      {showAddressModal && (
        <div
          onClick={() => setShowAddressModal(false)}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-[520px] max-h-[85vh] flex-col rounded-t-[28px] sm:rounded-[24px] bg-[#111F36] border border-[#1E3252] p-5 sm:p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[#1E3252]/70 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-[#F1F5F9]">
                  Select Delivery Address
                </h3>
                <p className="text-xs font-medium text-[#8FA4BE]">
                  Where should we send your order?
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddressModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#8FA4BE] hover:bg-[#162744] hover:text-white transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-3.5 space-y-2.5 overflow-y-auto pr-1 flex-1 max-h-[50vh]">
              {addresses.map((addr) => {
                const isSelected = selectedAddressId === addr.id;
                const isHome = addr.type === "home";

                return (
                  <div
                    key={addr.id}
                    onClick={() => {
                      setSelectedAddressId(addr.id);
                      safeStorage.setItem("selected_address_id", addr.id);
                      setShowAddressModal(false);
                    }}
                    className={`flex items-start gap-3 rounded-2xl border p-3.5 transition-all cursor-pointer ${
                      isSelected
                        ? "border-[#42D6E8] bg-[#132B45]/70 ring-2 ring-[#42D6E8]/20 shadow-xs"
                        : "border-[#1E3252] bg-[#0B1425] hover:border-[#42D6E8]/50"
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
                        isSelected
                          ? "bg-[#111F36] text-[#42D6E8] border-[#42D6E8]/50"
                          : "bg-[#111F36] text-[#6E84A3] border-[#1E3252]"
                      }`}
                    >
                      {isHome ? <Home size={15} /> : <Building2 size={15} />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs sm:text-sm font-extrabold text-[#F1F5F9] truncate">
                          {addr.first_name || ""} {addr.last_name || ""}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide border ${
                            isSelected
                              ? "bg-[#132B45] text-[#42D6E8] border-[#1E3252]"
                              : "bg-[#0E1A2E] text-[#8FA4BE] border-[#1E3252]"
                          }`}
                        >
                          {addr.type ? addr.type.toUpperCase() : "HOME"}
                        </span>
                      </div>

                      <p className="mt-1 text-xs font-medium text-[#8FA4BE] line-clamp-2">
                        {addr.address_line1 || ""}
                        {addr.address_line2 ? `, ${addr.address_line2}` : ""}
                        , {addr.city || ""}, {addr.state || "MH"}
                        {addr.pincode ? ` - ${addr.pincode}` : ""}
                      </p>

                      {addr.phone && (
                        <p className="mt-1 text-xs font-semibold text-[#42D6E8]">
                          📞 {addr.phone}
                        </p>
                      )}
                    </div>

                    {isSelected && (
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#42D6E8] text-[#061220] self-center">
                        <Check size={12} strokeWidth={3} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 pt-3 border-t border-[#1E3252]/70">
              <button
                type="button"
                onClick={() => {
                  setShowAddressModal(false);
                  navigate("/account/addresses");
                }}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#42D6E8]/40 bg-[#132B45]/30 py-3 text-xs font-extrabold text-[#42D6E8] hover:bg-[#132B45]/50 active:scale-[0.99] transition cursor-pointer"
              >
                <Plus size={15} />
                <span>Add New Address</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Method Selection Modal / Bottom Sheet */}
      {showPaymentModal && (
        <div
          onClick={() => setShowPaymentModal(false)}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-[500px] flex-col rounded-t-[28px] sm:rounded-[24px] bg-[#111F36] border border-[#1E3252] p-5 sm:p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[#1E3252]/70 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-[#F1F5F9]">
                  Select Payment Method
                </h3>
                <p className="text-xs font-medium text-[#8FA4BE]">
                  How would you like to pay?
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#8FA4BE] hover:bg-[#162744] hover:text-white transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {/* Pay Online */}
              <div
                onClick={() => {
                  setPaymentMethod("online");
                  setShowPaymentModal(false);
                }}
                className={`flex items-start gap-3 rounded-2xl border p-4 transition-all cursor-pointer ${
                  paymentMethod === "online"
                    ? "border-[#42D6E8] bg-[#132B45]/70 ring-2 ring-[#42D6E8]/20 shadow-xs"
                    : "border-[#1E3252] bg-[#0B1425] hover:border-[#42D6E8]/50"
                }`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                    paymentMethod === "online"
                      ? "bg-[#111F36] text-[#42D6E8] border-[#42D6E8]/50"
                      : "bg-[#111F36] text-[#6E84A3] border-[#1E3252]"
                  }`}
                >
                  <CreditCard size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-extrabold text-[#F1F5F9]">
                      Pay Online
                    </h4>
                    {paymentMethod === "online" && (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#42D6E8] text-[#061220]">
                        <Check size={12} strokeWidth={3} />
                      </div>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs font-medium text-[#8FA4BE]">
                    UPI (Google Pay, PhonePe, Paytm), Cards, NetBanking, Wallets
                  </p>
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] font-bold text-[#42D6E8] bg-[#132B45] px-2 py-0.5 rounded-md w-fit border border-[#1E3252]">
                    <ShieldCheck size={12} />
                    <span>Instant &amp; 100% Secure via Razorpay</span>
                  </div>
                </div>
              </div>

              {/* Cash on Delivery */}
              <div
                onClick={() => {
                  setPaymentMethod("cod");
                  setShowPaymentModal(false);
                }}
                className={`flex items-start gap-3 rounded-2xl border p-4 transition-all cursor-pointer ${
                  paymentMethod === "cod"
                    ? "border-[#42D6E8] bg-[#132B45]/70 ring-2 ring-[#42D6E8]/20 shadow-xs"
                    : "border-[#1E3252] bg-[#0B1425] hover:border-[#42D6E8]/50"
                }`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                    paymentMethod === "cod"
                      ? "bg-[#111F36] text-[#42D6E8] border-[#42D6E8]/50"
                      : "bg-[#111F36] text-[#6E84A3] border-[#1E3252]"
                  }`}
                >
                  <Banknote size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-extrabold text-[#F1F5F9]">
                      Cash on Delivery (COD)
                    </h4>
                    {paymentMethod === "cod" && (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#42D6E8] text-[#061220]">
                        <Check size={12} strokeWidth={3} />
                      </div>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs font-medium text-[#8FA4BE]">
                    Pay with cash upon delivery at your doorstep
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sticky Quick-Commerce Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#0B1425]/95 backdrop-blur-md border-t border-[#1E3252] rounded-t-[24px] sm:rounded-t-[28px] shadow-[0_-8px_25px_rgba(0,0,0,0.5)] transform-gpu will-change-transform">
        <div className="mx-auto w-full max-w-[700px] px-3.5 sm:px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {/* Subtle Pull Indicator Pill */}
          <div className="mx-auto w-9 h-1 rounded-full bg-[#1E3252] mb-2 opacity-80" />

          {/* Row 1: Unified Address Capsule */}
          <div className="flex items-center justify-between gap-2.5 rounded-2xl bg-[#111F36] border border-[#1E3252]/80 px-2.5 py-2 sm:py-2.5 mb-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.2)]">
            {loadingAddresses && !selectedAddress ? (
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="flex h-8 w-8 sm:h-8.5 sm:w-8.5 shrink-0 items-center justify-center rounded-xl bg-[#132B45] text-[#42D6E8] border border-[#1E3252] shadow-xs">
                    <Home size={16} strokeWidth={2.4} className="animate-pulse" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-3 w-24 bg-[#1E3252] rounded animate-pulse" />
                    <div className="h-2.5 w-40 bg-[#162744] rounded animate-pulse" />
                  </div>
                </div>
                <div className="h-7 w-14 bg-[#162744] rounded-xl animate-pulse shrink-0" />
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (!isAuthenticated) {
                      navigate("/login", { state: { from: "/cart" } });
                    } else if (addresses.length === 0) {
                      navigate("/account/addresses");
                    } else {
                      setShowAddressModal(true);
                    }
                  }}
                  className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer hover:opacity-85 transition-opacity select-none"
                >
                  <div className="flex h-8 w-8 sm:h-8.5 sm:w-8.5 shrink-0 items-center justify-center rounded-xl bg-[#132B45] text-[#42D6E8] border border-[#1E3252] shadow-xs">
                    {selectedAddress?.type === "office" || selectedAddress?.type === "work" ? (
                      <Building2 size={16} strokeWidth={2.4} />
                    ) : (
                      <Home size={16} strokeWidth={2.4} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 leading-tight">
                      <span className="font-black text-xs sm:text-[13px] text-[#F1F5F9] tracking-tight">
                        {!isAuthenticated
                          ? "Delivering to"
                          : selectedAddress
                          ? `Delivering to ${selectedAddress.type ? (selectedAddress.type.charAt(0).toUpperCase() + selectedAddress.type.slice(1)) : "Home"}`
                          : "No delivery address"}
                      </span>
                    </div>
                    <p className="text-[11px] font-medium text-[#8FA4BE] truncate leading-tight mt-0.5">
                      {!isAuthenticated
                        ? "Login to select delivery address"
                        : selectedAddress
                        ? `${selectedAddress.address_line1 || ""}${selectedAddress.city ? `, ${selectedAddress.city}` : ""}${selectedAddress.pincode ? ` - ${selectedAddress.pincode}` : ""}`
                        : "Click to add your delivery address"}
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!isAuthenticated) {
                      navigate("/login", { state: { from: "/cart" } });
                    } else if (addresses.length === 0) {
                      navigate("/account/addresses");
                    } else {
                      setShowAddressModal(true);
                    }
                  }}
                  className="shrink-0 text-[11px] sm:text-xs font-black text-[#42D6E8] bg-[#132B45] border border-[#1E3252] hover:bg-[#42D6E8] hover:text-[#061220] px-3 py-1.5 rounded-xl shadow-xs active:scale-95 transition-all cursor-pointer"
                >
                  {!isAuthenticated
                    ? "Login"
                    : addresses.length === 0
                    ? "+ Add"
                    : "Change"}
                </button>
              </>
            )}
          </div>

          {/* Row 2: Payment Selector & Main Action Button */}
          <div className="flex items-center justify-between gap-2.5 sm:gap-3">
            {/* Payment Method Selector */}
            <button
              type="button"
              onClick={() => setShowPaymentModal(true)}
              disabled={loading}
              className="flex items-center gap-2 sm:gap-2.5 p-1.5 sm:p-2 rounded-xl hover:bg-[#162744] active:scale-95 transition-all cursor-pointer max-w-[42%] min-w-0 disabled:opacity-50 text-left"
            >
              <div
                className={`flex h-8 w-8 sm:h-8.5 sm:w-8.5 shrink-0 items-center justify-center rounded-xl border shadow-xs bg-[#132B45] border-[#1E3252] text-[#42D6E8]`}
              >
                {paymentMethod === "online" ? (
                  <CreditCard size={15} strokeWidth={2.2} />
                ) : (
                  <Banknote size={16} strokeWidth={2.2} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-[#6E84A3] leading-tight">
                  PAY USING <ChevronUp size={11} className="text-[#42D6E8] stroke-[2.8]" />
                </span>
                <span className="block text-xs sm:text-[13px] font-black text-[#F1F5F9] truncate leading-tight mt-0.5">
                  {paymentMethod === "online" ? "Pay Online" : "Cash on Delivery"}
                </span>
              </div>
            </button>

            {/* Main Action Button */}
            <button
              type="button"
              onClick={handlePlaceOrder}
              disabled={isDisabled}
              className={`group flex items-center justify-between gap-3 sm:gap-4 h-[56px] sm:h-[60px] px-4 sm:px-5 rounded-[20px] font-black transition-all shadow-[0_7px_24px_rgba(66,214,232,0.3)] active:scale-[0.98] cursor-pointer flex-1 max-w-[250px] sm:max-w-[280px] ${
                isStoreClosed
                  ? "bg-amber-600 text-white shadow-none cursor-not-allowed opacity-90"
                  : hasActivePendingPayment
                  ? "bg-cyan-800 text-white cursor-wait opacity-90"
                  : hasOutOfStock || isBelowMin
                  ? "bg-[#0E1A2E] text-[#6E84A3] border border-[#1E3252] shadow-none cursor-not-allowed opacity-80"
                  : "bg-gradient-to-r from-[#42D6E8] to-[#2CC4D8] text-[#061220] hover:from-[#2CC4D8] hover:to-[#1FBAD0] hover:text-[#061220] disabled:cursor-not-allowed disabled:opacity-60"
              }`}
            >
              {/* Total Price & Label */}
              <div className="flex shrink-0 flex-col items-center justify-center text-center leading-none">
                <div className="flex items-baseline gap-0.5">
                  <span className="text-xs sm:text-sm font-black opacity-90 leading-none">₹</span>
                  <span className="text-[17px] sm:text-lg font-black tracking-tight leading-none">
                    {Number(finalTotal).toLocaleString("en-IN")}
                  </span>
                </div>
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] opacity-75 mt-1 leading-none">
                  TOTAL
                </span>
              </div>

              {/* Vertical divider */}
              <div className="h-8 w-px bg-black/20 rounded-full shrink-0" />

              {/* Action text & chevron */}
              <div className="flex min-h-10 min-w-0 items-center gap-1 rounded-full border border-black/10 bg-black/10 px-3 text-[13px] sm:text-sm font-black whitespace-nowrap">
                {loading ? (
                  <>
                    <Loader2 size={15} className="animate-spin shrink-0" />
                    <span className="truncate">
                      {paymentStep === "preparing"
                        ? "Preparing..."
                        : paymentStep === "opening_gateway"
                        ? "Opening..."
                        : paymentStep.startsWith("confirming") || paymentStep === "verifying"
                        ? "Verifying..."
                        : "Processing..."}
                    </span>
                  </>
                ) : hasActivePendingPayment ? (
                  <>
                    <Loader2 size={15} className="animate-spin shrink-0" />
                    <span className="truncate">Verifying...</span>
                  </>
                ) : isStoreClosed ? (
                  <span className="truncate">Store Closed</span>
                ) : hasOutOfStock ? (
                  <span className="truncate">Review quantities</span>
                ) : isBelowMin ? (
                  <span className="truncate">Min. ₹500 Order</span>
                ) : !isAuthenticated ? (
                  <>
                    <span className="truncate">Login to Order</span>
                    <ChevronRight size={16} strokeWidth={2.8} className="shrink-0" />
                  </>
                ) : addresses.length === 0 ? (
                  <>
                    <span className="truncate">Add Address</span>
                    <ChevronRight size={16} strokeWidth={2.8} className="shrink-0" />
                  </>
                ) : paymentMethod === "online" ? (
                  <>
                    <span className="truncate">Pay Online</span>
                    <ChevronRight size={16} strokeWidth={2.8} className="shrink-0" />
                  </>
                ) : (
                  <>
                    <span className="truncate">Place Order</span>
                    <ChevronRight size={16} strokeWidth={2.8} className="shrink-0" />
                  </>
                )}
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BillingForm;
