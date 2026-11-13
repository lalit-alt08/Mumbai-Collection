import { useEffect, useState, useRef, useCallback } from "react";
import axios from "axios";
import { updateCartItem, removeCartItem } from "../../services/storeApi";
import { createPaymentOrder, verifyPayment, checkPaymentStatus, cancelPaymentOrder } from "../../services/paymentService.js";
import { useNavigate, useLocation } from "react-router-dom";
import API_URL from "../../config/api.js";
import safeStorage from "../../utils/safeStorage.js";
import StockNotificationModal from "./StockNotificationModal";
import {
  MapPin,
  CreditCard,
  Home,
  Building2,
  Plus,
  ChevronRight,
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
  retireCheckoutIdempotencyKey,
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
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, handleSessionExpired, checkoutExpiredUserId, loading: authLoading, isReconnecting } = useAuth();
  const { cart, refreshCart, updateCart } = useCart();

  const [addresses, setAddresses] = useState(() => {
    try {
      if (!user?.id) return [];
      const key = `saved_addresses_cache_${user.id}`;
      const cached = safeStorage.getJSON(key, []);
      return Array.isArray(cached) ? cached : [];
    } catch {
      return [];
    }
  });
  const [selectedAddressId, setSelectedAddressId] = useState(() => {
    try {
      if (!user?.id) return null;
      const idKey = `selected_address_id_${user.id}`;
      const cachedId = safeStorage.getItem(idKey);
      if (cachedId) return String(cachedId);
      const addrKey = `saved_addresses_cache_${user.id}`;
      const cached = safeStorage.getJSON(addrKey, []);
      return cached && cached[0] ? String(cached[0].id) : null;
    } catch {
      return null;
    }
  });
  const [paymentStep, setPaymentStep] = useState(""); // "" | "preparing" | "opening_gateway" | "verifying"

  const [showAddressModal, setShowAddressModal] = useState(false);

  const [sessionExpiredPending, setSessionExpiredPending] = useState(false);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [addressLoadFailed, setAddressLoadFailed] = useState(false);
  const [addressRetry, setAddressRetry] = useState(0);
  const [addressSignInRequired, setAddressSignInRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stockAlertOpen, setStockAlertOpen] = useState(false);
  const [stockAlertItems, setStockAlertItems] = useState([]);
  const [removingStockItems, setRemovingStockItems] = useState(false);
  const isSubmittingRef = useRef(false);
  const idempotencyKeyRef = useRef(getOrCreateCheckoutIdempotencyKey(cart, user?.id));
  const activeOrderRef = useRef(null);
  const [cancellingPending, setCancellingPending] = useState(false);
  const [unconfirmedQuote, setUnconfirmedQuote] = useState(null);

  // Bind review to the quoted cart contents and selected address.
  // Clear it on an actual customer change, while preserving it when installing the quote being reviewed.
  useEffect(() => {
    if (!unconfirmedQuote) return;
    const currentFingerprint = computeCartItemsFingerprint(cart);
    if (
      String(selectedAddressId) !== String(unconfirmedQuote.addressId) ||
      currentFingerprint !== unconfirmedQuote.itemsFingerprint
    ) {
      setUnconfirmedQuote(null);
    }
  }, [selectedAddressId, cart?.items, unconfirmedQuote]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setShowAddressModal(false);
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
  const activeUserRef = useRef(user?.id);
  activeUserRef.current = user?.id;

  const verifyPendingOrder = useCallback(async (isManualOrTrigger = false) => {
    const stored = getPendingPayment(user?.id || checkoutExpiredUserId);
    if (!stored || !stored.razorpay_order_id) {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      setIsPersistentPending(false);
      activeOrderRef.current = null;
      return;
    }

    if (!isAuthenticated || !user?.id) return;
    const requestUserId = user.id;
    const requestOrderId = stored.razorpay_order_id;
    activeOrderRef.current = requestOrderId;

    // Query payment finalization state by Razorpay order ID FIRST
    try {
      setCheckingPendingStatus(true);
      const res = await checkPaymentStatus(requestOrderId);
      if (String(activeUserRef.current) !== String(requestUserId) || activeOrderRef.current !== requestOrderId) return;
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
      if (res?.refunded || res?.terminal || res?.cancelled) {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        clearPendingPayment(user?.id);
        retireCheckoutIdempotencyKey(user?.id);
        idempotencyKeyRef.current = generateUUID();
        await refreshCart().catch(() => {});
        setError(res.message || (res.refunded
          ? "Your payment was refunded."
          : "This payment attempt has ended. You can start a fresh checkout."));
        setIsPersistentPending(false);
        return;
      }
    } catch (err) {
      if (String(activeUserRef.current) !== String(requestUserId)) return;
      if (err?.response?.status === 401) {
        // Session expired mid-payment: NEVER clear pendingPayment!
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        setSessionExpiredPending(true);
        setError("");
        handleSessionExpired({ checkout: true });
        return;
      }
      setError("Could not verify payment status with gateway. Please tap 'Check Payment Status' to retry.");
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
  }, [cart, navigate, refreshCart, user?.id, isAuthenticated, checkoutExpiredUserId]);

  const handleCancelUnpaidCheckout = async () => {
    const stored = getPendingPayment(user?.id || checkoutExpiredUserId);
    if (!stored?.razorpay_order_id || cancellingPending) return;
    const requestUserId = user?.id;
    const requestOrderId = stored.razorpay_order_id;
    try {
      setCancellingPending(true);
      setError("");
      const res = await cancelPaymentOrder(requestOrderId);
      if (String(activeUserRef.current) !== String(requestUserId) || activeOrderRef.current !== requestOrderId) return;
      if (res?.cancelled || res?.terminal) {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        clearPendingPayment(user?.id);
        retireCheckoutIdempotencyKey(user?.id);
        idempotencyKeyRef.current = generateUUID();
        setIsPersistentPending(false);
        setUnconfirmedQuote(null);
        setError("Checkout session cancelled. You can retry paying anytime.");
        await refreshCart().catch(() => {});
      } else if (res?.status === 409 || res?.code === "PAYMENT_ALREADY_CAPTURED" || res?.code === "PAYMENT_PROCESSING") {
        setError(res.message || "A payment is processing. Please check status before paying again.");
        setIsPersistentPending(true);
      } else {
        setError(res?.message || "Unable to confirm cancellation. Please retry.");
      }
    } catch (err) {
      if (String(activeUserRef.current) !== String(requestUserId) || activeOrderRef.current !== requestOrderId) return;
      setError(err.response?.data?.message || err.message || "Failed to cancel checkout session. Please retry.");
    } finally {
      setCancellingPending(false);
    }
  };

  useEffect(() => {
    idempotencyKeyRef.current = getOrCreateCheckoutIdempotencyKey(cart, user?.id);
  }, [cart, user?.id]);

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
    if (!isAuthenticated || !user?.id) {
      setAddresses([]);
      setSelectedAddressId(null);
      setAddressLoadFailed(false);
      setLoadingAddresses(false);
      return;
    }

    let isMounted = true;
    const controller = new AbortController();
    const currentUserId = user.id;
    const addressCacheKey = `saved_addresses_cache_${currentUserId}`;
    const selectedAddressKey = `selected_address_id_${currentUserId}`;

    const loadAddresses = async () => {
      try {
        setLoadingAddresses(true);
        setAddressLoadFailed(false);
        setError("");

        const response = await axios.get(`${API_URL}/addresses`, {
          withCredentials: true,
          signal: controller.signal,
          timeout: 12000,
        });

        if (!isMounted || user?.id !== currentUserId) return;

        if (!Array.isArray(response.data?.addresses)) throw new Error("Invalid address response");
        const savedAddresses = response.data.addresses;
        setAddressSignInRequired(false);

        setAddresses(savedAddresses);
        safeStorage.setJSON(addressCacheKey, savedAddresses);
        // Clean up any remaining legacy unscoped storage keys
        safeStorage.removeItem("saved_addresses_cache");
        safeStorage.removeItem("selected_address_id");

        // Keep current selection if valid, or priority from location.state, otherwise select first saved address
        if (savedAddresses.length > 0) {
          const targetId = location.state?.selectedAddressId;
          const targetExists = targetId && savedAddresses.some((a) => String(a.id) === String(targetId));

          setSelectedAddressId((prev) => {
            if (targetExists) {
              const targetStr = String(targetId);
              safeStorage.setItem(selectedAddressKey, targetStr);
              return targetStr;
            }
            const stillValid = prev && savedAddresses.some((a) => String(a.id) === String(prev));
            const nextId = stillValid ? String(prev) : String(savedAddresses[0].id);
            safeStorage.setItem(selectedAddressKey, nextId);
            return nextId;
          });
        } else {
          setSelectedAddressId(null);
          safeStorage.removeItem(selectedAddressKey);
        }
      } catch (error) {
        if (!isMounted || user?.id !== currentUserId) return;
        // On load failure, clear address list and disable checkout until addresses are verified
        setAddresses([]);
        setSelectedAddressId(null);
        setShowAddressModal(false);
        if (error.response?.status === 401) {
          setAddressSignInRequired(true);
          setAddressLoadFailed(false);
          setError("");
          handleSessionExpired({ checkout: true });
        } else {
          setAddressLoadFailed(true);
        }
      } finally {
        if (isMounted && user?.id === currentUserId) {
          setLoadingAddresses(false);
        }
      }
    };

    loadAddresses();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [isAuthenticated, user?.id, location.state?.selectedAddressId, addressRetry]);

  const selectedAddress = addresses.find(
    (address) => String(address.id) === String(selectedAddressId),
  );

  const handlePlaceOrder = async () => {
    if (isSubmittingRef.current) return;

    if (!isAuthenticated || addressSignInRequired) {
      navigate("/login", { state: { from: "/cart" } });
      return;
    }

    if (loadingAddresses) return;
    if (addressLoadFailed) { setAddressRetry((value) => value + 1); return; }

    if (addresses.length === 0) {
      navigate("/account/addresses", { state: { from: "/cart", selectNew: true } });
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

    const isManualClosed = storeHours?.manual_override === "closed";
    if (isManualClosed) {
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
        isSubmittingRef.current = false;
        setLoading(false);
        return;
      }

      const rawPhone = (selectedAddress.phone || user?.phone || "").replace(/\D/g, "");
      const cleanPhone = rawPhone.length === 12 && rawPhone.startsWith("91") ? rawPhone.slice(2) : rawPhone;
      if (!cleanPhone || cleanPhone.length < 10) {
        setError("Please enter a valid 10-digit mobile number on your delivery address so our courier can deliver your order.");
        isSubmittingRef.current = false;
        setLoading(false);
        return;
      }
      const userPhone = cleanPhone;
      const rawPrimaryPhone = String(user?.phone || "").replace(/\D/g, "");
      const primaryPhone = rawPrimaryPhone.length === 12 && rawPrimaryPhone.startsWith("91") ? rawPrimaryPhone.slice(2) : rawPrimaryPhone;
      const cleanPincode =
        (selectedAddress.pincode || "").replace(/\D/g, "") || "";

      if (!selectedAddress.address_line1?.trim() || !selectedAddress.city?.trim()) {
        setError("Please update your delivery address before placing your order.");
        isSubmittingRef.current = false;
        setLoading(false);
        return;
      }

      const billingAddress = {
        first_name: firstName,
        last_name: lastName,
        email: userEmail,
        phone: /^[6-9]\d{9}$/.test(primaryPhone) ? primaryPhone : userPhone,
        address_1: selectedAddress.address_line1.trim(),
        address_2: selectedAddress.address_line2 || "",
        city: selectedAddress.city.trim(),
        state: stateCode,
        postcode: cleanPincode,
        country: "IN",
      };

      const shippingAddress = {
        first_name: firstName,
        last_name: lastName,
        phone: userPhone,
        address_1: selectedAddress.address_line1.trim(),
        address_2: selectedAddress.address_line2 || "",
        city: selectedAddress.city.trim(),
        state: stateCode,
        postcode: cleanPincode,
        country: "IN",
      };

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
        expected_total_paise: Math.round(Number(finalTotal) * 100),
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

      setPendingPayment({
        razorpay_order_id: orderRes.razorpay_order_id,
        cartFingerprint: computeCartFingerprint(cart),
        itemsFingerprint: computeCartItemsFingerprint(cart),
        timestamp: Date.now(),
      }, user?.id);

      // Explicitly set active order and user refs BEFORE opening Razorpay modal
      activeOrderRef.current = orderRes.razorpay_order_id;
      activeUserRef.current = user?.id;

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

            // Guard against stale callbacks from switched user or previous checkout attempt
            if (String(activeUserRef.current) !== String(requestUserId) || activeOrderRef.current !== requestOrderId) {
              return;
            }

            // Check whether order was already completed in backend (e.g. via webhook while in UPI app)
            try {
              if (requestOrderId) {
                const checkRes = await checkPaymentStatus(requestOrderId);
                if (String(activeUserRef.current) !== String(requestUserId) || activeOrderRef.current !== requestOrderId) return;
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
                // Keep captured, authorized, and processing attempts in recovery
                if (checkRes?.captured || checkRes?.authorized || checkRes?.processing) {
                  setIsPersistentPending(true);
                  setError("Payment is processing or confirmed. Please check payment status before trying again.");
                  return;
                }
              }
            } catch (_) {
              // Status check failure: preserve recovery
            }

            if (requestOrderId) {
              try {
                const cancelRes = await cancelPaymentOrder(requestOrderId);
                if (String(activeUserRef.current) !== String(requestUserId) || activeOrderRef.current !== requestOrderId) return;
                if (!cancelRes?.cancelled && !cancelRes?.terminal) {
                  setIsPersistentPending(true);
                  setError("Payment status is still being checked. Please do not pay again.");
                  return;
                }
              } catch (cancelErr) {
                if (String(activeUserRef.current) !== String(requestUserId) || activeOrderRef.current !== requestOrderId) return;
                setIsPersistentPending(true);
                setError(cancelErr?.response?.data?.message || 'Payment status is still being checked. Please do not pay again.');
                return;
              }
            }
            if (String(activeUserRef.current) !== String(requestUserId) || activeOrderRef.current !== requestOrderId) return;
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

          // Scope check: verify user and order match the current active attempt
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
              if (String(activeUserRef.current) === String(requestUserId) && activeOrderRef.current === requestOrderId) {
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

            if (verifyRes.refunded || verifyRes.terminal) {
              if (String(activeUserRef.current) === String(requestUserId) && activeOrderRef.current === requestOrderId) {
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
              setIsPersistentPending(true);
              setError("We couldn’t confirm your payment. Please don’t pay again. Check payment status or contact the store.");
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
                  if (String(activeUserRef.current) === String(requestUserId) && activeOrderRef.current === requestOrderId) {
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
                  if (String(activeUserRef.current) === String(requestUserId) && activeOrderRef.current === requestOrderId) {
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
                // Continue to next polling attempt
              }
            }

            if (!pollSucceeded) {
              // Retain pendingPayment in safeStorage so auto-recovery works upon refresh or reopening the app
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
    } catch (error) {
      const errStatus = error.response?.status;
      const errData = error.response?.data;
      const isProcessingConflict =
        errStatus === 409 &&
        (errData?.message?.includes("currently being processed") ||
          errData?.code === "ORDER_PROCESSING");

      if (errStatus === 401) {
        handleSessionExpired({ checkout: true });
        setAddressSignInRequired(true);
        setError("");
      } else if (errData?.code === "CUSTOMER_SUSPENDED") {
        setError(
          errData?.message ||
            "Your account is currently suspended and you cannot place new orders.",
        );
      } else if (errData?.code === "STORE_CLOSED") {
        const msg = errData?.message || "We are currently closed for new orders.";
        const resumeTime = errData?.next_opening?.label ? ` Ordering resumes ${errData.next_opening.label}.` : "";
        setError(`${msg}${resumeTime}`);
        if (typeof onStoreClosed === "function") {
          onStoreClosed({
            is_open: false,
            manual_override: errData?.manual_override || "closed",
            closed_message: errData?.message || "Our store is currently closed.",
            next_opening: errData?.next_opening || null,
          });
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
          isSubmittingRef.current = false;
          setLoading(false);
          setPaymentStep("");
          navigate("/cart");
          return;
        }

        setStockAlertItems(shortageDetails);
        setStockAlertOpen(true);
        setError("");
      } else if (errData?.code === "CHECKOUT_TOTAL_CHANGED" || errData?.code === "woocommerce_rest_checkout_total_mismatch") {
        retireCheckoutIdempotencyKey(user?.id);
        idempotencyKeyRef.current = generateUUID();
        const authoritativeCart = errData.cart || null;
        const actualPaise = errData.actual_total_paise || (authoritativeCart?.totals?.total_price ? Number(authoritativeCart.totals.total_price) : null);
        if (authoritativeCart && typeof updateCart === "function") {
          updateCart(authoritativeCart);
        } else if (actualPaise && cart && typeof updateCart === "function") {
          updateCart({
            ...cart,
            totals: {
              ...(cart.totals || {}),
              total_price: String(actualPaise),
            },
          });
        }
        const newTotalStr = actualPaise ? (Number(actualPaise) / 100).toFixed(2) : null;
        const quoteFingerprint = computeCartItemsFingerprint(authoritativeCart || cart);
        setUnconfirmedQuote({
          expected_total_paise: errData.expected_total_paise,
          actual_total_paise: actualPaise || Math.round(Number(finalTotal) * 100),
          itemsFingerprint: quoteFingerprint,
          addressId: selectedAddressId,
        });
        setError(errData?.code === "CHECKOUT_TOTAL_CHANGED"
          ? `Your cart total changed from ₹${(errData.expected_total_paise / 100).toFixed(2)} to ₹${newTotalStr}. Please review and confirm the updated total to continue.`
          : (errData?.message || "Cart totals have updated. Please review and confirm before placing your order."));
      } else if (errData?.code === "ADDRESS_PRICING_FAILED") {
        setError(errData?.message || "Unable to calculate pricing for the selected delivery address. Please tap Place Order to retry.");
        isSubmittingRef.current = false;
        setLoading(false);
        setPaymentStep("");
        return;
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
    unconfirmedQuote?.actual_total_paise !== undefined
      ? Number(unconfirmedQuote.actual_total_paise) / 100
      : totalAmount !== undefined && totalAmount !== null
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

  const isManualClosed = storeHours?.manual_override === "closed";
  const isAfterHours = Boolean(
    storeHours &&
    (storeHours.is_after_hours || (storeHours.is_open === false && !isManualClosed))
  );
  const hasScheduledOpening = Boolean(
    storeHours?.next_opening?.day && storeHours?.next_opening?.time && storeHours?.next_opening?.date
  );
  const isStoreClosed = isManualClosed || (isAfterHours && !hasScheduledOpening);
  const pending = getPendingPayment(user?.id || checkoutExpiredUserId);
  // Old releases stored pending payments without an owner. Preserve the
  // reference and do not start another payment until staff can verify it.
  const unownedPending = Boolean(user?.id && getPendingPayment()?.razorpay_order_id);
  const hasActivePendingPayment = Boolean(
    pending?.razorpay_order_id
  );
  const requiresSignIn = !isAuthenticated || addressSignInRequired;
  const checkoutAction = unownedPending ? "legacy_payment"
    : hasActivePendingPayment
    ? (requiresSignIn || sessionExpiredPending ? "payment_signin" : "payment_status")
    : unconfirmedQuote
    ? "confirm_quote"
    : authLoading || isReconnecting ? "auth_loading"
    : requiresSignIn ? "signin"
    : loadingAddresses ? "loading_addresses"
    : addressLoadFailed ? "retry_addresses"
    : addresses.length === 0 ? "add_address"
    : hasOutOfStock ? "review_cart"
    : isBelowMin || isStoreClosed ? "keep_shopping"
    : "checkout";
  const isDisabled = loading || cancellingPending || checkoutAction === "loading_addresses" || checkoutAction === "auth_loading" ||
    (checkoutAction === "checkout" && !selectedAddress) ||
    (checkoutAction === "confirm_quote" && !selectedAddress) ||
    (checkoutAction === "payment_status" && checkingPendingStatus);
  const handlePrimaryAction = () => {
    if (checkoutAction === "payment_signin" || checkoutAction === "signin") {
      navigate("/login", { state: { from: "/cart" } });
    } else if (checkoutAction === "confirm_quote") {
      setUnconfirmedQuote(null);
      setError("");
      handlePlaceOrder();
    } else if (checkoutAction === "payment_status") {
      verifyPendingOrder(true);
    } else if (checkoutAction === "legacy_payment") {
      setError("An earlier payment needs verification. Please don’t pay again; contact the store for help.");
    } else if (checkoutAction === "retry_addresses") {
      setAddressRetry((value) => value + 1);
    } else if (checkoutAction === "review_cart") {
      const item = document.querySelector('[data-stock-issue="true"]');
      item?.scrollIntoView({ behavior: "smooth", block: "center" });
      item?.focus({ preventScroll: true });
    } else if (checkoutAction === "keep_shopping") {
      navigate("/");
    } else {
      handlePlaceOrder();
    }
  };

  if (loadingAddresses && !standaloneBar) {
    return (
      <div className="flex min-h-[160px] items-center justify-center rounded-[22px] border border-[#E2E8F0] bg-[#FFFFFF] p-6 shadow-[0_4px_24px_rgba(0,0,0,0.3)]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#22499F]/20 border-t-[#22499F]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {addressSignInRequired && (
        <div className="rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] px-3.5 py-2.5 text-xs text-[#22499F]">
          Please sign in again to continue with this cart.
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
            onClick={() => navigate("/login", { state: { from: "/cart" } })}
            className="rounded-lg bg-[#22499F] px-3 py-1 font-bold text-[#FFFFFF] hover:bg-[#1B3B82] hover:text-[#FFFFFF] cursor-pointer"
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
                  disabled={checkingPendingStatus || cancellingPending}
                  className="rounded-xl bg-[#22499F] px-3.5 py-1.5 font-bold text-[#FFFFFF] shadow-xs hover:bg-[#1B3B82] hover:text-[#FFFFFF] active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {checkingPendingStatus ? "Checking..." : "Check Payment Status"}
                </button>
                <button
                  type="button"
                  onClick={handleCancelUnpaidCheckout}
                  disabled={cancellingPending || checkingPendingStatus}
                  className="rounded-xl border border-rose-800/60 bg-rose-950/50 px-3.5 py-1.5 font-bold text-rose-300 hover:bg-rose-900/60 active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {cancellingPending ? "Cancelling..." : "Cancel unpaid checkout"}
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
          <div className="rounded-[22px] border border-[#E2E8F0]/80 bg-[#FFFFFF] p-4 sm:p-5 shadow-[0_8px_30px_rgba(0,0,0,0.2)]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0]/70 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0]">
                  <MapPin size={16} strokeWidth={2.2} />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-extrabold text-[#1E293B]">
                    Delivery Address
                  </h2>
                  <p className="text-[11px] font-medium text-[#64748B]">
                    Where your order will be delivered
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (addresses.length === 0) {
                    navigate("/account/addresses", { state: { from: "/cart", selectNew: true } });
                  } else {
                    setShowAddressModal(true);
                  }
                }}
                disabled={loading}
                className="flex items-center gap-1 text-xs font-bold text-[#22499F] hover:underline cursor-pointer disabled:opacity-50"
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
              <div className="mt-3 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#F0F8E8] p-4 text-center">
                <p className="text-xs font-bold text-[#1E293B]">No saved address found</p>
                <p className="mt-0.5 text-[11px] text-[#64748B] font-medium">Please add a delivery address to proceed.</p>
                <button
                  type="button"
                  onClick={() => navigate("/account/addresses", { state: { from: "/cart", selectNew: true } })}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-[#22499F] px-3.5 py-1.5 text-xs font-black text-[#FFFFFF] shadow-xs hover:bg-[#1B3B82] hover:text-[#FFFFFF] active:scale-95 transition cursor-pointer"
                >
                  <Plus size={13} />
                  <span>Add Address</span>
                </button>
              </div>
            ) : selectedAddress ? (
              <div
                onClick={() => !loading && setShowAddressModal(true)}
                className="mt-3 flex items-start gap-3 rounded-2xl border border-[#E2E8F0] bg-[#F0F8E8] p-3 sm:p-3.5 hover:border-[#22499F]/60 transition cursor-pointer"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0] shadow-xs">
                  {selectedAddress.type === "office" || selectedAddress.type === "work" ? (
                    <Building2 size={16} />
                  ) : (
                    <Home size={16} />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs sm:text-sm font-extrabold text-[#1E293B] truncate">
                      {selectedAddress.first_name || ""} {selectedAddress.last_name || ""}
                    </span>
                    <span className="rounded-full bg-[#FFFFFF] px-2 py-0.5 text-[9px] font-extrabold uppercase text-[#22499F] border border-[#E2E8F0]">
                      {selectedAddress.type ? selectedAddress.type.toUpperCase() : "HOME"}
                    </span>
                  </div>

                  <p className="mt-1 text-xs font-medium text-[#64748B] line-clamp-2">
                    {selectedAddress.address_line1 || ""}
                    {selectedAddress.address_line2 ? `, ${selectedAddress.address_line2}` : ""}
                    , {selectedAddress.city || ""}, {selectedAddress.state || "MH"}
                    {selectedAddress.pincode ? ` - ${selectedAddress.pincode}` : ""}
                  </p>

                  {selectedAddress.phone && (
                    <p className="mt-1 text-xs font-semibold text-[#22499F]">
                      📞 {selectedAddress.phone}
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {/* Payment Method Card (Compact) */}
          <div className="rounded-[22px] border border-[#E2E8F0]/80 bg-[#FFFFFF] p-4 sm:p-5 shadow-[0_8px_30px_rgba(0,0,0,0.2)]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0]/70 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0]">
                  <CreditCard size={16} strokeWidth={2.2} />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-extrabold text-[#1E293B]">
                    Payment Method
                  </h2>
                  <p className="text-[11px] font-medium text-[#64748B]">
                    Pay securely online
                  </p>
                </div>
              </div>
            </div>

            <div
              className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-[#E2E8F0] bg-[#F0F8E8] p-3 sm:p-3.5"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0] shadow-xs">
                  <CreditCard size={18} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-extrabold text-[#1E293B]">
                    Pay Online
                  </h4>
                  <p className="text-[11px] font-medium text-[#64748B] truncate">
                    UPI, Cards, NetBanking, Wallets
                  </p>
                </div>
              </div>


            </div>
          </div>
        </>
      )}

      {/* Checkout policy notice */}
      <p className="mt-3 flex flex-wrap items-center justify-center gap-x-1 text-center text-[11px] font-medium leading-5 text-[#64748B]">
        <span>By placing your order, you agree to our</span>
        <a href="/terms" target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-semibold text-[#22499F] hover:underline">
          Terms and Conditions
        </a>
        <span aria-hidden="true">·</span>
        <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-semibold text-[#22499F] hover:underline">
          Privacy Policy
        </a>
        <span aria-hidden="true">·</span>
        <a href="/shipping-policy" target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-semibold text-[#22499F] hover:underline">
          Shipping Policy
        </a>
        <span aria-hidden="true">·</span>
        <a href="/return-policy" target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-semibold text-[#22499F] hover:underline">
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
      {addressLoadFailed && (
        <div role="alert" className="mx-auto my-3 max-w-[700px] rounded-xl border border-amber-600 bg-[#FFFFFF] p-3 text-sm text-amber-200">
          Unable to load delivery addresses. <button type="button" className="font-bold underline" onClick={() => setAddressRetry((count) => count + 1)}>Retry</button>
        </div>
      )}
      {showAddressModal && (
        <div
          onClick={() => setShowAddressModal(false)}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-[520px] max-h-[85vh] flex-col rounded-t-[28px] sm:rounded-[24px] bg-[#FFFFFF] border border-[#E2E8F0] p-5 sm:p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[#E2E8F0]/70 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-[#1E293B]">
                  Select Delivery Address
                </h3>
                <p className="text-xs font-medium text-[#64748B]">
                  Where should we send your order?
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddressModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#64748B] hover:bg-[#FFFFFF] hover:text-white transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-3.5 space-y-2.5 overflow-y-auto pr-1 flex-1 max-h-[50vh]">
              {addresses.map((addr) => {
                const isSelected = String(selectedAddressId) === String(addr.id);
                const isHome = addr.type === "home";

                return (
                  <div
                    key={addr.id}
                    onClick={() => {
                      const addrIdStr = String(addr.id);
                      setSelectedAddressId(addrIdStr);
                      if (user?.id) safeStorage.setItem(`selected_address_id_${user.id}`, addrIdStr);
                      safeStorage.setItem("selected_address_id", addrIdStr);
                      setShowAddressModal(false);
                    }}
                    className={`flex items-start gap-3 rounded-2xl border p-3.5 transition-all cursor-pointer ${
                      isSelected
                        ? "border-[#22499F] bg-[#FFFFFF]/70 ring-2 ring-[#22499F]/20 shadow-xs"
                        : "border-[#E2E8F0] bg-[#F0F8E8] hover:border-[#22499F]/50"
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
                        isSelected
                          ? "bg-[#FFFFFF] text-[#22499F] border-[#22499F]/50"
                          : "bg-[#FFFFFF] text-[#64748B] border-[#E2E8F0]"
                      }`}
                    >
                      {isHome ? <Home size={15} /> : <Building2 size={15} />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs sm:text-sm font-extrabold text-[#1E293B] truncate">
                          {addr.first_name || ""} {addr.last_name || ""}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide border ${
                            isSelected
                              ? "bg-[#FFFFFF] text-[#22499F] border-[#E2E8F0]"
                              : "bg-[#FFFFFF] text-[#64748B] border-[#E2E8F0]"
                          }`}
                        >
                          {addr.type ? addr.type.toUpperCase() : "HOME"}
                        </span>
                      </div>

                      <p className="mt-1 text-xs font-medium text-[#64748B] line-clamp-2">
                        {addr.address_line1 || ""}
                        {addr.address_line2 ? `, ${addr.address_line2}` : ""}
                        , {addr.city || ""}, {addr.state || "MH"}
                        {addr.pincode ? ` - ${addr.pincode}` : ""}
                      </p>

                      {addr.phone && (
                        <p className="mt-1 text-xs font-semibold text-[#22499F]">
                          📞 {addr.phone}
                        </p>
                      )}
                    </div>

                    {isSelected && (
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#22499F] text-[#FFFFFF] self-center">
                        <Check size={12} strokeWidth={3} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 pt-3 border-t border-[#E2E8F0]/70">
              <button
                type="button"
                onClick={() => {
                  setShowAddressModal(false);
                  navigate("/account/addresses", { state: { from: "/cart", selectNew: true } });
                }}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#22499F]/40 bg-[#FFFFFF]/30 py-3 text-xs font-extrabold text-[#22499F] hover:bg-[#FFFFFF]/50 active:scale-[0.99] transition cursor-pointer"
              >
                <Plus size={15} />
                <span>Add New Address</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky Quick-Commerce Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#F0F8E8]/95 backdrop-blur-md border-t border-[#E2E8F0] rounded-t-[24px] sm:rounded-t-[28px] shadow-[0_-8px_25px_rgba(0,0,0,0.5)] transform-gpu will-change-transform">
        <div className="mx-auto w-full max-w-[700px] px-3.5 sm:px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {/* Subtle Pull Indicator Pill */}
          <div className="mx-auto w-9 h-1 rounded-full bg-[#E2E8F0] mb-2 opacity-80" />

          {/* Row 1: Unified Address Capsule */}
          <div className="flex items-center justify-between gap-2.5 rounded-2xl bg-[#FFFFFF] border border-[#E2E8F0]/80 px-2.5 py-2 sm:py-2.5 mb-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.2)]">
            {loadingAddresses && !selectedAddress ? (
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="flex h-8 w-8 sm:h-8.5 sm:w-8.5 shrink-0 items-center justify-center rounded-xl bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0] shadow-xs">
                    <Home size={16} strokeWidth={2.4} className="animate-pulse" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-3 w-24 bg-[#E2E8F0] rounded animate-pulse" />
                    <div className="h-2.5 w-40 bg-[#FFFFFF] rounded animate-pulse" />
                  </div>
                </div>
                <div className="h-7 w-14 bg-[#FFFFFF] rounded-xl animate-pulse shrink-0" />
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (requiresSignIn) {
                      navigate("/login", { state: { from: "/cart" } });
                    } else if (addressLoadFailed) {
                      setAddressRetry((value) => value + 1);
                    } else if (addresses.length === 0) {
                      navigate("/account/addresses", { state: { from: "/cart", selectNew: true } });
                    } else {
                      setShowAddressModal(true);
                    }
                  }}
                  className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer hover:opacity-85 transition-opacity select-none"
                >
                  <div className="flex h-8 w-8 sm:h-8.5 sm:w-8.5 shrink-0 items-center justify-center rounded-xl bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0] shadow-xs">
                    {selectedAddress?.type === "office" || selectedAddress?.type === "work" ? (
                      <Building2 size={16} strokeWidth={2.4} />
                    ) : (
                      <Home size={16} strokeWidth={2.4} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 leading-tight">
                      <span className="font-black text-xs sm:text-[13px] text-[#1E293B] tracking-tight">
                        {requiresSignIn
                          ? "Sign in to continue"
                          : addressLoadFailed ? "Address unavailable"
                          : selectedAddress
                          ? `Delivering to ${selectedAddress.type ? (selectedAddress.type.charAt(0).toUpperCase() + selectedAddress.type.slice(1)) : "Home"}`
                          : "No delivery address"}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-[#64748B] truncate leading-tight mt-0.5">
                      {requiresSignIn
                        ? "Sign in to select a delivery address"
                        : addressLoadFailed ? "We couldn’t load your saved addresses."
                        : selectedAddress
                        ? `${selectedAddress.address_line1 || ""}${selectedAddress.city ? `, ${selectedAddress.city}` : ""}${selectedAddress.pincode ? ` - ${selectedAddress.pincode}` : ""}`
                        : "Click to add your delivery address"}
                    </p>
                  </div>
                </button>

                {!requiresSignIn && <button
                  type="button"
                  onClick={() => {
                    if (requiresSignIn) {
                      navigate("/login", { state: { from: "/cart" } });
                    } else if (addressLoadFailed) {
                      setAddressRetry((value) => value + 1);
                    } else if (addresses.length === 0) {
                      navigate("/account/addresses", { state: { from: "/cart", selectNew: true } });
                    } else {
                      setShowAddressModal(true);
                    }
                  }}
                  className="shrink-0 text-[11px] sm:text-xs font-black text-[#22499F] bg-[#FFFFFF] border border-[#E2E8F0] hover:bg-[#22499F] hover:text-[#FFFFFF] px-3 py-1.5 rounded-xl shadow-xs active:scale-95 transition-all cursor-pointer"
                >
                  {addressLoadFailed ? "Try again"
                    : addresses.length === 0
                    ? "+ Add"
                    : "Change"}
                </button>}
              </>
            )}
          </div>

          {/* Row 2: Main Action Button */}
          <div className="w-full">
            {hasActivePendingPayment && (
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <span className="pending-checkout-label text-[11.5px] font-semibold truncate">
                  Unpaid checkout attempt in progress
                </span>
                <button
                  type="button"
                  onClick={handleCancelUnpaidCheckout}
                  disabled={cancellingPending}
                  className="pending-checkout-cancel text-[11.5px] font-bold underline underline-offset-2 cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {cancellingPending ? "Cancelling..." : "Cancel unpaid checkout"}
                </button>
              </div>
            )}
            {isAfterHours && (
              <div className="mb-2 flex items-center justify-center gap-1.5 text-center text-[11px] font-bold text-[#22499F]">
                <span>
                  {hasScheduledOpening
                    ? `🌙 Fulfillment starts ${storeHours.next_opening.label}. Delivery follows preparation.`
                    : "The store has no upcoming opening slot and is not accepting orders."}
                </span>
              </div>
            )}
            {/* Row 2: Two Separate Pills (Price Pill + Place Order Pill) */}
            <div className="flex items-center gap-2.5 sm:gap-3 w-full">
              {/* Pill 1: Price Pill */}
              <div className="flex flex-col items-center justify-center h-[50px] sm:h-[52px] min-w-[125px] sm:min-w-[140px] px-5 sm:px-6 rounded-full bg-[#FFFFFF] border border-[#E2E8F0]/80 shadow-[0_1px_3px_rgba(0,0,0,0.2)] select-none shrink-0 gap-0.5">
                <span className="text-[9px] sm:text-[9.5px] font-extrabold uppercase tracking-[0.14em] text-[#64748B] leading-none">
                  TOTAL
                </span>
                <div className="flex items-baseline gap-0.5 leading-none">
                  <span className="text-[14px] sm:text-[16px] font-black text-[#22499F] leading-none">₹</span>
                  <span className="text-[19px] sm:text-[21px] font-black text-[#1E293B] tracking-tight leading-none">
                    {Number(finalTotal).toLocaleString("en-IN")}
                  </span>
                </div>
              </div>

              {/* Pill 2: Main Action Button (Place Order Pill - sleek pill shape) */}
              <button
                type="button"
                onClick={handlePrimaryAction}
                disabled={isDisabled}
                className={`store-primary-action group flex-1 flex items-center justify-center gap-2 h-[50px] sm:h-[52px] px-4 sm:px-5 rounded-full font-black text-[13.5px] sm:text-[14.5px] transition-all shadow-[0_6px_20px_rgba(66, 214, 232,0.28)] active:scale-[0.98] ${
                  loading
                    ? "bg-[#0B1728] text-white border border-[#22499F]/40 shadow-[0_0_24px_rgba(66, 214, 232,0.25)] cursor-wait"
                    : isDisabled
                    ? "bg-[#FFFFFF] text-[#64748B] border border-[#E2E8F0] shadow-none cursor-not-allowed opacity-80"
                    : "bg-gradient-to-r from-[#22499F] to-[#1B3B82] text-[#FFFFFF] hover:from-[#1B3B82] hover:to-[#1B3B82] hover:text-[#FFFFFF] cursor-pointer"
                }`}
              >
                {loading ? (
                  <>
                    <svg
                      className="h-4.5 w-4.5 sm:h-5 sm:w-5 animate-spin text-[#22499F] shrink-0"
                      style={{ animation: "spin 0.85s linear infinite" }}
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden="true"
                    >
                      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="1.0" />
                      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.92" transform="rotate(30 12 12)" />
                      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.84" transform="rotate(60 12 12)" />
                      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.75" transform="rotate(90 12 12)" />
                      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.67" transform="rotate(120 12 12)" />
                      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.58" transform="rotate(150 12 12)" />
                      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.5" transform="rotate(180 12 12)" />
                      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.42" transform="rotate(210 12 12)" />
                      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.33" transform="rotate(240 12 12)" />
                      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.25" transform="rotate(270 12 12)" />
                      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.17" transform="rotate(300 12 12)" />
                      <rect x="11" y="1.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.1" transform="rotate(330 12 12)" />
                    </svg>
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
                ) : checkoutAction === "auth_loading" ? (
                  <span>Checking account…</span>
                ) : checkoutAction === "legacy_payment" ? (
                  <span>Payment needs review</span>
                ) : checkoutAction === "payment_signin" ? (
                  <span>Sign in to check payment</span>
                ) : checkoutAction === "payment_status" ? (
                  <span>Check payment status</span>
                ) : checkoutAction === "retry_addresses" ? (
                  <span>Try again</span>
                ) : checkoutAction === "review_cart" ? (
                  <span>Review cart</span>
                ) : checkoutAction === "keep_shopping" ? (
                  <span>Keep shopping</span>
                ) : checkoutAction === "confirm_quote" ? (
                  <>
                    <span className="truncate">Confirm ₹{Number(finalTotal).toLocaleString("en-IN")} & Place Order</span>
                    <ChevronRight size={17} strokeWidth={2.8} className="shrink-0" />
                  </>
                ) : checkoutAction === "signin" ? (
                  <>
                    <span className="truncate">Sign in to continue</span>
                    <ChevronRight size={17} strokeWidth={2.8} className="shrink-0" />
                  </>
                ) : addresses.length === 0 ? (
                  <>
                    <span className="truncate">Add Address</span>
                    <ChevronRight size={17} strokeWidth={2.8} className="shrink-0" />
                  </>
                ) : (
                  <>
                    <span className="truncate">Place Order</span>
                    <ChevronRight size={17} strokeWidth={2.8} className="shrink-0" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BillingForm;
