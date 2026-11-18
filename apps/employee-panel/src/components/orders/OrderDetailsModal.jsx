import {
  X,
  MapPin,
  Phone,
  Mail,
  Receipt,
  Boxes,
  Lock,
  ChevronDown,
  Check,
  AlertCircle,
  Truck,
  CheckCircle2,
} from "lucide-react";
import { getOrderTimestampDate, getCleanCustomerName } from "../../utils/orderDate.js";
import { getOrderLocationInfo, getLocationBadgeClass } from "../../utils/orderLocation.js";

export function OrderDetailsModal({
  order,
  onClose,
  onStatusUpdate,
  onConfirmDeliveryReview,
  onSendRefundEmail,
  updatingIds,
  isStatusDropdownOpen,
  setIsStatusDropdownOpen,
  statusDropdownRef,
  cancelConfirmPending,
  setCancelConfirmPending,
  statusOptions,
  allStatusBadges,
  getStatusBadge,
  isOrderDeliveredLocked,
}) {
  if (!order) return null;

  const orderDateObj = getOrderTimestampDate(order);
  const locationInfo = getOrderLocationInfo(order);
  const isUpdating = updatingIds.has(order.id);
  const needsDeliveryReview = order.meta_data?.some((meta) => meta.key === "_payment_captured_without_delivery_slot" && meta.value === "yes");
  const isDeliveredLocked = order.status === "completed" || isOrderDeliveredLocked(order);
  const refundEmailMetaVal = order.manual_refund_email_sent_at ||
    order.meta_data?.find((meta) => meta.key === "_manual_refund_email_sent_at")?.value;
  const isRefundEmailInFlight = String(refundEmailMetaVal || "").startsWith("sending:");
  const isRefundEmailConfirmed = Boolean(refundEmailMetaVal) && !isRefundEmailInFlight;

  const itemsSubtotal = (order.items || []).reduce(
    (sum, item) => sum + (Number(item.total) || 0),
    0
  );
  const discountTotal = Number(order.discount_total) || 0;
  const shippingTotal = Number(order.shipping_total) || 0;
  const taxTotal = Number(order.total_tax) || 0;
  const feeTotal = Number(order.fee_total) || 0;
  const orderTotal = Number(order.total) || 0;
  const calculatedSubtotal =
    itemsSubtotal > 0
      ? itemsSubtotal + discountTotal
      : Math.max(0, orderTotal - shippingTotal - taxTotal - feeTotal + discountTotal);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:justify-end bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Order ${order.id} details`}
        className="flex max-h-[92vh] sm:max-h-[95vh] h-full w-full max-w-full sm:max-w-xl flex-col bg-white shadow-2xl rounded-t-[28px] sm:rounded-3xl border border-gray-100 overflow-hidden"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-gray-100 p-4 sm:p-6 shrink-0 bg-white">
          <div className="min-w-0 flex-1 pr-3">
            <h3 className="text-lg sm:text-xl font-black text-gray-900 truncate">
              Order #{order.id}
            </h3>
            <p className="text-sm font-medium text-gray-600 truncate mt-1">
              Placed on {orderDateObj ? orderDateObj.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "N/A"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close order details"
            className="rounded-xl border border-gray-300 p-2.5 text-gray-600 hover:bg-gray-50 hover:text-gray-900 cursor-pointer shrink-0"
          >
            <X size={18} />
          </button>
        </div>

          {/* Modal Scroll Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {needsDeliveryReview && (
            <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              <p>Confirm delivery arrangements with the customer before dispatch.</p>
              <button type="button" disabled={isUpdating} onClick={() => onConfirmDeliveryReview(order.id)} className="mt-2 font-bold underline disabled:opacity-50">Confirm delivery arrangements</button>
            </div>
          )}
          {/* Status Selector Card */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50/80 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs sm:text-sm font-bold text-gray-800 uppercase tracking-wide">
                Current Fulfillment Status
              </span>
              {getStatusBadge(order.status, order.is_unpaid)}
            </div>

            {isDeliveredLocked ? (
              <div className="rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-xs space-y-1.5 shadow-2xs">
                <div className="flex items-center gap-2 font-bold text-gray-800">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
                  <span>Delivered (Completed)</span>
                </div>
                <p className="text-[11px] font-medium text-gray-400 flex items-center gap-1.5">
                  <Lock size={12} className="text-gray-400 shrink-0" />
                  <span>Delivered orders are final and cannot be reopened here.</span>
                </p>
              </div>
            ) : order.is_unpaid ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3.5 py-3 text-xs space-y-1.5 shadow-2xs">
                <div className="flex items-center gap-2 font-bold text-amber-900">
                  <AlertCircle size={15} className="text-amber-600 shrink-0" />
                  <span>Awaiting Online Payment</span>
                </div>
                <p className="text-[11px] font-medium text-amber-700">
                  Online payment has not been received. Orders cannot be packed or delivered until payment is captured.
                </p>
              </div>
            ) : (
              <div className="relative w-full" ref={statusDropdownRef}>
                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => setIsStatusDropdownOpen((prev) => !prev)}
                  className="w-full flex items-center justify-between rounded-xl border border-gray-300 bg-white px-3.5 py-3 text-sm font-bold text-gray-900 outline-none hover:border-emerald-500 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition shadow-2xs cursor-pointer disabled:opacity-60"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                        allStatusBadges.find((o) => o.value === order.status)?.dot || "bg-gray-400"
                      }`}
                    />
                    <span className="truncate">
                      {allStatusBadges.find((o) => o.value === order.status)?.label || order.status}
                    </span>
                  </div>
                  <ChevronDown
                    size={15}
                    className={`text-gray-500 transition-transform duration-200 shrink-0 ml-2 ${
                      isStatusDropdownOpen ? "rotate-180 text-emerald-600" : ""
                    }`}
                  />
                </button>

                {isStatusDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 z-40 mt-1.5 w-full rounded-xl bg-white border border-gray-200 shadow-xl overflow-hidden py-1 max-h-72 overflow-y-auto divide-y divide-gray-50 animate-in fade-in zoom-in-95 duration-150">
                    {statusOptions
                      .filter((opt) => opt.value === order.status || (order.allowed_next_statuses || []).includes(opt.value))
                      .map((opt) => {
                        const isSelected = order.status === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              setIsStatusDropdownOpen(false);
                              if (!isSelected) onStatusUpdate(order.id, opt.value);
                            }}
                            className={`w-full flex items-center justify-between px-3.5 py-2.5 text-xs transition cursor-pointer text-left ${
                              isSelected
                                ? "bg-emerald-50/80 text-emerald-900 font-extrabold"
                                : "text-gray-700 font-semibold hover:bg-gray-50"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${opt.dot}`} />
                              <span className="truncate">{opt.label}</span>
                            </div>
                            {isSelected && <Check size={14} className="text-emerald-600 shrink-0 ml-2" />}
                          </button>
                        );
                      })}
                    <button
                      type="button"
                      disabled={isUpdating || isRefundEmailInFlight || isRefundEmailConfirmed}
                      onClick={() => onSendRefundEmail(order)}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-left font-semibold text-rose-700 transition hover:bg-rose-50 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Mail size={14} className="shrink-0" />
                      <span>
                        {isRefundEmailConfirmed
                          ? "Refund email sent"
                          : isRefundEmailInFlight
                          ? "Sending refund email..."
                          : "Send refund email"}
                      </span>
                      {isRefundEmailConfirmed && <Check size={14} className="ml-auto text-emerald-600" />}
                      {isRefundEmailInFlight && <Loader2 size={14} className="ml-auto animate-spin text-rose-600" />}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Delivery Address & Customer Info */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h4 className="text-xs sm:text-sm font-bold uppercase tracking-wide text-gray-700 flex items-center gap-1.5">
                <MapPin size={14} className="text-emerald-600 shrink-0" />
                <span>Delivery & Contact Information</span>
              </h4>
              <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold ${getLocationBadgeClass(locationInfo.location_key)}`}>
                <MapPin size={11} className="shrink-0" />
                <span>{locationInfo.location}</span>
              </span>
            </div>

            <div className="space-y-1.5 text-sm leading-relaxed text-gray-800 font-medium">
              <p className="font-bold text-gray-900 text-base">
                {getCleanCustomerName(order.customer_name, order.billing?.first_name, order.billing?.last_name, "Customer")}
              </p>
              <p className="text-gray-700 break-words [overflow-wrap:anywhere]">
                {order.shipping?.address_1 || order.billing?.address_1 || "No street address provided"}
                {(order.shipping?.address_2 || order.billing?.address_2) && `, ${order.shipping?.address_2 || order.billing?.address_2}`}
              </p>
              <p className="text-gray-700 break-words font-semibold">
                {[
                  order.shipping?.city || order.billing?.city,
                  order.shipping?.state || order.billing?.state,
                  order.shipping?.postcode || order.billing?.postcode,
                ].filter(Boolean).join(", ") || "Vasai, Maharashtra"}
              </p>
              <div className="flex flex-wrap gap-3 pt-2 border-t border-gray-100">
                <a
                  href={`tel:${order.phone || order.billing?.phone}`}
                  className="inline-flex items-center gap-1.5 text-emerald-700 font-bold hover:underline"
                >
                  <Phone size={12} /> {order.phone || order.billing?.phone || "No Phone"}
                </a>
                {order.billing?.email && (
                  <a
                    href={`mailto:${order.billing.email}`}
                    className="inline-flex min-w-0 items-center gap-1.5 text-gray-700 hover:underline break-all"
                  >
                    <Mail size={12} /> {order.billing.email}
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Items List */}
          <div className="space-y-3">
            <h4 className="text-xs sm:text-sm font-bold uppercase tracking-wide text-gray-700 flex items-center gap-1.5">
              <Boxes size={14} className="text-emerald-600 shrink-0" />
              <span>Order Items ({order.items?.length || 0})</span>
            </h4>
            <div className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white overflow-hidden">
              {order.items?.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-3.5 sm:p-4 gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <img
                      src={item.image || "https://placehold.co/40x40?text=Item"}
                      alt={item.name}
                      className="h-10 w-10 rounded-lg object-cover bg-gray-100 border border-gray-200 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-gray-900 leading-snug break-words">{item.name}</p>
                      <p className="text-xs font-medium text-gray-600 mt-1">
                        Qty: {item.quantity} × ₹{item.price || (item.total && item.quantity ? Math.round(item.total / item.quantity) : 0)}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-gray-900 shrink-0">₹{item.total || 0}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Customer Note */}
          {Boolean(order.customer_note && String(order.customer_note).trim()) && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/75 p-3.5 sm:p-4 space-y-1.5 shadow-2xs">
              <h4 className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
                <Receipt size={14} className="text-amber-600 shrink-0" />
                <span>Customer Delivery Instructions</span>
              </h4>
              <p className="text-xs text-amber-950 font-medium whitespace-pre-wrap leading-relaxed">
                "{String(order.customer_note).trim()}"
              </p>
            </div>
          )}

          {/* Order Financials */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50/75 p-4 space-y-3 text-sm font-medium leading-relaxed">
            <div className="flex justify-between text-gray-600">
              <span>Payment Method:</span>
              <span className="font-bold text-gray-900 uppercase text-right">
                {order.payment_method_title || order.payment_method || "COD"}
              </span>
            </div>
            <div className="border-t border-gray-200/60 my-1" />
            <div className="flex justify-between text-gray-600">
              <span>Items Subtotal:</span>
              <span className="font-semibold text-gray-900">₹{calculatedSubtotal.toFixed(2)}</span>
            </div>
            {discountTotal > 0 && (
              <div className="flex justify-between text-emerald-700 font-semibold">
                <span>Discount / Coupon:</span>
                <span>-₹{discountTotal.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-600">
              <span>Delivery / Shipping:</span>
              <span className="font-semibold text-gray-900">{shippingTotal > 0 ? `₹${shippingTotal.toFixed(2)}` : "Free Delivery"}</span>
            </div>
            {taxTotal > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Taxes:</span>
                <span className="font-semibold text-gray-900">₹{taxTotal.toFixed(2)}</span>
              </div>
            )}
            {feeTotal > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Additional Fees:</span>
                <span className="font-semibold text-gray-900">₹{feeTotal.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-gray-200 pt-3 text-base font-black text-gray-900">
              <span>Total Amount:</span>
              <span className="text-emerald-700">₹{order.total || "0.00"}</span>
            </div>
          </div>
        </div>

        {/* Modal Footer Quick Dispatch */}
        <div className="border-t border-gray-100 p-3.5 sm:p-4 bg-white flex flex-wrap gap-2 shrink-0 justify-between">
          {cancelConfirmPending ? (
            <div className="w-full flex flex-col gap-2">
              <p className="text-sm font-semibold text-rose-700 text-center">Cancel this order?</p>
              <p className="text-xs text-gray-500 text-center">This action cannot be undone.</p>
              <div className="flex gap-2 w-full">
                <button
                  type="button"
                  onClick={() => setCancelConfirmPending(false)}
                  className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
                >
                  Keep Order
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCancelConfirmPending(false);
                    onStatusUpdate(order.id, "cancelled");
                  }}
                  disabled={isUpdating}
                  className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-rose-500 transition cursor-pointer disabled:opacity-50"
                >
                  Yes, Cancel Order
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
              >
                Close
              </button>

              {["processing", "packed"].includes(order.status) && (
                <button
                  type="button"
                  onClick={() => setCancelConfirmPending(true)}
                  disabled={isUpdating}
                  className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-100 transition cursor-pointer disabled:opacity-50"
                >
                  Cancel Order
                </button>
              )}

              {order.status === "processing" && (
                <button
                  type="button"
                  onClick={() => onStatusUpdate(order.id, "out-for-delivery")}
                  disabled={isUpdating || needsDeliveryReview}
                  className="flex-1 rounded-xl bg-blue-600 py-2.5 px-3 text-xs font-bold text-white hover:bg-blue-500 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <Truck size={14} />
                  <span>Dispatch Rider</span>
                </button>
              )}

              {order.status === "packed" && (
                <button
                  type="button"
                  onClick={() => onStatusUpdate(order.id, "out-for-delivery")}
                  disabled={isUpdating || needsDeliveryReview}
                  className="flex-1 rounded-xl bg-blue-600 py-2.5 px-3 text-xs font-bold text-white hover:bg-blue-500 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <Truck size={14} />
                  <span>Dispatch Rider Now</span>
                </button>
              )}

              {(order.status === "out-for-delivery" || order.status === "dispatched") && (
                <button
                  type="button"
                  onClick={() => onStatusUpdate(order.id, "completed")}
                  disabled={isUpdating}
                  className="flex-1 rounded-xl bg-emerald-600 py-2.5 px-3 text-xs font-bold text-white hover:bg-emerald-500 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 size={14} />
                  <span>Mark Delivered</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
