import { useEffect, useState, useRef, useCallback } from "react";
import axios from "axios";
import { updateCheckout } from "../../services/storeApi";
import { createPaymentOrder, verifyPayment } from "../../services/paymentService.js";
import { getOrderById } from "../../services/orderService.js";
import { useNavigate } from "react-router-dom";
import API_URL from "../../config/api.js";
import safeStorage from "../../utils/safeStorage.js";
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

  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isSubmittingRef = useRef(false);
  const pendingOrderIdRef = useRef(getPendingPayment()?.order_id || null);
  const idempotencyKeyRef = useRef(getOrCreateCheckoutIdempotencyKey(cart));

  const verifyPendingOrder = useCallback(async () => {
    const stored = getPendingPayment();
    if (!stored || !stored.order_id) return;

    const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
    if (Date.now() - (stored.timestamp || 0) > MAX_AGE_MS) {
      clearPendingPayment();
      return;
    }

    const currentFingerprint = computeCartFingerprint(cart);
    const currentItemsFingerprint = computeCartItemsFingerprint(cart);
    const itemsChanged = stored.itemsFingerprint
      ? stored.itemsFingerprint !== currentItemsFingerprint
      : stored.cartFingerprint && stored.cartFingerprint !== currentFingerprint;

    if (itemsChanged) {
      clearPendingPayment();
      pendingOrderIdRef.current = null;
      return;
    }

    try {
      const res = await getOrderById(stored.order_id);
      const orderData = res?.order || res;
      const status = (orderData?.status || "").toLowerCase();

      // If order was already paid (processing, completed)
      if (status === "processing" || status === "completed") {
        clearPendingPayment();
        clearCheckoutIdempotencyKey();
        pendingOrderIdRef.current = null;
        await refreshCart().catch(() => {});
        navigate(`/order-success/${stored.order_id}`, {
          state: { paymentMethod: "Online Payment", status: "Processing" },
          replace: true,
        });
        return;
      }

      if (status === "pending" || status === "on-hold") {
        // Order is still pending, reuse order_id so retry doesn't duplicate
        pendingOrderIdRef.current = stored.order_id;
      } else {
        clearPendingPayment();
        pendingOrderIdRef.current = null;
      }
    } catch (err) {
      // If order query fails, keep pendingOrderIdRef if still fresh
      if (stored.order_id) {
        pendingOrderIdRef.current = stored.order_id;
      }
    }
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
      pendingOrderIdRef.current = null;
    }
  }, [cart]);

  // Check pending order status on mount and when returning from mobile UPI/banking app
  useEffect(() => {
    if (cart && cart.items && cart.items.length > 0) {
      verifyPendingOrder();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        verifyPendingOrder();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [cart, verifyPendingOrder]);

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

      const userPhone =
        (selectedAddress.phone || "").replace(/\D/g, "") || "9999999999";
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
        pendingOrderIdRef.current = null;

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
        ...(pendingOrderIdRef.current ? { order_id: pendingOrderIdRef.current } : {}),
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
          pendingOrderIdRef.current = null;
          await refreshCart().catch(() => {});
          navigate(`/order-success/${orderRes.order_id}`, {
            state: { paymentMethod: "Online Payment", status: orderRes.status || "Processing" },
          });
          isSubmittingRef.current = false;
          setLoading(false);
          setPaymentStep("");
          return;
        }
        throw new Error("Invalid payment order response from server.");
      }

      // Store pending order ID so user can retry payment without creating duplicate WC orders
      pendingOrderIdRef.current = orderRes.order_id;
      setPendingPayment({
        order_id: orderRes.order_id,
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
        description: `Order #${orderRes.order_id}`,
        order_id: orderRes.razorpay_order_id,
        prefill: {
          name: `${firstName} ${lastName}`.trim(),
          email: userEmail,
          contact: userPhone,
        },
        notes: {
          wc_order_id: String(orderRes.order_id),
        },
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
              if (orderRes.order_id) {
                const checkRes = await getOrderById(orderRes.order_id);
                const orderData = checkRes?.order || checkRes;
                const status = (orderData?.status || "").toLowerCase();
                if (status === "processing" || status === "completed") {
                  clearPendingPayment();
                  clearCheckoutIdempotencyKey();
                  pendingOrderIdRef.current = null;
                  await refreshCart().catch(() => {});
                  navigate(`/order-success/${orderRes.order_id}`, {
                    state: { paymentMethod: "Online Payment", status: "Processing" },
                  });
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
              order_id: orderRes.order_id,
              razorpay_order_id: paymentResponse.razorpay_order_id,
              razorpay_payment_id: paymentResponse.razorpay_payment_id,
              razorpay_signature: paymentResponse.razorpay_signature,
            });

            if (verifyRes.success) {
              clearCheckoutIdempotencyKey();
              clearPendingPayment();
              pendingOrderIdRef.current = null;
              await refreshCart().catch(() => {});
              navigate(`/order-success/${orderRes.order_id}`, {
                state: { paymentMethod: "Online Payment", status: "Processing" },
              });
            } else {
              setError(verifyRes.message || "Payment verification failed. Please contact support.");
            }
          } catch (verifyErr) {
            setError(
              verifyErr.response?.data?.message ||
              "Payment verification could not be completed. Please check your order history or contact support."
            );
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
        errData?.code === "INSUFFICIENT_STOCK" ||
        errData?.code === "woocommerce_rest_cart_item_out_of_stock"
      ) {
        clearCheckoutIdempotencyKey();
        idempotencyKeyRef.current = generateUUID();
        await refreshCart().catch(() => {});
        setError(
          errData?.message ||
            "Some items in your cart are no longer available in the requested quantity.",
        );
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
        <div className="flex items-center gap-2 text-[14px] font-medium text-[#666666]">
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

        <p className="mt-1.5 text-[14px] text-[#666666]">
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

            <p className="mt-1 text-[13px] text-[#666666]">
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
                          : "bg-[#F5F5F5] text-[#666666]"
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

                      <div className="mt-1 text-[13px] text-[#666666]">
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
              <div className="mt-0.5 text-[12px] text-[#666666]">
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
              <div className="flex items-center gap-1.5 text-[14px] font-bold text-[#1E1E1E]">
                <span>Pay Online</span>
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-extrabold text-emerald-700">
                  FAST
                </span>
              </div>
              <div className="mt-0.5 text-[12px] text-[#666666]">
                UPI, Cards, NetBanking, Wallets
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Place Order / Pay */}
      {(() => {
        const isStoreClosed = storeHours && storeHours.is_open === false;
        const isDisabled = loading || addresses.length === 0 || !selectedAddress || isStoreClosed;

        return (
          <button
            type="button"
            onClick={handlePlaceOrder}
            disabled={isDisabled}
            className={`flex h-[54px] w-full shrink-0 items-center justify-center gap-2 rounded-[17px] text-[15px] font-bold whitespace-nowrap transition-colors ${
              isStoreClosed
                ? "bg-amber-600 text-white shadow-none cursor-not-allowed opacity-90"
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
                    : paymentStep === "verifying"
                    ? "Verifying payment..."
                    : "Processing..."}
                </span>
              </>
            ) : isStoreClosed ? (
              "Store is Currently Closed for Orders"
            ) : paymentMethod === "online" ? (
              pendingOrderIdRef.current ? (
                "Retry Online Payment →"
              ) : (
                "Pay Online securely →"
              )
            ) : (
              "Place Order securely →"
            )}
          </button>
        );
      })()}
    </div>
  );
}

export default BillingForm;
