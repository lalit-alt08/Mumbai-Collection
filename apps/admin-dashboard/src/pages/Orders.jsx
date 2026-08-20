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
} from "lucide-react";
import { getOrders, updateOrderStatus } from "../services/adminApi";

function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);

  // Pagination state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalOrders, setTotalOrders] = useState(0);
  const perPage = 20;

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
      console.error("Fetch admin orders error:", err);
      setError(err.response?.data?.message || err.message || "Failed to load orders from WooCommerce.");
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
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 border border-blue-200">
            <Package size={13} className="animate-pulse" /> To Pack & Dispatch
          </span>
        );
      case "out-for-delivery":
      case "dispatched":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-[#FF8A00] border border-orange-200">
            <Truck size={13} /> Out for Delivery
          </span>
        );
      case "cancelled":
      case "failed":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700 border border-rose-200">
            <AlertCircle size={13} /> Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 border border-amber-200">
            <Clock size={13} /> {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 md:text-3xl">
            Order Fulfillment & Dispatch
          </h1>
          <p className="text-xs font-medium text-gray-500 mt-1">
            Server-side search and live dispatch across all store orders
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchOrderList}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold text-gray-700 shadow-sm transition hover:bg-gray-50"
          >
            <RotateCcw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filter Tabs & Server Search Bar */}
      <div className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-sm border border-gray-100 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex overflow-x-auto pb-1 scrollbar-none gap-2">
          {[
            { id: "all", label: "All Orders" },
            { id: "processing", label: "To Pack & Dispatch" },
            { id: "out-for-delivery", label: "On the Way" },
            { id: "completed", label: "Delivered" },
            { id: "cancelled", label: "Cancelled" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`whitespace-nowrap rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeTab === tab.id
                  ? "bg-[#1E1E1E] text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Server-Side Search */}
        <div className="relative w-full sm:w-80">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search all orders (server-side)..."
            className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 text-xs font-medium text-gray-800 placeholder-gray-400 focus:border-[#FF8A00] focus:bg-white focus:outline-none transition"
          />
        </div>
      </div>

      {/* Orders Table */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm border border-gray-100">
        {loading ? (
          <div className="p-12 text-center text-xs font-semibold text-gray-500">
            Loading orders from WooCommerce...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-xs font-semibold text-red-600">{error}</div>
        ) : orders.length === 0 ? (
          <div className="p-12 text-center text-xs font-medium text-gray-500">
            No orders found matching current criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-gray-100 bg-gray-50/50 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="py-3.5 px-4">Order #</th>
                  <th className="py-3.5 px-4">Customer Details</th>
                  <th className="py-3.5 px-4">Items Summary</th>
                  <th className="py-3.5 px-4">Total Amount</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Dispatch Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium">
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50/60 transition">
                    <td className="py-4 px-4 font-bold text-gray-900">
                      <div className="flex items-center gap-2">
                        <span>#{order.order_number}</span>
                      </div>
                      <div className="text-[10px] text-gray-400 font-normal">
                        {new Date(order.date_created).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </td>

                    <td className="py-4 px-4">
                      <div className="font-bold text-gray-900">{order.customer.name}</div>
                      <div className="text-[10px] text-gray-500">{order.customer.phone || order.customer.email}</div>
                    </td>

                    <td className="py-4 px-4">
                      <div className="flex items-center gap-2">
                        <div className="flex -space-x-2 overflow-hidden">
                          {order.items.slice(0, 3).map((item, idx) => (
                            <div
                              key={idx}
                              className="inline-block h-8 w-8 rounded-lg border-2 border-white bg-white overflow-hidden shadow-sm"
                            >
                              {item.image ? (
                                <img src={item.image} alt={item.name} className="h-full w-full object-contain" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center bg-gray-100">
                                  <Boxes size={12} className="text-gray-400" />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        <span className="text-[11px] font-semibold text-gray-600">
                          {order.items.length} item{order.items.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </td>

                    <td className="py-4 px-4 font-black text-gray-900">
                      ₹{order.total}
                      <div className="text-[10px] text-gray-400 font-normal">{order.payment_method}</div>
                    </td>

                    <td className="py-4 px-4">{getStatusBadge(order.status)}</td>

                    <td className="py-4 px-4 text-right space-x-2">
                      <button
                        onClick={() => setSelectedOrder(order)}
                        className="rounded-xl border border-gray-200 px-3 py-1.5 text-[11px] font-bold text-gray-700 hover:bg-gray-100 transition"
                      >
                        <Eye size={13} className="inline mr-1" /> View Details
                      </button>

                      {order.status === "processing" && (
                        <button
                          disabled={updatingId === order.id}
                          onClick={() => handleStatusUpdate(order.id, "out-for-delivery")}
                          className="rounded-xl bg-[#FF8A00] px-3.5 py-1.5 text-[11px] font-bold text-white shadow-sm hover:bg-[#FF7300] active:scale-95 disabled:opacity-50 transition"
                        >
                          {updatingId === order.id ? "Updating..." : "Dispatch Rider &rarr;"}
                        </button>
                      )}

                      {(order.status === "out-for-delivery" || order.status === "dispatched") && (
                        <button
                          disabled={updatingId === order.id}
                          onClick={() => handleStatusUpdate(order.id, "completed")}
                          className="rounded-xl bg-emerald-600 px-3.5 py-1.5 text-[11px] font-bold text-white shadow-sm hover:bg-emerald-700 active:scale-95 disabled:opacity-50 transition"
                        >
                          {updatingId === order.id ? "Updating..." : "Mark Delivered ✓"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {!loading && !error && totalOrders > 0 && (
          <div className="flex flex-col gap-3 border-t border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between text-xs text-gray-500 font-medium">
            <div>
              Showing <span className="font-bold text-gray-800">{(page - 1) * perPage + 1}</span> to{" "}
              <span className="font-bold text-gray-800">
                {Math.min(page * perPage, totalOrders)}
              </span>{" "}
              of <span className="font-bold text-gray-800">{totalOrders}</span> orders
            </div>

            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="flex items-center gap-1 rounded-xl border border-gray-200 px-3.5 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronLeft size={14} /> Previous
              </button>

              <span className="px-2 font-bold text-gray-800">
                Page {page} of {totalPages}
              </span>

              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="flex items-center gap-1 rounded-xl border border-gray-200 px-3.5 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Order Details Drawer / Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <div>
                <h3 className="text-lg font-black text-gray-900">
                  Order #{selectedOrder.order_number}
                </h3>
                <p className="text-xs text-gray-500 font-medium">
                  Placed on {new Date(selectedOrder.date_created).toLocaleString("en-IN")}
                </p>
              </div>

              <button
                onClick={() => setSelectedOrder(null)}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="my-6 space-y-5 text-xs">
              {/* Status Update Strip */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gray-50 p-4 border border-gray-100">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Current Status</span>
                  <div>{getStatusBadge(selectedOrder.status)}</div>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    disabled={updatingId === selectedOrder.id}
                    value={selectedOrder.status}
                    onChange={(e) => handleStatusUpdate(selectedOrder.id, e.target.value)}
                    className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-800 focus:border-[#FF8A00] focus:outline-none"
                  >
                    <option value="processing">Processing / To Pack</option>
                    <option value="out-for-delivery">Out for Delivery (Rider Dispatched)</option>
                    <option value="completed">Delivered (Completed)</option>
                    <option value="on-hold">On Hold (Awaiting Confirmation)</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="refunded">Refunded / Returned</option>
                  </select>
                </div>
              </div>

              {/* Customer & Delivery Address */}
              <div className="rounded-2xl border border-gray-100 p-4 space-y-2">
                <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-500">
                  <MapPin size={14} className="text-[#FF8A00]" /> Delivery Address
                </h4>
                <div className="font-bold text-gray-900 text-sm">{selectedOrder.customer.name}</div>
                <div className="text-gray-600 font-medium leading-relaxed">{selectedOrder.customer.address}</div>
                <div className="flex items-center gap-4 pt-2 text-gray-600">
                  {selectedOrder.customer.phone && (
                    <a
                      href={`tel:${selectedOrder.customer.phone}`}
                      className="flex items-center gap-1 text-[#FF8A00] font-bold hover:underline"
                    >
                      <Phone size={12} /> {selectedOrder.customer.phone}
                    </a>
                  )}
                  {selectedOrder.customer.email && (
                    <span className="flex items-center gap-1">
                      <Mail size={12} /> {selectedOrder.customer.email}
                    </span>
                  )}
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-3">
                <h4 className="font-bold uppercase tracking-wider text-gray-400 text-[11px]">
                  Ordered Items ({selectedOrder.items.length})
                </h4>
                <div className="space-y-2">
                  {selectedOrder.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-xl bg-gray-50 p-3 border border-gray-100"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-white border border-gray-200">
                          {item.image ? (
                            <img src={item.image} alt={item.name} className="h-full w-full object-contain" />
                          ) : (
                            <Boxes size={18} className="text-gray-400" />
                          )}
                        </div>
                        <div>
                          <div className="font-bold text-gray-900">{item.name}</div>
                          <div className="text-[11px] text-gray-500 font-medium">
                            Qty: <span className="font-bold text-gray-800">{item.quantity}</span> × ₹{item.price}
                          </div>
                        </div>
                      </div>
                      <div className="font-black text-gray-900 text-sm">₹{item.total}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Invoice Breakdown */}
              <div className="rounded-2xl bg-gray-50 p-4 border border-gray-100 space-y-2 text-xs">
                <div className="flex justify-between text-gray-600">
                  <span>Payment Method</span>
                  <span className="font-bold text-gray-900">{selectedOrder.payment_method}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Shipping Fee</span>
                  <span className="font-bold text-gray-900">₹{selectedOrder.shipping_total}</span>
                </div>
                <div className="flex justify-between border-t border-gray-200 pt-2 text-sm font-black text-gray-900">
                  <span>Total Amount</span>
                  <span>₹{selectedOrder.total}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
              <button
                onClick={() => setSelectedOrder(null)}
                className="rounded-xl border border-gray-200 px-5 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Orders;
