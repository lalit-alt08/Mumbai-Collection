import { useEffect, useState, useRef } from "react";
import {
  Package,
  Search,
  Truck,
  CheckCircle2,
  Clock,
  AlertCircle,
  RotateCcw,
  Eye,
  X,
  MapPin,
  Phone,
  Mail,
  Receipt,
  Boxes,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  Loader2,
  Calendar,
} from "lucide-react";
import { getOrders, updateOrderStatus } from "../services/employeeApi.js";

const STATUS_OPTIONS = [
  { value: "processing", label: "Processing / To Pack", dot: "bg-amber-400" },
  { value: "packed", label: "Packed (Ready for Dispatch)", dot: "bg-purple-500" },
  { value: "out-for-delivery", label: "Out for Delivery (Rider)", dot: "bg-blue-500" },
  { value: "completed", label: "Delivered (Completed)", dot: "bg-emerald-500" },
  { value: "on-hold", label: "On Hold", dot: "bg-orange-400" },
  { value: "cancelled", label: "Cancelled", dot: "bg-rose-500" },
  { value: "refunded", label: "Refunded", dot: "bg-gray-400" },
];

const DATE_FILTERS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7days", label: "Last 7 Days" },
  { id: "all", label: "All Time" },
  { id: "custom", label: "Custom 📅" },
];

function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [customDateRange, setCustomDateRange] = useState({ start: "", end: "" });
  const [tempDateRange, setTempDateRange] = useState({ start: "", end: "" });
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
  const [isContentTransitioning, setIsContentTransitioning] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const statusDropdownRef = useRef(null);

  // Close status dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(event.target)) {
        setIsStatusDropdownOpen(false);
      }
    };
    if (isStatusDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isStatusDropdownOpen]);

  // Pagination state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalOrders, setTotalOrders] = useState(0);
  const perPage = 20;

  // iOS Sliding Pill Refs & Position State
  const segmentedControlRef = useRef(null);
  const buttonRefs = useRef({});
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0, ready: false });

  // Update physical sliding indicator on selection or window resize
  const updateIndicatorPosition = () => {
    const activeBtn = buttonRefs.current[dateFilter];
    if (activeBtn) {
      setIndicatorStyle({
        left: activeBtn.offsetLeft,
        width: activeBtn.offsetWidth,
        ready: true,
      });
    }
  };

  useEffect(() => {
    updateIndicatorPosition();
    window.addEventListener("resize", updateIndicatorPosition);
    return () => window.removeEventListener("resize", updateIndicatorPosition);
  }, [dateFilter, customDateRange]);

  // Debounce search input by 400ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPage(1);
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchOrderList = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await getOrders({
        status: activeTab !== "all" ? activeTab : undefined,
        search: debouncedSearch || undefined,
        page,
        per_page: perPage,
      });
      if (res.success) {
        setOrders(res.orders || []);
        setTotalOrders(res.total || res.orders?.length || 0);
        setTotalPages(res.totalPages || Math.ceil((res.total || 1) / perPage) || 1);
      }
    } catch (err) {
      console.error("Fetch orders error:", err);
      setError(err.response?.data?.message || err.message || "Failed to load orders from server.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrderList();
  }, [activeTab, debouncedSearch, page]);

  const handleTabChange = (newTab) => {
    setActiveTab(newTab);
    setPage(1);
  };

  const handleDateFilterSelect = (filterId) => {
    if (filterId === "custom") {
      setTempDateRange(customDateRange.start ? customDateRange : {
        start: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() - 7 * 86400000)),
        end: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()),
      });
      setIsCustomModalOpen(true);
      return;
    }

    if (filterId !== dateFilter) {
      setIsContentTransitioning(true);
      setDateFilter(filterId);
      setPage(1);
      setTimeout(() => setIsContentTransitioning(false), 200);
    }
  };

  const handleApplyCustomRange = () => {
    if (tempDateRange.start && tempDateRange.end) {
      setIsContentTransitioning(true);
      setCustomDateRange(tempDateRange);
      setDateFilter("custom");
      setIsCustomModalOpen(false);
      setPage(1);
      setTimeout(() => setIsContentTransitioning(false), 200);
    }
  };

  const setPresetRange = (days) => {
    const end = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const start = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() - days * 86400000));
    setTempDateRange({ start, end });
  };

  const setMonthPreset = () => {
    const now = new Date();
    const start = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(now.getFullYear(), now.getMonth(), 1));
    const end = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
    setTempDateRange({ start, end });
  };

  const handleStatusUpdate = async (orderId, newStatus) => {
    try {
      setUpdatingId(orderId);
      await updateOrderStatus(orderId, newStatus);
      await fetchOrderList();
      if (selectedOrder && selectedOrder.id === orderId) {
        setSelectedOrder((prev) => ({ ...prev, status: newStatus }));
      }
    } catch (err) {
      alert("Failed to update status: " + (err.response?.data?.message || err.message));
    } finally {
      setUpdatingId(null);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case "completed":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
            <CheckCircle2 size={13} /> Delivered
          </span>
        );
      case "processing":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 border border-amber-200">
            <Clock size={13} /> Processing / To Pack
          </span>
        );
      case "packed":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-3 py-1 text-xs font-bold text-purple-700 border border-purple-200">
            <Package size={13} /> Packed (Ready)
          </span>
        );
      case "out-for-delivery":
      case "dispatched":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 border border-blue-200">
            <Truck size={13} /> Out For Delivery
          </span>
        );
      case "cancelled":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700 border border-rose-200">
            <AlertCircle size={13} /> Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700 capitalize">
            {status}
          </span>
        );
    }
  };

  // Date Filtering Engine (Store Timezone Asia/Kolkata)
  const todayDateString = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const yesterdayDateString = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() - 86400000));
  const sevenDaysAgoDateString = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() - 7 * 86400000));

  const filteredOrders = orders.filter((order) => {
    if (dateFilter === "all") return true;
    if (!order.date_created) return true;

    const orderDate = order.date_created.split("T")[0];

    if (dateFilter === "today") {
      return orderDate === todayDateString;
    }
    if (dateFilter === "yesterday") {
      return orderDate === yesterdayDateString;
    }
    if (dateFilter === "7days") {
      return orderDate >= sevenDaysAgoDateString && orderDate <= todayDateString;
    }
    if (dateFilter === "custom") {
      if (!customDateRange.start) return true;
      if (customDateRange.start && customDateRange.end) {
        return orderDate >= customDateRange.start && orderDate <= customDateRange.end;
      }
      return orderDate >= customDateRange.start;
    }
    return true;
  });

  const formatDateLabel = (isoDate) => {
    if (!isoDate) return "";
    const parts = isoDate.split("-");
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}`;
    }
    return isoDate;
  };

  const tabs = [
    { id: "all", label: "All Orders" },
    { id: "processing", label: "To Pack" },
    { id: "packed", label: "Packed" },
    { id: "out-for-delivery", label: "Out for Delivery" },
    { id: "completed", label: "Delivered" },
    { id: "cancelled", label: "Cancelled" },
  ];

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* PREMIUM iOS-INSPIRED SEGMENTED DATE FILTER & REFRESH BAR */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white p-3.5 sm:p-4 rounded-2xl border border-gray-200 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-700 shrink-0">
            <Calendar size={16} />
          </div>
          <div>
            <span className="text-xs font-black uppercase tracking-wider text-slate-800">
              Filter by Date
            </span>
            <p className="text-[11px] text-slate-400">
              {dateFilter === "today"
                ? `Showing orders from Today (${formatDateLabel(todayDateString)})`
                : dateFilter === "yesterday"
                ? `Showing orders from Yesterday (${formatDateLabel(yesterdayDateString)})`
                : dateFilter === "7days"
                ? "Showing orders from the Last 7 Days"
                : dateFilter === "custom" && customDateRange.start && customDateRange.end
                ? `Custom Range: ${customDateRange.start} to ${customDateRange.end}`
                : "Showing all historical orders"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Sliding Segmented Pill Control */}
          <div className="overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
            <div
              ref={segmentedControlRef}
              role="tablist"
              aria-label="Filter orders by date window"
              className="relative inline-flex items-center rounded-2xl bg-slate-100/90 p-1 border border-slate-200/80 shadow-inner backdrop-blur-xs select-none min-w-max"
            >
              {/* Smooth Moving Physical Indicator Pill */}
              <div
                className="absolute top-1 bottom-1 rounded-xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] border border-slate-200/60 pointer-events-none transition-all duration-250 ease-[cubic-bezier(0.2,0.9,0.3,1.05)] will-change-transform motion-reduce:transition-none"
                style={{
                  transform: `translateX(${indicatorStyle.left}px)`,
                  width: `${indicatorStyle.width}px`,
                  opacity: indicatorStyle.ready ? 1 : 0,
                }}
              />

              {DATE_FILTERS.map((f) => {
                const isSelected = dateFilter === f.id;
                return (
                  <button
                    key={f.id}
                    ref={(el) => (buttonRefs.current[f.id] = el)}
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => handleDateFilterSelect(f.id)}
                    className={`relative z-10 px-3.5 py-1.5 text-xs font-bold transition-all duration-150 active:scale-[0.97] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 cursor-pointer ${
                      isSelected
                        ? "text-slate-900 font-extrabold"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {f.id === "custom" && customDateRange.start && customDateRange.end
                      ? `${formatDateLabel(customDateRange.start)} - ${formatDateLabel(customDateRange.end)}`
                      : f.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Refresh Pipeline Button */}
          <button
            onClick={fetchOrderList}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-bold text-gray-700 shadow-xs hover:bg-gray-50 transition cursor-pointer disabled:opacity-50 shrink-0"
            title="Refresh Order Pipeline"
          >
            <RotateCcw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* FILTER BAR: Status Tabs + Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-gray-200 bg-white p-3.5 sm:p-4 shadow-xs">
        {/* Status Tabs */}
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`rounded-xl px-3.5 py-2 text-xs font-bold transition cursor-pointer active:scale-95 ${
                activeTab === tab.id
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-300 shadow-xs"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Server Search Input */}
        <div className="relative w-full sm:w-72">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Order #, Name, Phone..."
            className="w-full rounded-xl border border-gray-200 bg-gray-50/50 py-2 pl-9 pr-4 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition"
          />
        </div>
      </div>

      {/* Orders Table with Content Transition */}
      <div className={`overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-opacity duration-200 ${isContentTransitioning ? "opacity-60" : "opacity-100"}`}>
        {loading ? (
          <div className="flex h-72 items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <Loader2 size={24} className="animate-spin text-emerald-600" />
              <p className="text-xs font-bold text-gray-400">Loading orders...</p>
            </div>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-rose-600">
            <p className="text-sm font-bold">{error}</p>
            <button
              onClick={fetchOrderList}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 transition cursor-pointer"
            >
              <RotateCcw size={14} /> Retry
            </button>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="py-16 text-center text-xs font-medium text-gray-400">
            No orders found for the selected {dateFilter !== "all" ? `date (${dateFilter})` : ""} filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-gray-100 bg-gray-50/75 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-6 py-3.5">Order # & Date</th>
                  <th className="px-6 py-3.5">Customer Details</th>
                  <th className="px-6 py-3.5">Items</th>
                  <th className="px-6 py-3.5">Amount & Payment</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5 text-right">Dispatch Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
                {filteredOrders.map((order) => {
                  const isUpdating = updatingId === order.id;
                  const isProcessing = order.status === "processing";
                  const isPacked = order.status === "packed";
                  const isOutForDelivery =
                    order.status === "out-for-delivery" || order.status === "dispatched";

                  return (
                    <tr key={order.id} className="hover:bg-gray-50/80 transition">
                      {/* Order # and Date */}
                      <td className="px-6 py-4">
                        <span className="font-bold text-gray-900">#{order.id}</span>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {order.date_created
                            ? new Date(order.date_created).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "N/A"}
                        </p>
                      </td>

                      {/* Customer Name & Phone */}
                      <td className="px-6 py-4">
                        <p className="font-bold text-gray-900">
                          {order.customer_name || `${order.billing?.first_name || ""} ${order.billing?.last_name || ""}`.trim() || "Guest Customer"}
                        </p>
                        <p className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1">
                          <Phone size={10} className="text-gray-400" />
                          {order.phone || order.billing?.phone || "No phone provided"}
                        </p>
                      </td>

                      {/* Items Preview */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="flex -space-x-2 overflow-hidden">
                            {order.items?.slice(0, 3).map((item, idx) => (
                              <img
                                key={idx}
                                src={item.image || "https://placehold.co/40x40?text=Item"}
                                alt={item.name}
                                className="inline-block h-8 w-8 rounded-lg object-cover ring-2 ring-white bg-gray-100"
                              />
                            ))}
                          </div>
                          <span className="text-xs font-semibold text-gray-600">
                            {order.items_count || order.items?.length || 1} item(s)
                          </span>
                        </div>
                      </td>

                      {/* Total & Payment */}
                      <td className="px-6 py-4">
                        <p className="font-bold text-gray-900">₹{order.total || 0}</p>
                        <span className="inline-block rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600 uppercase mt-0.5">
                          {order.payment_method_title || order.payment_method || "COD"}
                        </span>
                      </td>

                      {/* Status Badge */}
                      <td className="px-6 py-4">{getStatusBadge(order.status)}</td>

                      {/* Dispatch Actions */}
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setSelectedOrder(order)}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
                            title="View Full Order Details"
                          >
                            <Eye size={13} />
                            Details
                          </button>

                          {/* Quick 1-Click Status Controls */}
                          {isProcessing && (
                            <>
                              <button
                                onClick={() => handleStatusUpdate(order.id, "packed")}
                                disabled={isUpdating}
                                className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-purple-500 transition cursor-pointer disabled:opacity-50"
                              >
                                <Package size={12} />
                                {isUpdating ? "..." : "Pack"}
                              </button>
                              <button
                                onClick={() => handleStatusUpdate(order.id, "out-for-delivery")}
                                disabled={isUpdating}
                                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-blue-500 transition cursor-pointer disabled:opacity-50"
                              >
                                <Truck size={12} />
                                {isUpdating ? "..." : "Dispatch →"}
                              </button>
                            </>
                          )}

                          {isPacked && (
                            <button
                              onClick={() => handleStatusUpdate(order.id, "out-for-delivery")}
                              disabled={isUpdating}
                              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-500 transition cursor-pointer disabled:opacity-50"
                            >
                              <Truck size={13} />
                              {isUpdating ? "Updating..." : "Dispatch Rider →"}
                            </button>
                          )}

                          {isOutForDelivery && (
                            <button
                              onClick={() => handleStatusUpdate(order.id, "completed")}
                              disabled={isUpdating}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 transition cursor-pointer disabled:opacity-50"
                            >
                              <CheckCircle2 size={13} />
                              {isUpdating ? "Updating..." : "Mark Delivered ✓"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Server Pagination Controls */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/50 px-6 py-4">
            <p className="text-xs text-gray-500 font-medium">
              Showing <span className="font-bold text-gray-900">{(page - 1) * perPage + 1}</span> to{" "}
              <span className="font-bold text-gray-900">
                {Math.min(page * perPage, totalOrders)}
              </span>{" "}
              of <span className="font-bold text-gray-900">{totalOrders}</span> orders
            </p>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition cursor-pointer"
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <span className="text-xs font-bold text-gray-700 px-2">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition cursor-pointer"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* CUSTOM DATE RANGE iOS-STYLE MODAL */}
      {isCustomModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div
            className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-gray-100 space-y-5 animate-in zoom-in-95 duration-200"
            role="dialog"
            aria-modal="true"
            aria-labelledby="custom-date-title"
          >
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <Calendar size={18} className="text-emerald-600" />
                <h3 id="custom-date-title" className="text-base font-black text-gray-900">
                  Custom Date Window
                </h3>
              </div>
              <button
                onClick={() => setIsCustomModalOpen(false)}
                className="rounded-xl border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-700 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Quick Presets */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                Quick Shortcuts
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPresetRange(14)}
                  className="rounded-xl bg-slate-100 hover:bg-slate-200/80 px-3 py-1.5 text-xs font-bold text-slate-700 transition active:scale-95 cursor-pointer"
                >
                  Last 14 Days
                </button>
                <button
                  type="button"
                  onClick={() => setPresetRange(30)}
                  className="rounded-xl bg-slate-100 hover:bg-slate-200/80 px-3 py-1.5 text-xs font-bold text-slate-700 transition active:scale-95 cursor-pointer"
                >
                  Last 30 Days
                </button>
                <button
                  type="button"
                  onClick={() => setMonthPreset()}
                  className="rounded-xl bg-slate-100 hover:bg-slate-200/80 px-3 py-1.5 text-xs font-bold text-slate-700 transition active:scale-95 cursor-pointer"
                >
                  This Month
                </button>
              </div>
            </div>

            {/* Date Pickers */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-500 uppercase">
                  From Date
                </label>
                <input
                  type="date"
                  value={tempDateRange.start}
                  onChange={(e) => setTempDateRange((prev) => ({ ...prev, start: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 p-2.5 text-xs font-semibold text-gray-800 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-500 uppercase">
                  To Date
                </label>
                <input
                  type="date"
                  value={tempDateRange.end}
                  onChange={(e) => setTempDateRange((prev) => ({ ...prev, end: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 p-2.5 text-xs font-semibold text-gray-800 outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setIsCustomModalOpen(false)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyCustomRange}
                disabled={!tempDateRange.start || !tempDateRange.end}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-extrabold text-white shadow-sm hover:bg-emerald-500 active:scale-95 transition disabled:opacity-40 cursor-pointer"
              >
                Apply Range
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Order Details Drawer / Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:justify-end bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="flex max-h-[92vh] sm:max-h-[95vh] h-full w-full max-w-full sm:max-w-xl flex-col bg-white shadow-2xl rounded-t-[28px] sm:rounded-3xl border border-gray-100 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-gray-100 p-4 sm:p-6 shrink-0 bg-white">
              <div className="min-w-0 flex-1 pr-3">
                <h3 className="text-base sm:text-lg font-black text-gray-900 truncate">
                  Order #{selectedOrder.id}
                </h3>
                <p className="text-[11px] sm:text-xs text-gray-500 truncate mt-0.5">
                  Placed on{" "}
                  {selectedOrder.date_created
                    ? new Date(selectedOrder.date_created).toLocaleString("en-IN")
                    : "N/A"}
                </p>
              </div>

              <button
                onClick={() => setSelectedOrder(null)}
                className="rounded-xl border border-gray-200 p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-700 cursor-pointer shrink-0"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Scroll Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
              {/* Status Selector Card */}
              <div className="rounded-2xl border border-gray-200 bg-gray-50/80 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] sm:text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Current Fulfillment Status
                  </span>
                  {getStatusBadge(selectedOrder.status)}
                </div>

                <div className="relative w-full" ref={statusDropdownRef}>
                  <button
                    type="button"
                    disabled={updatingId === selectedOrder.id}
                    onClick={() => setIsStatusDropdownOpen((prev) => !prev)}
                    className="w-full flex items-center justify-between rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-xs font-bold text-gray-800 outline-none hover:border-emerald-500 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition shadow-2xs cursor-pointer disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                          STATUS_OPTIONS.find((o) => o.value === selectedOrder.status)?.dot || "bg-gray-400"
                        }`}
                      />
                      <span className="truncate">
                        {STATUS_OPTIONS.find((o) => o.value === selectedOrder.status)?.label || selectedOrder.status}
                      </span>
                    </div>
                    <ChevronDown
                      size={15}
                      className={`text-gray-500 transition-transform duration-200 shrink-0 ml-2 ${
                        isStatusDropdownOpen ? "rotate-180 text-emerald-600" : ""
                      }`}
                    />
                  </button>

                  {/* Custom In-DOM Dropdown Menu (Strictly bounded to 100% width of card) */}
                  {isStatusDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 z-40 mt-1.5 w-full rounded-xl bg-white border border-gray-200 shadow-xl overflow-hidden py-1 max-h-60 overflow-y-auto divide-y divide-gray-50 animate-in fade-in zoom-in-95 duration-150">
                      {STATUS_OPTIONS.map((option) => {
                        const isSelected = selectedOrder.status === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              setIsStatusDropdownOpen(false);
                              if (!isSelected) {
                                handleStatusUpdate(selectedOrder.id, option.value);
                              }
                            }}
                            className={`w-full flex items-center justify-between px-3.5 py-2.5 text-xs transition cursor-pointer text-left ${
                              isSelected
                                ? "bg-emerald-50/80 text-emerald-900 font-extrabold"
                                : "text-gray-700 font-semibold hover:bg-gray-50"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${option.dot}`} />
                              <span className="truncate">{option.label}</span>
                            </div>
                            {isSelected && (
                              <Check size={14} className="text-emerald-600 shrink-0 ml-2" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Delivery Address & Customer Info */}
              <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                  <MapPin size={14} className="text-emerald-600 shrink-0" />
                  <span>Delivery & Contact Information</span>
                </h4>

                <div className="space-y-1.5 text-xs text-gray-700 font-medium">
                  <p className="font-bold text-gray-900 text-sm">
                    {selectedOrder.customer_name || `${selectedOrder.billing?.first_name || ""} ${selectedOrder.billing?.last_name || ""}`.trim() || "Customer"}
                  </p>
                  <p className="text-gray-600 break-words">
                    {selectedOrder.shipping?.address_1 || selectedOrder.billing?.address_1 || "No street address provided"}
                    {(selectedOrder.shipping?.address_2 || selectedOrder.billing?.address_2) && `, ${selectedOrder.shipping?.address_2 || selectedOrder.billing?.address_2}`}
                  </p>
                  <p className="text-gray-600 break-words font-semibold">
                    {[
                      selectedOrder.shipping?.city || selectedOrder.billing?.city,
                      selectedOrder.shipping?.state || selectedOrder.billing?.state,
                      selectedOrder.shipping?.postcode || selectedOrder.billing?.postcode,
                    ]
                      .filter(Boolean)
                      .join(", ") || "Vasai, Maharashtra"}
                  </p>
                  <div className="flex flex-wrap gap-3 pt-2 border-t border-gray-100">
                    <a
                      href={`tel:${selectedOrder.phone || selectedOrder.billing?.phone}`}
                      className="inline-flex items-center gap-1 text-emerald-600 font-bold hover:underline"
                    >
                      <Phone size={12} /> {selectedOrder.phone || selectedOrder.billing?.phone || "No Phone"}
                    </a>
                    {selectedOrder.billing?.email && (
                      <a
                        href={`mailto:${selectedOrder.billing.email}`}
                        className="inline-flex items-center gap-1 text-gray-500 hover:underline truncate max-w-[200px]"
                      >
                        <Mail size={12} /> {selectedOrder.billing.email}
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                  <Boxes size={14} className="text-emerald-600 shrink-0" />
                  <span>Order Items ({selectedOrder.items?.length || 0})</span>
                </h4>

                <div className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white overflow-hidden">
                  {selectedOrder.items?.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3.5 sm:p-4 gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <img
                          src={item.image || "https://placehold.co/40x40?text=Item"}
                          alt={item.name}
                          className="h-10 w-10 rounded-lg object-cover bg-gray-100 border border-gray-200 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-gray-900 line-clamp-2 leading-tight">{item.name}</p>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            Qty: {item.quantity} × ₹{item.price || (item.total && item.quantity ? Math.round(item.total / item.quantity) : 0)}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-gray-900 shrink-0">
                        ₹{item.total || 0}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Order Financials */}
              <div className="rounded-2xl border border-gray-200 bg-gray-50/75 p-4 space-y-2 text-xs">
                <div className="flex justify-between text-gray-600">
                  <span>Payment Method:</span>
                  <span className="font-bold text-gray-900 uppercase">
                    {selectedOrder.payment_method_title || selectedOrder.payment_method || "COD"}
                  </span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Shipping:</span>
                  <span className="font-bold text-gray-900">
                    ₹{selectedOrder.shipping_total || "0.00"}
                  </span>
                </div>
                <div className="flex justify-between border-t border-gray-200 pt-2 text-sm font-black text-gray-900">
                  <span>Total Amount:</span>
                  <span className="text-emerald-600">₹{selectedOrder.total || 0}</span>
                </div>
              </div>
            </div>

            {/* Modal Footer Quick Dispatch */}
            <div className="border-t border-gray-100 p-3.5 sm:p-4 bg-white flex flex-wrap gap-2 shrink-0">
              <button
                onClick={() => setSelectedOrder(null)}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
              >
                Close
              </button>

              {/* Cancellation button where permitted */}
              {["processing", "packed", "on-hold"].includes(selectedOrder.status) && (
                <button
                  onClick={() => {
                    if (window.confirm("Are you sure you want to cancel this order?")) {
                      handleStatusUpdate(selectedOrder.id, "cancelled");
                    }
                  }}
                  disabled={updatingId === selectedOrder.id}
                  className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-100 transition cursor-pointer disabled:opacity-50"
                >
                  Cancel Order
                </button>
              )}

              {selectedOrder.status === "processing" && (
                <>
                  <button
                    onClick={() => handleStatusUpdate(selectedOrder.id, "packed")}
                    disabled={updatingId === selectedOrder.id}
                    className="flex-1 min-w-[120px] rounded-xl bg-purple-600 py-2.5 px-3 text-xs font-bold text-white hover:bg-purple-500 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <Package size={14} />
                    <span>Mark Packed</span>
                  </button>
                  <button
                    onClick={() => handleStatusUpdate(selectedOrder.id, "out-for-delivery")}
                    disabled={updatingId === selectedOrder.id}
                    className="flex-1 min-w-[120px] rounded-xl bg-blue-600 py-2.5 px-3 text-xs font-bold text-white hover:bg-blue-500 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <Truck size={14} />
                    <span>Dispatch Rider</span>
                  </button>
                </>
              )}

              {selectedOrder.status === "packed" && (
                <button
                  onClick={() => handleStatusUpdate(selectedOrder.id, "out-for-delivery")}
                  disabled={updatingId === selectedOrder.id}
                  className="flex-1 rounded-xl bg-blue-600 py-2.5 px-3 text-xs font-bold text-white hover:bg-blue-500 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <Truck size={14} />
                  <span>Dispatch Rider Now</span>
                </button>
              )}

              {(selectedOrder.status === "out-for-delivery" || selectedOrder.status === "dispatched") && (
                <button
                  onClick={() => handleStatusUpdate(selectedOrder.id, "completed")}
                  disabled={updatingId === selectedOrder.id}
                  className="flex-1 rounded-xl bg-emerald-600 py-2.5 px-3 text-xs font-bold text-white hover:bg-emerald-500 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 size={14} />
                  <span>Mark Delivered</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Orders;
