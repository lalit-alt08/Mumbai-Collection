import {
  CheckCircle2,
  Package,
  Clock,
  Truck,
  AlertCircle,
} from "lucide-react";

export function OrderStatusBadge({ status, displayStatus }) {
  switch (status) {
    case "completed":
      return (
        <span className="track-order-delivered-badge inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold border whitespace-nowrap shadow-xs">
          <CheckCircle2 size={13} />
          {displayStatus || "Delivered"}
        </span>
      );
    case "processing":
      return (
        <span className="order-status-processing inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold border whitespace-nowrap shadow-xs">
          <Package size={13} className="animate-pulse" />
          {displayStatus || "Preparing & Packing"}
        </span>
      );
    case "pending":
    case "on-hold":
      return (
        <span className="order-status-pending inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold border whitespace-nowrap shadow-xs">
          <Clock size={13} className="animate-spin" />
          {displayStatus || "Payment Pending"}
        </span>
      );
    case "packed":
      return (
        <span className="order-status-packed inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold border whitespace-nowrap shadow-xs">
          <Package size={13} />
          {displayStatus || "Packed & Ready"}
        </span>
      );
    case "out-for-delivery":
    case "dispatched":
      return (
        <span className="order-status-delivery inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold border whitespace-nowrap shadow-xs">
          <Truck size={13} className="animate-bounce" />
          {displayStatus || "Out for Delivery"}
        </span>
      );
    case "cancelled":
    case "failed":
      return (
        <span className="order-status-cancelled inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold whitespace-nowrap shadow-xs">
          <AlertCircle size={13} />
          {displayStatus || "Cancelled"}
        </span>
      );
    default:
      return (
        <span className="order-status-pending inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold border whitespace-nowrap shadow-xs">
          <Clock size={13} />
          {displayStatus || "Order Placed"}
        </span>
      );
  }
}
