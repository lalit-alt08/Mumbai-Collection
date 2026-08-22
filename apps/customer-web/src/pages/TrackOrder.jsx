import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Search,
  Package,
  MapPin,
  CheckCircle2,
  Clock,
  ArrowLeft,
  Truck,
  AlertCircle,
  Loader2,
  RefreshCw,
  ShoppingBag,
  Phone,
} from "lucide-react";
import { getOrderById } from "../services/orderService";

function TrackOrder() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlOrderId = searchParams.get("id") || "";

  const [orderInput, setOrderInput] = useState(urlOrderId);
  const [activeOrderId, setActiveOrderId] = useState(urlOrderId);
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isPolling, setIsPolling] = useState(false);

  const pollTimerRef = useRef(null);

  // Sync state if URL query param changes
  useEffect(() => {
    if (urlOrderId) {
      setOrderInput(urlOrderId);
      setActiveOrderId(urlOrderId);
    }
  }, [urlOrderId]);

  // Fetch Order Details
  const fetchOrder = async (idToFetch, isBackground = false) => {
    if (!idToFetch) return;

    try {
      if (!isBackground) {
        setLoading(true);
        setError("");
      }

      const res = await getOrderById(idToFetch);

      if (res?.success && res?.order) {
        setOrder(res.order);
        setError("");
      } else {
        setError(res?.message || "Order not found.");
        setOrder(null);
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 403) {
        setError("You are not authorized to view this order. Please log in to the account that placed this order.");
      } else if (status === 404) {
        setError(`Order #${idToFetch} could not be found.`);
      } else if (status === 401) {
        setError("Please log in to track your orders.");
      } else {
        if (!isBackground) {
          setError(err.response?.data?.message || err.message || "Failed to retrieve order tracking information.");
        }
      }
      if (!isBackground) {
        setOrder(null);
      }
    } finally {
      if (!isBackground) {
        setLoading(false);
      }
    }
  };

  // Initial fetch on activeOrderId change
  useEffect(() => {
    if (activeOrderId) {
      fetchOrder(activeOrderId, false);
    }
  }, [activeOrderId]);

  // Lightweight Polling (every 6 seconds while order is active)
  useEffect(() => {
    if (!activeOrderId || !order) return;

    const isTerminalState =
      order.status === "completed" ||
      order.status === "cancelled" ||
      order.status === "refunded" ||
      order.status === "failed";

    if (isTerminalState) {
      setIsPolling(false);
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    setIsPolling(true);
    pollTimerRef.current = setInterval(() => {
      fetchOrder(activeOrderId, true);
    }, 6000);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [activeOrderId, order?.status]);

  const handleSearch = (e) => {
    e.preventDefault();
    const cleanId = orderInput.trim().replace(/\D/g, "");
    if (!cleanId) return;

    setSearchParams({ id: cleanId });
    setActiveOrderId(cleanId);
  };

  const getStepStatus = (stepStage, currentStage, orderStatus) => {
    if (orderStatus === "cancelled" || orderStatus === "failed" || orderStatus === "refunded") {
      return "cancelled";
    }
    if (currentStage > stepStage) return "completed";
    if (currentStage === stepStage) return "active";
    return "pending";
  };

  const trackingSteps = [
    {
      stage: 1,
      title: "Order Placed & Confirmed",
      description: "Order received and verified by Mumbai Collection.",
      icon: CheckCircle2,
    },
    {
      stage: 2,
      title: "Packed & Ready at Store",
      description: "Items packed securely at Vasai Store.",
      icon: Package,
    },
    {
      stage: 3,
      title: "Out for Delivery",
      description: "Handed over to delivery rider.",
      icon: Truck,
    },
    {
      stage: 4,
      title: "Delivered",
      description: "Order delivered to your address.",
      icon: MapPin,
    },
  ];

  return (
    <div className="min-h-screen bg-[#F7F7FB] px-4 py-8 md:py-12">
      <div className="mx-auto max-w-2xl rounded-[24px] border border-gray-100 bg-white p-6 shadow-sm md:p-10">
        <Link
          to="/account/orders"
          className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[#7C3AED] transition hover:text-[#6C35E8]"
        >
          <ArrowLeft size={16} /> Back to My Orders
        </Link>

        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F1ECFF] text-[#7C3AED]">
            <Truck size={28} />
          </div>
          <h1 className="text-2xl font-extrabold text-[#1E1E1E]">Live Order Tracking</h1>
          <p className="mt-1.5 text-sm text-gray-500">
            Real-time status updates for your Mumbai Collection deliveries.
          </p>
        </div>

        {/* Search Input */}
        <form onSubmit={handleSearch} className="mb-8 flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">#</span>
            <input
              type="text"
              required
              value={orderInput}
              onChange={(e) => setOrderInput(e.target.value.replace(/\D/g, ""))}
              placeholder="e.g. 48"
              className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50 pl-8 pr-4 text-sm font-medium text-gray-900 outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-2 focus:ring-[#7C3AED]/10"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#7C3AED] px-6 text-sm font-bold text-white shadow-sm transition hover:bg-[#6C35E8] active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            Track
          </button>
        </form>

        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500 gap-3">
            <Loader2 size={32} className="animate-spin text-[#7C3AED]" />
            <p className="text-sm font-semibold">Connecting to delivery tracking network...</p>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-5 text-rose-700 space-y-2">
            <div className="flex items-center gap-2 font-bold text-sm">
              <AlertCircle size={18} className="shrink-0" />
              Unable to Track Order
            </div>
            <p className="text-xs text-rose-600 leading-relaxed">{error}</p>
          </div>
        )}

        {/* Live Tracking Result */}
        {order && !loading && (
          <div className="rounded-2xl border border-[#C4B5FD]/40 bg-[#F7F7FB] p-6 animate-in fade-in duration-300 space-y-6">
            {/* Header / Current Status */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-gray-200/60 pb-4 gap-2">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Order Reference</span>
                <div className="text-lg font-black text-gray-900">#{order.order_number || order.id}</div>
              </div>

              <div className="flex items-center gap-2">
                {isPolling && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                    Live Syncing
                  </span>
                )}
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-extrabold ${
                  order.status === "completed"
                    ? "bg-emerald-100 text-emerald-800"
                    : order.status === "packed"
                    ? "bg-purple-100 text-purple-800"
                    : order.status === "out-for-delivery" || order.status === "dispatched"
                    ? "bg-blue-100 text-blue-800"
                    : order.status === "cancelled" || order.status === "failed"
                    ? "bg-rose-100 text-rose-800"
                    : "bg-amber-100 text-amber-800"
                }`}>
                  {order.display_status || order.status}
                </span>
              </div>
            </div>

            {/* Cancelled Banner if applicable */}
            {order.status === "cancelled" && (
              <div className="rounded-xl bg-rose-50 p-4 border border-rose-200 text-xs font-semibold text-rose-700">
                This order was cancelled. If you have questions or requested a refund, please reach out to customer support.
              </div>
            )}

            {/* Live Progress Stepper */}
            <div className="space-y-6 pt-2">
              {trackingSteps.map((step, idx) => {
                const state = getStepStatus(step.stage, order.tracking_stage || 1, order.status);
                const Icon = step.icon;

                return (
                  <div key={idx} className="flex items-start gap-4">
                    {/* Icon Column */}
                    <div className="flex flex-col items-center">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all duration-300 ${
                          state === "completed"
                            ? "bg-emerald-600 text-white shadow-md shadow-emerald-200"
                            : state === "active"
                            ? "bg-[#7C3AED] text-white ring-4 ring-[#7C3AED]/20 shadow-md"
                            : state === "cancelled"
                            ? "bg-gray-200 text-gray-400"
                            : "bg-gray-100 text-gray-400"
                        }`}
                      >
                        <Icon size={18} />
                      </div>
                      {idx < trackingSteps.length - 1 && (
                        <div
                          className={`h-10 w-0.5 mt-2 transition-all duration-300 ${
                            state === "completed" ? "bg-emerald-500" : "bg-gray-200"
                          }`}
                        />
                      )}
                    </div>

                    {/* Content Column */}
                    <div className={`pt-1.5 ${state === "pending" || state === "cancelled" ? "opacity-40" : ""}`}>
                      <div className="text-sm font-bold text-gray-900 flex items-center gap-2">
                        {step.title}
                        {state === "active" && (
                          <span className="rounded-md bg-[#7C3AED]/10 px-2 py-0.5 text-[10px] font-bold text-[#7C3AED]">
                            In Progress
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">{step.description}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Order Items & Delivery Destination */}
            <div className="border-t border-gray-200/60 pt-5 space-y-4 text-xs">
              {/* Delivery Details */}
              <div className="rounded-xl bg-white p-4 border border-gray-100 space-y-1.5">
                <div className="font-bold text-gray-800 flex items-center gap-1.5">
                  <MapPin size={13} className="text-[#7C3AED]" /> Destination Address
                </div>
                <p className="text-gray-600 font-medium">
                  {[
                    order.shipping?.address_1 || order.billing?.address_1,
                    order.shipping?.city || order.billing?.city,
                    order.shipping?.state || order.billing?.state,
                    order.shipping?.postcode || order.billing?.postcode,
                  ]
                    .filter(Boolean)
                    .join(", ") || "Vasai, Maharashtra"}
                </p>
                {(order.shipping?.phone || order.billing?.phone) && (
                  <p className="text-gray-500 flex items-center gap-1 pt-1">
                    <Phone size={11} /> {order.shipping?.phone || order.billing?.phone}
                  </p>
                )}
              </div>

              {/* Items Preview */}
              {order.line_items && order.line_items.length > 0 && (
                <div className="rounded-xl bg-white p-4 border border-gray-100 space-y-2">
                  <div className="font-bold text-gray-800 flex items-center gap-1.5 mb-2">
                    <ShoppingBag size={13} className="text-[#7C3AED]" /> Order Items ({order.line_items.length})
                  </div>
                  <div className="divide-y divide-gray-100">
                    {order.line_items.map((item, i) => (
                      <div key={i} className="flex items-center justify-between py-2">
                        <div className="flex items-center gap-2.5">
                          {item.image ? (
                            <img
                              src={item.image}
                              alt={item.name}
                              className="h-8 w-8 rounded-lg object-cover bg-gray-50 border border-gray-100"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-lg bg-purple-50 text-[#7C3AED] flex items-center justify-center font-bold text-[10px]">
                              Item
                            </div>
                          )}
                          <div>
                            <span className="font-bold text-gray-900 line-clamp-1">{item.name}</span>
                            <span className="text-[11px] text-gray-400">Qty: {item.quantity}</span>
                          </div>
                        </div>
                        <span className="font-bold text-gray-900">₹{item.total || item.subtotal || 0}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between border-t border-gray-100 pt-2 font-black text-sm text-gray-900">
                    <span>Total Paid</span>
                    <span className="text-[#7C3AED]">₹{order.total || 0}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default TrackOrder;
