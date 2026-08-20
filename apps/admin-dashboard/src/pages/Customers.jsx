import { useEffect, useState } from "react";
import {
  Users,
  Search,
  Phone,
  Mail,
  MapPin,
  IndianRupee,
  RotateCcw,
  Package,
  ChevronLeft,
  ChevronRight,
  Eye,
  X,
  Clock,
  CheckCircle2,
  Calendar,
  ShoppingBag,
} from "lucide-react";
import { getCustomers } from "../services/adminApi";

function Customers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Pagination state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCustomers, setTotalCustomers] = useState(0);
  const perPage = 20;

  // Selected customer for Profile Modal
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  // Debounce search input by 400ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPage(1);
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchCustomerList = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await getCustomers({
        page,
        per_page: perPage,
        search: debouncedSearch || undefined,
      });
      if (res.success) {
        setCustomers(res.customers || []);
        setTotalCustomers(res.total || res.customers?.length || 0);
        setTotalPages(res.totalPages || Math.ceil((res.total || 1) / perPage) || 1);
      }
    } catch (err) {
      console.error("Fetch customers error:", err);
      setError(err.response?.data?.message || err.message || "Failed to load customer directory.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomerList();
  }, [debouncedSearch, page]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 md:text-3xl">
            Customer Directory & LTV
          </h1>
          <p className="text-xs font-medium text-gray-500 mt-1">
            Server-side search, lifetime purchase value, and purchase history
          </p>
        </div>

        <button
          onClick={fetchCustomerList}
          className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold text-gray-700 shadow-sm transition hover:bg-gray-50"
        >
          <RotateCcw size={14} /> Refresh
        </button>
      </div>

      {/* Server Search Bar */}
      <div className="flex rounded-2xl bg-white p-4 shadow-sm border border-gray-100 sm:w-96">
        <div className="relative w-full">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search all customers (server-side)..."
            className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 text-xs font-medium text-gray-800 placeholder-gray-400 focus:border-[#FF8A00] focus:bg-white focus:outline-none transition"
          />
        </div>
      </div>

      {/* Customers Table */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm border border-gray-100">
        {loading ? (
          <div className="p-12 text-center text-xs font-semibold text-gray-500">
            Loading customer records...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-xs font-semibold text-red-600">{error}</div>
        ) : customers.length === 0 ? (
          <div className="p-12 text-center text-xs font-medium text-gray-500">
            No customer records found matching current criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-gray-100 bg-gray-50/50 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="py-3.5 px-4">Customer</th>
                  <th className="py-3.5 px-4">Contact Info</th>
                  <th className="py-3.5 px-4">Location</th>
                  <th className="py-3.5 px-4">Total Orders</th>
                  <th className="py-3.5 px-4">Lifetime Spend (LTV)</th>
                  <th className="py-3.5 px-4">Last Order</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium">
                {customers.map((c, idx) => (
                  <tr key={c.id || c.email || idx} className="hover:bg-gray-50/60 transition">
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-tr from-[#FF8A00] to-[#FFA726] text-white font-bold text-xs shadow-sm flex-shrink-0">
                          {(c.name || "Customer").slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-bold text-gray-900">{c.name || "Customer"}</div>
                          <div className="text-[10px] text-gray-400">ID: {c.id || "Guest"}</div>
                        </div>
                      </div>
                    </td>

                    <td className="py-4 px-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1 text-gray-700">
                          <Mail size={12} className="text-gray-400" /> {c.email || "N/A"}
                        </span>
                        {c.phone ? (
                          <a
                            href={`tel:${c.phone}`}
                            className="flex items-center gap-1 text-[#FF8A00] font-bold hover:underline"
                          >
                            <Phone size={12} /> {c.phone}
                          </a>
                        ) : (
                          <span className="text-[10px] text-gray-400">No phone</span>
                        )}
                      </div>
                    </td>

                    <td className="py-4 px-4 text-gray-600">
                      <span className="flex items-center gap-1">
                        <MapPin size={12} className="text-gray-400" /> {c.location || "Vasai, Maharashtra"}
                      </span>
                    </td>

                    <td className="py-4 px-4">
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-800">
                        <Package size={12} /> {c.ordersCount || 0} order{(c.ordersCount || 0) !== 1 ? "s" : ""}
                      </span>
                    </td>

                    <td className="py-4 px-4 font-black text-gray-900 text-sm">
                      ₹{(c.lifetimeSpent || 0).toLocaleString("en-IN")}
                    </td>

                    <td className="py-4 px-4 text-gray-500 text-[11px]">
                      {c.lastOrderDate
                        ? new Date(c.lastOrderDate).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "N/A"}
                    </td>

                    <td className="py-4 px-4 text-right">
                      <button
                        onClick={() => setSelectedCustomer(c)}
                        className="rounded-xl border border-gray-200 px-3.5 py-1.5 text-[11px] font-bold text-gray-700 hover:bg-gray-100 transition"
                      >
                        <Eye size={12} className="inline mr-1 text-[#FF8A00]" /> View History
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {!loading && !error && totalCustomers > 0 && (
          <div className="flex flex-col gap-3 border-t border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between text-xs text-gray-500 font-medium">
            <div>
              Showing <span className="font-bold text-gray-800">{(page - 1) * perPage + 1}</span> to{" "}
              <span className="font-bold text-gray-800">
                {Math.min(page * perPage, totalCustomers)}
              </span>{" "}
              of <span className="font-bold text-gray-800">{totalCustomers}</span> customers
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

      {/* Customer Profile & Order History Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#FF8A00] to-[#FFA726] text-white font-black text-base shadow-sm">
                  {(selectedCustomer.name || "Customer").slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-lg font-black text-gray-900">{selectedCustomer.name}</h3>
                  <p className="text-xs text-gray-500 font-medium">Customer ID: {selectedCustomer.id}</p>
                </div>
              </div>

              <button
                onClick={() => setSelectedCustomer(null)}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="my-6 space-y-5 text-xs">
              {/* Financial Metrics Strip */}
              <div className="grid grid-cols-3 gap-3 rounded-2xl bg-gray-50 p-4 border border-gray-100 text-center">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Total Lifetime Spend</span>
                  <div className="text-base font-black text-gray-900 mt-0.5">
                    ₹{(selectedCustomer.lifetimeSpent || 0).toLocaleString("en-IN")}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Total Orders</span>
                  <div className="text-base font-black text-[#FF8A00] mt-0.5">
                    {selectedCustomer.ordersCount || 0}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Average Basket</span>
                  <div className="text-base font-black text-gray-900 mt-0.5">
                    ₹{selectedCustomer.ordersCount > 0 ? Math.round(selectedCustomer.lifetimeSpent / selectedCustomer.ordersCount) : 0}
                  </div>
                </div>
              </div>

              {/* Contact & Address Details */}
              <div className="rounded-2xl border border-gray-100 p-4 space-y-2">
                <h4 className="font-bold uppercase tracking-wider text-gray-400 text-[11px]">
                  Contact & Shipping Address
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <span className="text-gray-500 block text-[10px]">Email Address</span>
                    <span className="font-bold text-gray-900">{selectedCustomer.email}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block text-[10px]">Phone Number</span>
                    {selectedCustomer.phone ? (
                      <a href={`tel:${selectedCustomer.phone}`} className="font-bold text-[#FF8A00] hover:underline">
                        {selectedCustomer.phone}
                      </a>
                    ) : (
                      <span className="text-gray-400">Not provided</span>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-gray-500 block text-[10px]">Full Address</span>
                    <span className="font-medium text-gray-700 leading-relaxed">
                      {selectedCustomer.full_address || selectedCustomer.location}
                    </span>
                  </div>
                </div>
              </div>

              {/* Order History */}
              <div className="space-y-3">
                <h4 className="font-bold uppercase tracking-wider text-gray-400 text-[11px] flex items-center gap-1.5">
                  <ShoppingBag size={14} className="text-[#FF8A00]" /> Past Purchases ({selectedCustomer.orders?.length || 0})
                </h4>

                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {(selectedCustomer.orders || []).map((o) => (
                    <div
                      key={o.id}
                      className="flex items-center justify-between rounded-xl bg-gray-50 p-3 border border-gray-100"
                    >
                      <div>
                        <div className="font-bold text-gray-900">Order #{o.order_number}</div>
                        <div className="text-[10px] text-gray-500">
                          {new Date(o.date).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}{" "}
                          • {o.payment_method}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="font-black text-gray-900">₹{o.total}</div>
                        <span className="inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700 uppercase border border-emerald-200">
                          {o.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end border-t border-gray-100 pt-4">
              <button
                onClick={() => setSelectedCustomer(null)}
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

export default Customers;
