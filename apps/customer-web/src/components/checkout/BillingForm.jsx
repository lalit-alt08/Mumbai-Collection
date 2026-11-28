import { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import safeStorage from "../../utils/safeStorage.js";
import StockNotificationModal from "./StockNotificationModal";
import { CheckoutPendingBanner } from "./CheckoutPendingBanner";
import { DeliveryAddressCard } from "./DeliveryAddressCard";
import { PaymentMethodCard } from "./PaymentMethodCard";
import { AddressSelectionModal } from "./AddressSelectionModal";
import { CheckoutBottomBar } from "./CheckoutBottomBar";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { buildCheckoutAddresses } from "../../utils/checkoutAddressBuilder.js";
import {
  buildAddressPricingSyncKey,
  isCartAddressPriced,
  syncCartAddressPricing,
} from "../../utils/checkoutAddressPricing.js";
import { updateCartCustomer } from "../../services/storeApi.js";
import { usePendingPayment } from "./usePendingPayment.js";
import { createRazorpayHandler } from "./useRazorpayCheckout.js";
import { useCheckoutAddresses } from "./useCheckoutAddresses.js";
import { useStockAlert } from "./useStockAlert.js";

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

function BillingForm({
  storeHours,
  onStoreClosed,
  totalAmount,
  standaloneBar = false,
  hasOutOfStock = false,
  minOrderValue = 1,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    user,
    isAuthenticated,
    handleSessionExpired,
    checkoutExpiredUserId,
    loading: authLoading,
    isReconnecting,
  } = useAuth();
  const { cart, refreshCart, updateCart } = useCart();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [paymentStep, setPaymentStep] = useState("");
  const [showAddressModal, setShowAddressModal] = useState(false);
  const [unconfirmedQuote, setUnconfirmedQuote] = useState(null);
  const [syncingAddressPricing, setSyncingAddressPricing] = useState(false);

  const isSubmittingRef = useRef(false);
  const pricedAddressKeyRef = useRef("");
  const autoSyncAttemptedKeyRef = useRef("");
  const idempotencyKeyRef = useRef(getOrCreateCheckoutIdempotencyKey(cart, user?.id));
  const activeOrderRef = useRef(null);
  const activeUserRef = useRef(user?.id);
  activeUserRef.current = user?.id;

  // 1. Manage saved addresses, selection, and cache
  const {
    addresses,
    selectedAddressId,
    setSelectedAddressId,
    selectedAddress,
    loadingAddresses,
    addressLoadFailed,
    setAddressRetry,
    addressSignInRequired,
    setAddressSignInRequired,
  } = useCheckoutAddresses({
    user,
    isAuthenticated,
    handleSessionExpired,
    locationState: location.state,
    setError,
  });

  // 2. Pending payment verification & polling
  const {
    isPersistentPending,
    setIsPersistentPending,
    checkingPendingStatus,
    cancellingPending,
    sessionExpiredPending,
    pendingStatusFeedback,
    canCancelPending,
    isPaymentUnpaid,
    isConfirmingOrder,
    isRefundPending,
    verifyPendingOrder,
    handleRetryPayment,
    handleCancelUnpaidCheckout,
    pollTimerRef,
  } = usePendingPayment({
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
  });

  // 3. Stock alert & shortages resolution
  const {
    stockAlertOpen,
    setStockAlertOpen,
    stockAlertItems,
    setStockAlertItems,
    removingStockItems,
    handleRemoveUnavailableAndContinue,
    handleReturnToCart,
  } = useStockAlert({ cart, refreshCart, setError, navigate });

  // Clear unconfirmed quote on cart items or address change
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

  // Sync the selected delivery address to WooCommerce cart upfront so delivery
  // charges and grand total are accurate before tapping Place Order (allowing
  // Razorpay to open directly on the first tap without a CHECKOUT_TOTAL_CHANGED detour).
  const hasCartItems = Boolean(cart?.items?.length > 0);
  const cartItemsKey = computeCartItemsFingerprint(cart);
  useEffect(() => {
    if (!isAuthenticated || !user?.id || !hasCartItems) {
      pricedAddressKeyRef.current = "";
      autoSyncAttemptedKeyRef.current = "";
      setSyncingAddressPricing(false);
      return;
    }
    if (!selectedAddress || isSubmittingRef.current) return;

    const addressResult = buildCheckoutAddresses(selectedAddress, user);
    if (addressResult.error) return;
    const { billingAddress, shippingAddress } = addressResult;

    const syncKey = buildAddressPricingSyncKey(user.id, selectedAddress, shippingAddress);
    const attemptKey = `${syncKey}|${cartItemsKey}`;

    if (isCartAddressPriced(cart, shippingAddress)) {
      pricedAddressKeyRef.current = syncKey;
      autoSyncAttemptedKeyRef.current = attemptKey;
      return;
    }
    if (pricedAddressKeyRef.current === syncKey) {
      // Cart no longer matches the selected address or lost its selected rate; allow re-sync.
      pricedAddressKeyRef.current = "";
    }
    if (autoSyncAttemptedKeyRef.current === attemptKey) {
      return;
    }

    let cancelled = false;
    let settled = false;
    autoSyncAttemptedKeyRef.current = attemptKey;
    setSyncingAddressPricing(true);

    syncCartAddressPricing({
      cart,
      billingAddress,
      shippingAddress,
      updateCartCustomerFn: updateCartCustomer,
      updateCartFn: updateCart,
      isStillCurrent: () => !cancelled && activeUserRef.current === user.id,
    })
      .then((result) => {
        if (cancelled || activeUserRef.current !== user.id) return;
        settled = true;
        if (result.status === "priced") {
          pricedAddressKeyRef.current = syncKey;
        }
        // On "unpriced", leave pricedAddressKeyRef empty so Place Order retries pricing.
      })
      .catch(() => {
        // Leave pricedAddressKeyRef empty so Place Order retries pricing cleanly.
        settled = true;
      })
      .finally(() => {
        if (!cancelled) {
          setSyncingAddressPricing(false);
        }
      });

    return () => {
      cancelled = true;
      if (!settled && autoSyncAttemptedKeyRef.current === attemptKey) {
        autoSyncAttemptedKeyRef.current = "";
      }
      setSyncingAddressPricing(false);
    };
  }, [
    isAuthenticated,
    user,
    selectedAddress,
    hasCartItems,
    cartItemsKey,
    cart,
    updateCart,
  ]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setShowAddressModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    idempotencyKeyRef.current = getOrCreateCheckoutIdempotencyKey(cart, user?.id);
  }, [cart, user?.id]);

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
        0
      ) / 100;

  const handlePlaceOrder = async () => {
    if (isSubmittingRef.current) return;

    if (!isAuthenticated || addressSignInRequired) {
      navigate("/login", { state: { from: "/cart" } });
      return;
    }

    if (loadingAddresses) return;
    if (addressLoadFailed) {
      setAddressRetry((value) => value + 1);
      return;
    }

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

    const isManualClosed = storeHours?.manual_override === "closed";
    if (isManualClosed) {
      const msg = storeHours?.closed_message || "We are currently closed for new orders.";
      const resumeTime = storeHours?.next_opening?.label
        ? ` Ordering resumes ${storeHours.next_opening.label}.`
        : "";
      setError(`${msg}${resumeTime}`);
      return;
    }

    if (itemsSubtotal < minOrderValue) {
      return;
    }

    try {
      isSubmittingRef.current = true;
      setLoading(true);
      setError("");

      const addressResult = buildCheckoutAddresses(selectedAddress, user);
      if (addressResult.error) {
        setError(addressResult.error);
        isSubmittingRef.current = false;
        setLoading(false);
        return;
      }
      const { billingAddress, shippingAddress } = addressResult;
      const syncKey = buildAddressPricingSyncKey(user?.id, selectedAddress, shippingAddress);

      let effectiveCart = cart;
      let effectiveFinalTotal = finalTotal;

      // If the background pricing sync failed or never received a selected shipping rate,
      // retry once before creating the payment order.
      if (!isCartAddressPriced(cart, shippingAddress)) {
        try {
          setPaymentStep("preparing");
          const syncResult = await syncCartAddressPricing({
            cart,
            billingAddress,
            shippingAddress,
            updateCartCustomerFn: updateCartCustomer,
            updateCartFn: updateCart,
            isStillCurrent: () => activeUserRef.current === user?.id,
          });
          if (syncResult.status === "cancelled") {
            isSubmittingRef.current = false;
            setLoading(false);
            setPaymentStep("");
            return;
          }
          if (syncResult.status !== "priced") {
            setError(
              "Unable to calculate delivery pricing for your selected address. Please tap Place Order to retry."
            );
            isSubmittingRef.current = false;
            setLoading(false);
            setPaymentStep("");
            return;
          }
          pricedAddressKeyRef.current = syncKey;
          effectiveCart = syncResult.cart;
          effectiveFinalTotal = Number(syncResult.actualTotalPaise) / 100;

          if (syncResult.changedTotal) {
            setUnconfirmedQuote({
              expected_total_paise: syncResult.previousTotalPaise,
              actual_total_paise: syncResult.actualTotalPaise,
              itemsFingerprint: computeCartItemsFingerprint(effectiveCart),
              addressId: selectedAddressId,
            });
            setError(
              `Your cart total updated from ₹${(syncResult.previousTotalPaise / 100).toFixed(2)} to ₹${(
                syncResult.actualTotalPaise / 100
              ).toFixed(2)} after applying delivery charges. Please review and confirm to continue.`
            );
            isSubmittingRef.current = false;
            setLoading(false);
            setPaymentStep("");
            return;
          }
        } catch {
          setError(
            "Unable to calculate delivery pricing for your selected address. Please tap Place Order to retry."
          );
          isSubmittingRef.current = false;
          setLoading(false);
          setPaymentStep("");
          return;
        }
      }

      const startPayment = createRazorpayHandler({
        user,
        cart: effectiveCart,
        finalTotal: effectiveFinalTotal,
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
      });

      await startPayment();
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
            "Your account is currently suspended and you cannot place new orders."
        );
      } else if (errData?.code === "STORE_CLOSED") {
        const msg = errData?.message || "We are currently closed for new orders.";
        const resumeTime = errData?.next_opening?.label
          ? ` Ordering resumes ${errData.next_opening.label}.`
          : "";
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
          setError(
            errData?.message ||
              "Stock changed while you were checking out. Please review your cart before trying again."
          );
          isSubmittingRef.current = false;
          setLoading(false);
          setPaymentStep("");
          navigate("/cart");
          return;
        }

        setStockAlertItems(shortageDetails);
        setStockAlertOpen(true);
        setError("");
      } else if (
        errData?.code === "CHECKOUT_TOTAL_CHANGED" ||
        errData?.code === "woocommerce_rest_checkout_total_mismatch"
      ) {
        retireCheckoutIdempotencyKey(user?.id);
        idempotencyKeyRef.current = generateUUID();
        const authoritativeCart = errData.cart || null;
        const actualPaise =
          errData.actual_total_paise ||
          (authoritativeCart?.totals?.total_price
            ? Number(authoritativeCart.totals.total_price)
            : null);
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
        setError(
          errData?.code === "CHECKOUT_TOTAL_CHANGED"
            ? `Your cart total changed from ₹${(
                errData.expected_total_paise / 100
              ).toFixed(2)} to ₹${newTotalStr}. Please review and confirm the updated total to continue.`
            : errData?.message ||
                "Cart totals have updated. Please review and confirm before placing your order."
        );
      } else if (errData?.code === "ADDRESS_PRICING_FAILED") {
        setError(
          errData?.message ||
            "Unable to calculate pricing for the selected delivery address. Please tap Place Order to retry."
        );
        isSubmittingRef.current = false;
        setLoading(false);
        setPaymentStep("");
        return;
      } else if (isProcessingConflict) {
        setError(
          "Your order is currently being processed. Please wait a moment and check your order history before trying again."
        );
      } else if (errStatus === 409) {
        clearCheckoutIdempotencyKey();
        idempotencyKeyRef.current = generateUUID();
        await refreshCart().catch(() => {});
        setError(
          errData?.message ||
            "A checkout conflict occurred. Your cart has been updated, please try placing your order again."
        );
      } else if (
        errData?.code === "woocommerce_rest_min_order_value" ||
        errData?.code === "MIN_ORDER_VALUE"
      ) {
        setError(
          errData?.message || `Minimum product order value of ₹${minOrderValue} is required.`
        );
      } else {
        setError(
          errData?.message || error.message || "Failed to place order. Please try again."
        );
      }
      isSubmittingRef.current = false;
      setLoading(false);
      setPaymentStep("");
    }
  };

  const isBelowMin = itemsSubtotal < minOrderValue;
  useEffect(() => {
    if (/minimum.*order value|^add ₹/i.test(error)) {
      if (isBelowMin) {
        const currentShortfall = Math.max(0, minOrderValue - itemsSubtotal);
        setError(`Add ₹${currentShortfall} more to reach the minimum order value of ₹${minOrderValue}.`);
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
    storeHours?.next_opening?.day &&
      storeHours?.next_opening?.time &&
      storeHours?.next_opening?.date
  );
  const isStoreClosed = isManualClosed || (isAfterHours && !hasScheduledOpening);
  const pending = getPendingPayment(user?.id || checkoutExpiredUserId);
  const unownedPending = Boolean(user?.id && getPendingPayment()?.razorpay_order_id);
  const hasActivePendingPayment = Boolean(pending?.razorpay_order_id);
  const requiresSignIn = !isAuthenticated || addressSignInRequired;

  const checkoutAction = unownedPending
    ? "legacy_payment"
    : hasActivePendingPayment
    ? requiresSignIn || sessionExpiredPending
      ? "payment_signin"
      : isPaymentUnpaid
      ? "payment_retry"
      : "payment_status"
    : unconfirmedQuote
    ? "confirm_quote"
    : authLoading || isReconnecting
    ? "auth_loading"
    : requiresSignIn
    ? "signin"
    : loadingAddresses
    ? "loading_addresses"
    : addressLoadFailed
    ? "retry_addresses"
    : addresses.length === 0
    ? "add_address"
    : syncingAddressPricing
    ? "syncing_pricing"
    : hasOutOfStock
    ? "review_cart"
    : isBelowMin || isStoreClosed
    ? "keep_shopping"
    : "checkout";

  const isDisabled =
    loading ||
    cancellingPending ||
    checkoutAction === "loading_addresses" ||
    checkoutAction === "syncing_pricing" ||
    checkoutAction === "auth_loading" ||
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
    } else if (checkoutAction === "payment_retry") {
      handleRetryPayment(() => handlePlaceOrder());
    } else if (checkoutAction === "payment_status") {
      verifyPendingOrder(true);
    } else if (checkoutAction === "legacy_payment") {
      setError(
        "An earlier payment needs verification. Please don’t pay again; contact the store for help."
      );
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

      {error && (
        <div className="checkout-error-banner rounded-xl border px-3.5 py-2.5 text-xs font-bold shadow-xs">
          {error}
        </div>
      )}

      <CheckoutPendingBanner
        pendingPayment={pending}
        sessionExpiredPending={sessionExpiredPending}
        isPersistentPending={isPersistentPending}
        checkingPendingStatus={checkingPendingStatus}
        cancellingPending={cancellingPending}
        pendingStatusFeedback={pendingStatusFeedback}
        canCancelPending={canCancelPending}
        isPaymentUnpaid={isPaymentUnpaid}
        onRetryPayment={() => handleRetryPayment(() => handlePlaceOrder())}
        verifyPendingOrder={verifyPendingOrder}
        handleCancelUnpaidCheckout={handleCancelUnpaidCheckout}
        navigate={navigate}
      />

      {!standaloneBar && (
        <>
          <DeliveryAddressCard
            addresses={addresses}
            selectedAddress={selectedAddress}
            loading={loading}
            onOpenAddressModal={() => setShowAddressModal(true)}
            navigate={navigate}
          />
          <PaymentMethodCard />
        </>
      )}

      <p className="mt-3 flex flex-wrap items-center justify-center gap-x-1 text-center text-[11px] font-medium leading-5 text-[#64748B]">
        <span>By placing your order, you agree to our</span>
        <a
          href="/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap font-semibold text-[#22499F] hover:underline"
        >
          Terms and Conditions
        </a>
        <span aria-hidden="true">·</span>
        <a
          href="/privacy-policy"
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap font-semibold text-[#22499F] hover:underline"
        >
          Privacy Policy
        </a>
        <span aria-hidden="true">·</span>
        <a
          href="/shipping-policy"
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap font-semibold text-[#22499F] hover:underline"
        >
          Shipping Policy
        </a>
        <span aria-hidden="true">·</span>
        <a
          href="/return-policy"
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap font-semibold text-[#22499F] hover:underline"
        >
          Returns &amp; Refund Policy
        </a>
      </p>

      <StockNotificationModal
        isOpen={stockAlertOpen}
        onClose={() => setStockAlertOpen(false)}
        items={stockAlertItems}
        cartItems={cart?.items || []}
        onRemoveAndContinue={handleRemoveUnavailableAndContinue}
        onReturnToCart={handleReturnToCart}
        removing={removingStockItems}
      />

      {addressLoadFailed && (
        <div
          role="alert"
          className="mx-auto my-3 max-w-[700px] rounded-xl border border-amber-600 bg-[#FFFFFF] p-3 text-sm text-amber-200"
        >
          Unable to load delivery addresses.{" "}
          <button
            type="button"
            className="font-bold underline"
            onClick={() => setAddressRetry((count) => count + 1)}
          >
            Retry
          </button>
        </div>
      )}

      <AddressSelectionModal
        isOpen={showAddressModal}
        onClose={() => setShowAddressModal(false)}
        addresses={addresses}
        selectedAddressId={selectedAddressId}
        onSelectAddress={(addrIdStr) => {
          setSelectedAddressId(addrIdStr);
          if (user?.id) safeStorage.setItem(`selected_address_id_${user.id}`, addrIdStr);
          safeStorage.setItem("selected_address_id", addrIdStr);
          setShowAddressModal(false);
        }}
        onAddNewAddress={() => {
          setShowAddressModal(false);
          navigate("/account/addresses", { state: { from: "/cart", selectNew: true } });
        }}
      />

      <CheckoutBottomBar
        loadingAddresses={loadingAddresses}
        selectedAddress={selectedAddress}
        requiresSignIn={requiresSignIn}
        addressLoadFailed={addressLoadFailed}
        addresses={addresses}
        hasActivePendingPayment={hasActivePendingPayment}
        isAfterHours={isAfterHours}
        hasScheduledOpening={hasScheduledOpening}
        storeHours={storeHours}
        finalTotal={finalTotal}
        isDisabled={isDisabled}
        loading={loading}
        paymentStep={paymentStep}
        checkoutAction={checkoutAction}
        cancellingPending={cancellingPending}
        checkingPendingStatus={checkingPendingStatus}
        pendingStatusFeedback={pendingStatusFeedback}
        canCancelPending={canCancelPending}
        isPaymentUnpaid={isPaymentUnpaid}
        isConfirmingOrder={isConfirmingOrder}
        isRefundPending={isRefundPending}
        onOpenAddressModal={() => setShowAddressModal(true)}
        onRetryAddresses={() => setAddressRetry((value) => value + 1)}
        onCancelUnpaidCheckout={handleCancelUnpaidCheckout}
        onPrimaryAction={handlePrimaryAction}
        navigate={navigate}
      />
    </div>
  );
}

export default BillingForm;
