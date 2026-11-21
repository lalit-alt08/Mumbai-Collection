import { Home, Building2, ChevronRight, Clock } from "lucide-react";

export function CheckoutBottomBar({
  loadingAddresses,
  selectedAddress,
  requiresSignIn,
  addressLoadFailed,
  addresses,
  hasActivePendingPayment,
  isAfterHours,
  hasScheduledOpening,
  storeHours,
  finalTotal,
  isDisabled,
  loading,
  paymentStep,
  checkoutAction,
  cancellingPending,
  checkingPendingStatus,
  pendingStatusFeedback,
  canCancelPending,
  onOpenAddressModal,
  onRetryAddresses,
  onCancelUnpaidCheckout,
  onPrimaryAction,
  navigate,
}) {
  const handleAddressCapsuleClick = () => {
    if (requiresSignIn) {
      navigate("/login", { state: { from: "/cart" } });
    } else if (addressLoadFailed) {
      onRetryAddresses();
    } else if (addresses.length === 0) {
      navigate("/account/addresses", { state: { from: "/cart", selectNew: true } });
    } else {
      onOpenAddressModal();
    }
  };

  return (
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
                onClick={handleAddressCapsuleClick}
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
                        : addressLoadFailed
                        ? "Address unavailable"
                        : selectedAddress
                        ? `Delivering to ${selectedAddress.type ? (selectedAddress.type.charAt(0).toUpperCase() + selectedAddress.type.slice(1)) : "Home"}`
                        : "No delivery address"}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-[#64748B] truncate leading-tight mt-0.5">
                    {requiresSignIn
                      ? "Sign in to select a delivery address"
                      : addressLoadFailed
                      ? "We couldn’t load your saved addresses."
                      : selectedAddress
                      ? `${selectedAddress.address_line1 || ""}${selectedAddress.city ? `, ${selectedAddress.city}` : ""}${selectedAddress.pincode ? ` - ${selectedAddress.pincode}` : ""}`
                      : "Click to add your delivery address"}
                  </p>
                </div>
              </button>

              {!requiresSignIn && (
                <button
                  type="button"
                  onClick={handleAddressCapsuleClick}
                  className="shrink-0 text-[11px] sm:text-xs font-black text-[#22499F] bg-[#FFFFFF] border border-[#E2E8F0] hover:bg-[#22499F] hover:text-[#FFFFFF] px-3 py-1.5 rounded-xl shadow-xs active:scale-95 transition-all cursor-pointer"
                >
                  {addressLoadFailed
                    ? "Try again"
                    : addresses.length === 0
                    ? "+ Add"
                    : "Change"}
                </button>
              )}
            </>
          )}
        </div>

        {/* Row 2: Main Action Button */}
        <div className="w-full">
          {hasActivePendingPayment && (
            <div className="mb-2.5 rounded-2xl border border-blue-200/80 bg-blue-50/70 p-2.5 text-xs text-[#1E293B] shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {checkingPendingStatus ? (
                    <div
                      className="payment-status-spinner h-4 w-4 shrink-0 rounded-full border-2 border-[#22499F] border-t-transparent animate-spin"
                      style={{ animationDuration: "900ms" }}
                    />
                  ) : (
                    <Clock size={15} className="shrink-0 text-[#22499F]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p role="status" aria-live="polite" className="font-bold text-[#1E293B] text-[12px] leading-tight break-words">
                      {checkingPendingStatus
                        ? "Verifying payment"
                        : pendingStatusFeedback || "Payment pending"}
                    </p>
                    <p className="text-[10px] text-[#64748B] leading-tight mt-0.5 break-words">
                      {checkingPendingStatus
                        ? "Checking transaction status"
                        : "Check payment status to continue"}
                    </p>
                  </div>
                </div>
                {canCancelPending && <button
                  type="button"
                  onClick={onCancelUnpaidCheckout}
                  disabled={cancellingPending || checkingPendingStatus}
                  className="rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 active:scale-95 shrink-0 cursor-pointer disabled:opacity-50 transition-all shadow-xs"
                >
                  {cancellingPending ? "Ending…" : "Cancel checkout"}
                </button>}
              </div>
            </div>
          )}
          {isAfterHours && (
            <div className="mb-2 flex items-center justify-center gap-1.5 text-center text-[11px] font-bold text-[#22499F]">
              <span>
                {hasScheduledOpening
                  ? `🌙 Fulfillment starts ${storeHours?.next_opening?.label}. Delivery follows preparation.`
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
              onClick={onPrimaryAction}
              disabled={isDisabled}
              className={`store-primary-action group flex-1 flex items-center justify-center gap-2 h-[50px] sm:h-[52px] px-4 sm:px-5 rounded-full font-black text-[13.5px] sm:text-[14.5px] transition-all shadow-[0_6px_20px_rgba(66, 214, 232,0.28)] active:scale-[0.98] ${
                loading
                  ? "store-payment-loading cursor-wait"
                  : isDisabled
                  ? "bg-[#FFFFFF] text-[#64748B] border border-[#E2E8F0] shadow-none cursor-not-allowed opacity-80"
                  : "bg-gradient-to-r from-[#22499F] to-[#1B3B82] text-[#FFFFFF] hover:from-[#1B3B82] hover:to-[#1B3B82] hover:text-[#FFFFFF] cursor-pointer"
              }`}
            >
              {loading ? (
                <>
                  <svg
                    className="store-payment-spinner h-4.5 w-4.5 sm:h-5 sm:w-5 animate-spin shrink-0"
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
              ) : checkoutAction === "syncing_pricing" ? (
                <span>Updating total…</span>
              ) : checkoutAction === "legacy_payment" ? (
                <span>Payment needs review</span>
              ) : checkoutAction === "payment_signin" ? (
                <span>Sign in to check payment</span>
              ) : checkoutAction === "payment_status" ? (
                <span>{checkingPendingStatus ? "Checking payment…" : "Check payment status"}</span>
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
  );
}
