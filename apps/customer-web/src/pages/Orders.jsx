import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ShoppingBag,
  Package,
  Truck,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  HelpCircle,
  MapPin,
  Receipt,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { getMyOrders } from "../services/orderService";
import { useAuth } from "../context/AuthContext";

function Orders() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [expandedOrderId, setExpandedOrderId] = useState(null);

  const userEmail = user?.email || "";

  const fetchOrders = async () => {
    try {
      setLoading(true);
      setError("");
      const data = await getMyOrders(userEmail);
      if (data.success && Array.isArray(data.orders)) {
        setOrders(data.orders);
      } else {
        setOrders([]);
      }
    } catch (err) {
      console.error("Fetch orders error:", err);
      setError("Unable to load your orders right now. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [userEmail]);

  const toggleExpandOrder = (id) => {
    setExpandedOrderId((prev) => (prev === id ? null : id));
  };

  // Filter orders based on active tab
  const filteredOrders = orders.filter((order) => {
    if (activeTab === "all") return true;
    if (activeTab === "active") {
      return ["pending", "processing", "packed", "on-hold", "out-for-delivery", "dispatched"].includes(
        order.status
      );
    }
    if (activeTab === "delivered") {
      return order.status === "completed";
    }
    if (activeTab === "cancelled") {
      return ["cancelled", "refunded", "failed"].includes(order.status);
    }
    return true;
  });

  const getStatusBadge = (status, displayStatus) => {
    switch (status) {
      case "completed":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
            <CheckCircle2 size={13} />
            {displayStatus || "Delivered"}
          </span>
        );
      case "processing":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 border border-blue-200">
            <Package size={13} className="animate-pulse" />
            {displayStatus || "Preparing & Packing"}
          </span>
        );
      case "packed":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-3 py-1 text-xs font-bold text-purple-700 border border-purple-200">
            <Package size={13} />
            {displayStatus || "Packed & Ready"}
          </span>
        );
      case "out-for-delivery":
      case "dispatched":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F1ECFF] px-3 py-1 text-xs font-bold text-[#7C3AED] border border-[#C4B5FD]">
            <Truck size={13} className="animate-bounce" />
            {displayStatus || "Out for Delivery"}
          </span>
        );
      case "cancelled":
      case "failed":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700 border border-rose-200">
            <AlertCircle size={13} />
            {displayStatus || "Cancelled"}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 border border-amber-200">
            <Clock size={13} />
            {displayStatus || "Order Placed"}
          </span>
        );
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F7FB] px-4 py-6 md:py-10">
      <div className="mx-auto max-w-4xl">
        {/* Top Header Card */}
        <div className="mb-6 flex flex-col gap-4 rounded-[24px] bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.03)] md:flex-row md:items-center md:justify-between md:p-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/account")}
              aria-label="Back to Account"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition hover:bg-[#7C3AED] hover:text-white"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-xl font-extrabold text-[#1E1E1E] md:text-2xl">
                My Orders
              </h1>
              <p className="text-xs font-medium text-gray-500">
                {orders.length} order{orders.length !== 1 ? "s" : ""} placed under{" "}
                <span className="font-semibold text-gray-700">{user?.email || "your account"}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchOrders}
              className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-50"
            >
              <RotateCcw size={13} />
              Refresh
            </button>
            <Link
              to="/"
              className="rounded-full bg-[#7C3AED] px-5 py-2 text-xs font-bold text-white transition hover:bg-[#6C35E8] shadow-sm active:scale-95"
            >
              Shop More
            </Link>
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="mb-6 flex overflow-x-auto pb-1 scrollbar-none gap-2">
          {[
            { id: "all", label: "All Orders", count: orders.length },
            {
              id: "active",
              label: "Live / In-Progress",
              count: orders.filter((o) =>
                ["pending", "processing", "on-hold", "out-for-delivery", "dispatched"].includes(o.status)
              ).length,
            },
            {
              id: "delivered",
              label: "Delivered",
              count: orders.filter((o) => o.status === "completed").length,
            },
            {
              id: "cancelled",
              label: "Cancelled",
              count: orders.filter((o) => ["cancelled", "refunded", "failed"].includes(o.status)).length,
            },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-full px-5 py-2.5 text-xs font-bold transition-all ${
                activeTab === tab.id
                  ? "bg-[#1E1E1E] text-white shadow-sm"
                  : "bg-white text-gray-600 hover:bg-gray-100"
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                  activeTab === tab.id
                    ? "bg-white/20 text-white"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Loading Skeletons */}
        {loading && (
          <div className="space-y-4">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="animate-pulse rounded-[24px] bg-white p-6 shadow-sm"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div className="h-5 w-32 rounded-lg bg-gray-200" />
                  <div className="h-6 w-24 rounded-full bg-gray-200" />
                </div>
                <div className="flex gap-4">
                  <div className="h-16 w-16 rounded-xl bg-gray-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 rounded bg-gray-200" />
                    <div className="h-4 w-1/2 rounded bg-gray-200" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="rounded-[24px] border border-red-100 bg-red-50 p-6 text-center text-red-600 shadow-sm">
            <p className="font-semibold">{error}</p>
            <button
              onClick={fetchOrders}
              className="mt-3 rounded-full bg-red-600 px-5 py-2 text-xs font-bold text-white transition hover:bg-red-700"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && filteredOrders.length === 0 && (
          <div className="rounded-[28px] bg-white p-10 text-center shadow-[0_8px_30px_rgba(0,0,0,0.03)] md:p-16">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[#F1ECFF] text-[#7C3AED]">
              <ShoppingBag size={38} />
            </div>

            <h2 className="text-xl font-bold text-[#1E1E1E]">
              {activeTab === "all"
                ? "No Orders Found"
                : `No ${activeTab} orders`}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-gray-500 leading-relaxed">
              {activeTab === "all"
                ? "Looks like you haven't placed any orders yet. Discover our premium stationery, art supplies, and toys!"
                : `You do not have any orders currently under the ${activeTab} tab.`}
            </p>

            <div className="mt-8 flex justify-center gap-3">
              <Link
                to="/"
                className="rounded-full bg-[#7C3AED] px-8 py-3.5 text-sm font-bold text-white shadow-[0_4px_20px_rgba(124,58,237,0.25)] transition hover:bg-[#6C35E8] active:scale-95"
              >
                Start Shopping &rarr;
              </Link>
            </div>
          </div>
        )}

        {/* Orders List (Blinkit / Zepto style cards) */}
        {!loading && !error && filteredOrders.length > 0 && (
          <div className="space-y-5">
            {filteredOrders.map((order) => {
              const isExpanded = expandedOrderId === order.id;
              const isLive = ["pending", "processing", "on-hold", "out-for-delivery", "dispatched"].includes(
                order.status
              );

              return (
                <div
                  key={order.id}
                  className="overflow-hidden rounded-[26px] bg-white shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100 transition-all hover:shadow-[0_12px_40px_rgba(0,0,0,0.07)]"
                >
                  {/* Order Card Header */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/60 px-5 py-4 sm:px-6">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-gray-700 shadow-sm border border-gray-200/80">
                        <Package size={17} />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                          Order #{order.order_number}
                        </span>
                        <div className="text-xs text-gray-500 font-medium">
                          {formatDate(order.date_created)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {getStatusBadge(order.status, order.display_status)}
                    </div>
                  </div>

                  {/* Live Progress Bar (Blinkit / Zepto style) */}
                  {isLive && order.tracking_stage > 0 && (
                    <div className="border-b border-[#C4B5FD]/40 bg-[#F1ECFF]/40 px-5 py-4 sm:px-6">
                      <div className="mb-2 flex items-center justify-between text-xs font-bold">
                        <span className="flex items-center gap-1.5 text-[#7C3AED]">
                          <Truck size={15} className="animate-pulse" />
                          Delivery in 20-30 mins (Vasai Store Dispatch)
                        </span>
                        <span className="text-gray-500 font-medium">Stage {order.tracking_stage} of 4</span>
                      </div>

                      {/* 4-Step Progress Indicator */}
                      <div className="grid grid-cols-4 gap-2 pt-1">
                        {[
                          { label: "Placed", stage: 1 },
                          { label: "Packing", stage: 2 },
                          { label: "On the Way", stage: 3 },
                          { label: "Delivered", stage: 4 },
                        ].map((step) => {
                          const isDone = order.tracking_stage >= step.stage;
                          const isCurrent = order.tracking_stage === step.stage;

                          return (
                            <div key={step.stage} className="flex flex-col gap-1.5">
                              <div
                                className={`h-1.5 w-full rounded-full transition-all duration-500 ${
                                  isDone
                                    ? "bg-[#7C3AED]"
                                    : "bg-gray-200"
                                } ${isCurrent ? "animate-pulse" : ""}`}
                              />
                              <span
                                className={`text-[10px] font-semibold text-center ${
                                  isDone ? "text-[#7C3AED]" : "text-gray-400"
                                }`}
                              >
                                {step.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Items Preview */}
                  <div className="p-5 sm:p-6">
                    <div className="space-y-3">
                      {order.line_items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-4"
                        >
                          <div className="flex items-center gap-3.5">
                            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-100 bg-white p-1 shadow-sm">
                              {item.image ? (
                                <img
                                  src={item.image}
                                  alt={item.name}
                                  className="h-full w-full object-contain"
                                />
                              ) : (
                                <Package size={22} className="text-gray-300" />
                              )}
                            </div>
                            <div>
                              <h3 className="line-clamp-1 text-sm font-bold text-[#1E1E1E]">
                                {item.name}
                              </h3>
                              <div className="text-xs text-gray-500 font-medium">
                                Qty: <span className="font-bold text-gray-800">{item.quantity}</span> × ₹{item.price || (Number(item.total) / (item.quantity || 1)).toFixed(0)}
                              </div>
                            </div>
                          </div>

                          <div className="text-right">
                            <span className="text-sm font-extrabold text-[#1E1E1E]">
                              ₹{item.total}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Summary Footer Bar */}
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-gray-100 pt-4">
                      <div className="flex items-center gap-4">
                        <div>
                          <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                            Total Paid ({order.payment_method_title})
                          </span>
                          <div className="text-lg font-black text-[#1E1E1E]">
                            ₹{order.total}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <button
                          onClick={() => toggleExpandOrder(order.id)}
                          className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-50"
                        >
                          <Receipt size={14} />
                          {isExpanded ? "Hide Details" : "Invoice Details"}
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>

                        <Link
                          to={`/track-order?id=${order.id}`}
                          className="flex items-center gap-1.5 rounded-xl bg-[#F1ECFF] px-4 py-2 text-xs font-bold text-[#7C3AED] transition hover:bg-[#E0D4FC]"
                        >
                          <Truck size={14} />
                          Track Live
                        </Link>
                      </div>
                    </div>

                    {/* Expandable Full Bill & Address Details */}
                    {isExpanded && (
                      <div className="mt-5 rounded-2xl bg-gray-50 p-4 sm:p-5 border border-gray-100 space-y-4 animate-in fade-in duration-200">
                        {/* Delivery Address */}
                        <div>
                          <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                            <MapPin size={13} className="text-[#7C3AED]" />
                            Delivery Address
                          </h4>
                          <p className="text-xs text-gray-700 font-medium leading-relaxed">
                            <span className="font-bold text-gray-900">
                              {order.shipping?.first_name || order.billing?.first_name}{" "}
                              {order.shipping?.last_name || order.billing?.last_name}
                            </span>
                            <br />
                            {order.shipping?.address_1 || order.billing?.address_1}
                            {order.shipping?.address_2 ? `, ${order.shipping.address_2}` : order.billing?.address_2 ? `, ${order.billing.address_2}` : ""}, {order.shipping?.city || order.billing?.city}, {order.shipping?.state || order.billing?.state} - {order.shipping?.postcode || order.billing?.postcode}
                            <br />
                            Phone: {order.billing?.phone || "Not specified"}
                          </p>
                        </div>

                        {/* Itemized Bill Details */}
                        <div className="border-t border-gray-200/80 pt-3 space-y-1.5 text-xs text-gray-600">
                          <div className="flex justify-between">
                            <span>Items Subtotal</span>
                            <span className="font-semibold text-gray-800">
                              ₹{(Number(order.total) - Number(order.shipping_total) + Number(order.discount_total)).toFixed(2)}
                            </span>
                          </div>
                          {Number(order.discount_total) > 0 && (
                            <div className="flex justify-between text-emerald-700 font-semibold">
                              <span>Order Discount</span>
                              <span>-₹{order.discount_total}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span>Delivery Fee</span>
                            <span className="font-semibold text-gray-800">
                              {Number(order.shipping_total) === 0 ? "FREE" : `₹${order.shipping_total}`}
                            </span>
                          </div>
                          {Number(order.total_tax) > 0 && (
                            <div className="flex justify-between">
                              <span>Taxes</span>
                              <span className="font-semibold text-gray-800">₹{order.total_tax}</span>
                            </div>
                          )}
                          <div className="flex justify-between border-t border-gray-200/80 pt-2 text-sm font-bold text-gray-900">
                            <span>Grand Total</span>
                            <span>₹{order.total}</span>
                          </div>
                        </div>

                        {/* Customer Support CTA */}
                        <div className="flex items-center justify-between border-t border-gray-200/80 pt-3 text-xs">
                          <span className="text-gray-500 font-medium">Have an issue with this order?</span>
                          <Link
                            to="/contact"
                            className="flex items-center gap-1 font-bold text-[#7C3AED] hover:underline"
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
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default Orders;
