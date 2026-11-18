import { Link } from "react-router-dom";
import {
  Package,
  AlertCircle,
  Moon,
  Receipt,
  ChevronDown,
  ChevronUp,
  Clock,
  Truck,
  MapPin,
  HelpCircle,
} from "lucide-react";
import { OrderStatusBadge } from "./OrderStatusBadge.jsx";
import {
  getScheduledFulfillmentLabel,
  isPaymentAwaitingDeliveryReview,
  isScheduledFulfillmentOrder,
} from "../../utils/scheduledDelivery.js";

export function CustomerOrderCard({
  order,
  isExpanded,
  onToggleExpand,
  checkingPending,
  onCheckPending,
  formatDate,
}) {
  const isLive = ["pending", "processing", "on-hold", "out-for-delivery", "dispatched"].includes(
    order.status
  );
  const rawPaymentRef =
    order.razorpay_order_id ||
    order.meta_data?.find((m) => m.key === "_razorpay_order_id")?.value ||
    "";
  const razorpayOrderId =
    typeof rawPaymentRef === "string" && rawPaymentRef.trim() ? rawPaymentRef.trim() : "";

  return (
    <div
      key={order.id}
      className="overflow-hidden rounded-[26px] bg-[#FFFFFF] shadow-[0_8px_30px_rgba(0,0,0,0.25)] border border-[#E2E8F0]/80 transition-all hover:border-[#22499F]/50"
    >
      {/* Order Card Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0]/70 bg-[#F0F8E8] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FFFFFF] text-[#22499F] shadow-sm border border-[#E2E8F0]">
            <Package size={19} />
          </div>
          <div className="min-w-0 space-y-0.5">
            <span className="block text-sm sm:text-base font-extrabold text-[#1E293B] tracking-wide">
              Order #{order.order_number}
            </span>
            <div className="text-sm text-[#475569] font-medium leading-5">
              {formatDate(order.date_created)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isPaymentAwaitingDeliveryReview(order) ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/35 bg-amber-950/50 px-2.5 py-0.5 text-[10.5px] font-bold text-amber-200">
              <AlertCircle size={11} />
              <span>Delivery timing to be confirmed</span>
            </span>
          ) : (
            isScheduledFulfillmentOrder(order) && (
              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-400/35 bg-indigo-950/50 px-2.5 py-0.5 text-[10.5px] font-bold text-indigo-300 shadow-xs">
                <Moon size={11} className="text-indigo-400" />
                <span>Scheduled · {getScheduledFulfillmentLabel(order)}</span>
              </span>
            )
          )}
          <OrderStatusBadge status={order.status} displayStatus={order.display_status} />
        </div>
      </div>

      {/* Items Preview */}
      <div className="p-5 sm:p-6">
        <div className="space-y-3">
          {order.line_items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#E2E8F0]/60 bg-[#F0F8E8] p-1 shadow-sm">
                  {item.image ? (
                    <img
                      src={item.image}
                      alt={item.name}
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <Package size={22} className="text-[#64748B]" />
                  )}
                </div>
                <div>
                  <h3 className="line-clamp-1 text-sm font-bold text-[#1E293B]">
                    {item.name}
                  </h3>
                  <div className="text-xs text-[#64748B] font-medium">
                    Qty: <span className="font-bold text-[#1E293B]">{item.quantity}</span> × ₹{item.price || (Number(item.total) / (item.quantity || 1)).toFixed(0)}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <span className="text-sm font-extrabold text-[#1E293B]">
                  ₹{item.total}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Summary Footer Bar */}
        <div className="mt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3.5 sm:gap-4 border-t border-[#E2E8F0]/70 pt-4">
          <div className="flex items-baseline justify-between sm:flex-col sm:justify-start gap-1">
            <span className="text-xs font-bold uppercase tracking-wider text-[#64748B]">
              Total Paid ({order.payment_method_title})
            </span>
            <div className="text-lg sm:text-xl font-black text-[#1E293B] tracking-tight">
              ₹{order.total}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => onToggleExpand(order.id)}
              className={`col-span-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-xl border px-3 sm:px-4 text-xs font-bold transition-all select-none cursor-pointer whitespace-nowrap active:scale-[0.98] ${
                isExpanded
                  ? "order-invoice-toggle-expanded shadow-xs"
                  : "border-[#E2E8F0] bg-[#FFFFFF] text-[#475569] hover:bg-[#F0F8E8] hover:text-[#22499F] hover:border-[#22499F]/50"
              }`}
            >
              <Receipt size={14} className={`shrink-0 transition-colors ${isExpanded ? "text-current" : "text-[#64748B]"}`} />
              <span>{isExpanded ? "Hide Details" : "Invoice Details"}</span>
              {isExpanded ? (
                <ChevronUp size={13} className="shrink-0 text-current" />
              ) : (
                <ChevronDown size={13} className="shrink-0 text-[#64748B]" />
              )}
            </button>

            {["pending", "on-hold"].includes(order.status) && razorpayOrderId && (
              <button
                type="button"
                onClick={() => onCheckPending(razorpayOrderId)}
                disabled={checkingPending}
                className="col-span-2 sm:col-auto inline-flex items-center justify-center gap-1.5 h-10 rounded-xl bg-[#22499F] px-3.5 sm:px-4 text-xs font-black text-[#FFFFFF] transition-all select-none whitespace-nowrap hover:bg-[#1B3B82] active:scale-[0.98] disabled:opacity-50 cursor-pointer shadow-xs"
              >
                <Clock size={14} className="shrink-0" />
                <span>{checkingPending ? "Checking..." : "Check payment"}</span>
              </button>
            )}

            {isLive ? (
              <Link
                to={`/orders/${order.id}/track`}
                className="col-span-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-xl bg-[#22499F] px-3.5 sm:px-4 text-xs font-black text-[#FFFFFF] transition-all select-none whitespace-nowrap hover:bg-[#1B3B82] active:scale-[0.98] shadow-sm shadow-[#22499F]/20"
              >
                <Truck size={14} className="shrink-0" />
                <span>Track Order</span>
              </Link>
            ) : (
              <Link
                to={`/orders/${order.id}/track`}
                className="col-span-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-xl border border-[#22499F]/35 bg-[#FFFFFF] px-3.5 sm:px-4 text-xs font-bold text-[#22499F] transition-all select-none whitespace-nowrap hover:bg-[#FFFFFF] hover:border-[#22499F]/70 active:scale-[0.98]"
              >
                <Package size={14} className="shrink-0 text-[#22499F]" />
                <span>Order Details</span>
              </Link>
            )}
          </div>
        </div>

        {/* Expandable Full Bill & Address Details */}
        {isExpanded && (
          <div className="mt-5 rounded-2xl bg-[#F0F8E8] p-4 sm:p-5 border border-[#E2E8F0] space-y-4 animate-in fade-in duration-200">
            {/* Delivery Address */}
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#22499F] mb-1.5">
                <MapPin size={13} className="text-[#22499F]" />
                Delivery Address
              </h4>
              <p className="text-xs text-[#64748B] font-medium leading-relaxed">
                <span className="font-bold text-[#1E293B]">
                  {(() => {
                    const f = (order.shipping?.first_name || order.billing?.first_name || "").trim();
                    const l = (order.shipping?.last_name || order.billing?.last_name || "").trim();
                    if (!f && !l) return "Customer";
                    if (!l) return f;
                    if (!f) return l;
                    if (f.toLowerCase() === l.toLowerCase()) return f;
                    return `${f} ${l}`;
                  })()}
                </span>
                <br />
                {order.shipping?.address_1 || order.billing?.address_1}
                {order.shipping?.address_2 ? `, ${order.shipping.address_2}` : order.billing?.address_2 ? `, ${order.billing.address_2}` : ""}, {order.shipping?.city || order.billing?.city}, {order.shipping?.state || order.billing?.state} - {order.shipping?.postcode || order.billing?.postcode}
                <br />
                Phone: {order.billing?.phone || "Not specified"}
              </p>
            </div>

            {/* Itemized Bill Details */}
            <div className="border-t border-[#E2E8F0]/70 pt-3 space-y-1.5 text-xs text-[#64748B]">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[#1E293B]">Items Subtotal</span>
                  <span className="block text-xs text-[#64748B]">(Incl. of all taxes)</span>
                </div>
                <span className="font-semibold text-[#1E293B]">
                  ₹{(Number(order.total) - Number(order.shipping_total) + Number(order.discount_total)).toFixed(2)}
                </span>
              </div>
              {Number(order.discount_total) > 0 && (
                <div className="flex justify-between text-[#22499F] font-semibold">
                  <span>Order Discount</span>
                  <span>-₹{order.discount_total}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Delivery Fee</span>
                <span className="font-semibold text-[#1E293B]">
                  {Number(order.shipping_total) === 0 ? "FREE" : `₹${order.shipping_total}`}
                </span>
              </div>
              <div className="flex justify-between items-start border-t border-[#E2E8F0]/70 pt-2 text-sm font-bold text-[#1E293B]">
                <div>
                  <span>Grand Total</span>
                  <span className="block text-xs font-medium text-[#64748B]">Inclusive of all taxes (GST)</span>
                </div>
                <span className="text-[#22499F] font-black">₹{order.total}</span>
              </div>
            </div>

            {/* Customer Support CTA */}
            <div className="flex items-center justify-between border-t border-[#E2E8F0]/70 pt-3 text-xs">
              <span className="text-[#64748B] font-medium">Have an issue with this order?</span>
              <Link
                to="/contact"
                className="flex items-center gap-1 font-bold text-[#22499F] hover:underline"
              >
                <HelpCircle size={13} />
                Get Help & Support
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
