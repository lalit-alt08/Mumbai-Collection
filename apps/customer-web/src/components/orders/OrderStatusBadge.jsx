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
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFFFFF] px-3 py-1 text-xs font-bold text-[#22499F] border border-[#E2E8F0]">
          <CheckCircle2 size={13} />
          {displayStatus || "Delivered"}
        </span>
      );
    case "processing":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#22499F]/10 px-3 py-1 text-xs font-bold text-[#22499F] border border-[#22499F]/40">
          <Package size={13} className="animate-pulse" />
          {displayStatus || "Preparing & Packing"}
        </span>
      );
    case "pending":
    case "on-hold":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFFFFF] px-3 py-1 text-xs font-bold text-[#22499F] border border-[#E2E8F0]">
          <Clock size={13} className="animate-spin" />
          {displayStatus || "Payment Pending"}
        </span>
      );
    case "packed":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFFFFF] px-3 py-1 text-xs font-bold text-[#22499F] border border-[#E2E8F0]">
          <Package size={13} />
          {displayStatus || "Packed & Ready"}
        </span>
      );
    case "out-for-delivery":
    case "dispatched":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFFFFF] px-3 py-1 text-xs font-bold text-[#22499F] border border-[#E2E8F0]">
          <Truck size={13} className="animate-bounce" />
          {displayStatus || "Out for Delivery"}
        </span>
      );
    case "cancelled":
    case "failed":
      return (
        <span className="order-status-cancelled inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold">
          <AlertCircle size={13} />
          {displayStatus || "Cancelled"}
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFFFFF] px-3 py-1 text-xs font-bold text-[#22499F] border border-[#E2E8F0]">
          <Clock size={13} />
          {displayStatus || "Order Placed"}
        </span>
      );
  }
}
