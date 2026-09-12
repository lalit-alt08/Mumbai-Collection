import { useEffect, useState, useMemo, useRef } from "react";
import {
  Users,
  Search,
  Phone,
  Mail,
  MapPin,
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
  ArrowUpDown,
  Filter,
  Sparkles,
  ChevronDown,
  Check,
} from "lucide-react";
import { getCustomers } from "../services/adminApi";

// Fixed delivery zone filter options
const LOCATION_FILTER_OPTIONS = [
  {
    id: "all",
    label: "All Locations",
    keywords: [],
  },
  {
    id: "vasai-east",
    label: "Vasai East",
    keywords: ["vasai east", "vasai (e)", "vasai-east", "evershine", "navghar", "401202", "401208"],
  },
  {
    id: "vasai-west",
    label: "Vasai West",
    keywords: ["vasai west", "vasai (w)", "vasai-west", "chulna", "babola", "ambadi", "401201"],
  },
  {
    id: "nallasopara-east",
    label: "Nallasopara East",
    keywords: [
      "nallasopara east",
      "nalasopara east",
      "nallasopara (e)",
      "nalasopara (e)",
      "achole",
      "moregaon",
      "401209",
    ],
  },
  {
    id: "nallasopara-west",
    label: "Nallasopara West",
    keywords: [
      "nallasopara west",
      "nalasopara west",
      "nallasopara (w)",
      "nalasopara (w)",
      "sopara west",
      "patankar",
      "401203",
    ],
  },
];

const SORT_OPTIONS = [
  { id: "ltv_desc", label: "Highest LTV", hint: "High to low spend" },
  { id: "ltv_asc", label: "Lowest LTV", hint: "Low to high spend" },
  { id: "orders_desc", label: "Most Orders", hint: "Frequent buyers" },
  { id: "recent", label: "Most Recent", hint: "Latest order date" },
  { id: "name_asc", label: "Name (A–Z)", hint: "Alphabetical" },
];

function Customers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const requestIdRef = useRef(0);
  const [sortBy, setSortBy] = useState("ltv_desc");
  const [selectedLocation, setSelectedLocation] = useState("all");

  // Dropdown open states
  const [isLocationOpen, setIsLocationOpen] = useState(false);
  const [isSortOpen, setIsSortOpen] = useState(false);

  const locationDropdownRef = useRef(null);
  const sortDropdownRef = useRef(null);

  // Pagination state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCustomers, setTotalCustomers] = useState(0);
  const perPage = 20;

  // Selected customer for Profile Modal
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  // Close dropdowns on outside click or Escape
  useEffect(() => {
    function handleClickOutside(e) {
      if (locationDropdownRef.current && !locationDropdownRef.current.contains(e.target)) {
        setIsLocationOpen(false);
      }
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target)) {
        setIsSortOpen(false);
      }
    }

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        setIsLocationOpen(false);
        setIsSortOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Debounce search query (350ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      const normalized = searchQuery.trim();
      setDebouncedSearch(normalized.length >= 2 ? normalized : "");
      setPage(1);
    }, 350);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Fetch Customers with server pagination & search
  const fetchCustomerList = async () => {
    const requestId = ++requestIdRef.current;
    try {
      setLoading(true);
      setError("");
      const res = await getCustomers({
        page,
        per_page: perPage,
        search: debouncedSearch.trim() || undefined,
        location: selectedLocation !== "all" ? selectedLocation : undefined,
      });

      if (res.success && Array.isArray(res.customers)) {
        if (requestId !== requestIdRef.current) return;
        setCustomers(res.customers);
        setTotalPages(res.totalPages || 1);
        setTotalCustomers(res.total || res.customers.length);
      } else {
        setCustomers([]);
        setTotalPages(1);
        setTotalCustomers(0);
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError("Failed to load customers directory. Please refresh.");
      setCustomers([]);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomerList();
  }, [page, debouncedSearch, selectedLocation]);

  // Client-side filtering & sorting
  const processedCustomers = useMemo(() => {
    let list = [...customers];

    // Sorting
    list.sort((a, b) => {
      if (sortBy === "ltv_desc") return (b.lifetimeSpent || 0) - (a.lifetimeSpent || 0);
      if (sortBy === "ltv_asc") return (a.lifetimeSpent || 0) - (b.lifetimeSpent || 0);
      if (sortBy === "orders_desc") return (b.ordersCount || 0) - (a.ordersCount || 0);
      if (sortBy === "recent") {
        const dateA = a.lastOrderDate ? new Date(a.lastOrderDate).getTime() : 0;
        const dateB = b.lastOrderDate ? new Date(b.lastOrderDate).getTime() : 0;
        return dateB - dateA;
      }
      if (sortBy === "name_asc") {
        return (a.name || "").localeCompare(b.name || "");
      }
      return 0;
    });

    return list;
  }, [customers, sortBy]);

  // Format IST Date helper
  const formatISTDate = (dateStr) => {
    if (!dateStr) return "No orders yet";
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return "N/A";
      return d.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return "N/A";
    }
  };

  const getStatusBadge = (status) => {
    const s = String(status || "").toLowerCase();
    if (s === "completed" || s === "delivered") {
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    }
    if (s === "processing" || s === "out-for-delivery" || s === "out_for_delivery") {
      return "bg-blue-50 text-blue-700 border-blue-200";
    }
    if (s === "cancelled" || s === "failed" || s === "refunded") {
      return "bg-rose-50 text-rose-700 border-rose-200";
    }
    return "bg-amber-50 text-amber-700 border-amber-200";
  };

  const activeSortLabel = SORT_OPTIONS.find((s) => s.id === sortBy)?.label || "Sort by";
  const activeLocationLabel = LOCATION_FILTER_OPTIONS.find((l) => l.id === selectedLocation)?.label || "All Locations";

  return (
    <div className="space-y-6">
      {/* HEADER & TOP STATS STRIP */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-gray-900">
              Customer Directory
            </h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-black text-[#FF8A00] border border-amber-200/60 shadow-xs">
              <Sparkles size={12} className="text-[#FF8A00]" />
              {totalCustomers} Registered
            </span>
          </div>
          <p className="mt-0.5 text-xs text-gray-500 font-medium">
            Registered customer accounts, lifetime order metrics, and purchase history.
          </p>
        </div>

        <button
          onClick={fetchCustomerList}
          disabled={loading}
          className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-bold text-gray-700 shadow-xs hover:border-[#FF8A00] hover:text-[#FF8A00] hover:bg-amber-50/40 transition active:scale-95 disabled:opacity-50"
        >
          <RotateCcw size={13} className={loading ? "animate-spin text-[#FF8A00]" : ""} />
          <span>Refresh</span>
        </button>
      </div>

      {/* FILTER & SEARCH CONTROLS BAR */}
      <div className="rounded-2xl border border-gray-200/80 bg-white p-3.5 sm:p-4 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by customer name, phone, email, or address..."
              className="w-full h-10 rounded-xl border border-gray-200 bg-gray-50/50 pl-9 pr-9 text-xs text-gray-900 placeholder-gray-400 focus:border-[#FF8A00] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF8A00]/15 transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Location & Sort Dropdowns */}
          <div className="flex items-center gap-2">
            {/* Location Filter Dropdown */}
            <div className="relative flex-1 sm:flex-none" ref={locationDropdownRef}>
              <button
                type="button"
                onClick={() => {
                  setIsLocationOpen((prev) => !prev);
                  setIsSortOpen(false);
                }}
                className={`flex h-10 w-full sm:w-auto items-center justify-between gap-2 rounded-xl border px-3 text-xs font-bold transition shadow-xs ${
                  selectedLocation !== "all"
                    ? "border-[#FF8A00] bg-amber-50/50 text-[#FF8A00]"
                    : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <MapPin size={13} className={selectedLocation !== "all" ? "text-[#FF8A00]" : "text-gray-400"} />
                  <span className="truncate">{activeLocationLabel}</span>
                </div>
                <ChevronDown size={13} className={`text-gray-400 transition-transform ${isLocationOpen ? "rotate-180" : ""}`} />
              </button>

              {isLocationOpen && (
                <div className="absolute right-0 mt-1.5 w-52 rounded-2xl border border-gray-100 bg-white py-1.5 shadow-xl z-30 animate-in fade-in-50 zoom-in-95">
                  <div className="px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                    Filter by Location
                  </div>
                  {LOCATION_FILTER_OPTIONS.map((loc) => (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => {
                        setSelectedLocation(loc.id);
                        setPage(1);
                        setIsLocationOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-left transition ${
                        selectedLocation === loc.id
                          ? "bg-amber-50 text-[#FF8A00] font-bold"
                          : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <span>{loc.label}</span>
                      {selectedLocation === loc.id && <Check size={13} className="text-[#FF8A00]" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Sort Dropdown */}
            <div className="relative flex-1 sm:flex-none" ref={sortDropdownRef}>
              <button
                type="button"
                onClick={() => {
                  setIsSortOpen((prev) => !prev);
                  setIsLocationOpen(false);
                }}
                className={`flex h-10 w-full sm:w-auto items-center justify-between gap-2 rounded-xl border px-3 text-xs font-bold transition shadow-xs ${
                  sortBy !== "ltv_desc"
                    ? "border-[#FF8A00] bg-amber-50/50 text-[#FF8A00]"
                    : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <ArrowUpDown size={13} className={sortBy !== "ltv_desc" ? "text-[#FF8A00]" : "text-gray-400"} />
                  <span className="truncate">{activeSortLabel}</span>
                </div>
                <ChevronDown size={13} className={`text-gray-400 transition-transform ${isSortOpen ? "rotate-180" : ""}`} />
              </button>

              {isSortOpen && (
                <div className="absolute right-0 mt-1.5 w-48 rounded-2xl border border-gray-100 bg-white py-1.5 shadow-xl z-30 animate-in fade-in-50 zoom-in-95">
                  <div className="px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                    Sort Customers
                  </div>
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setSortBy(opt.id);
                        setIsSortOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-left transition ${
                        sortBy === opt.id
                          ? "bg-amber-50 text-[#FF8A00] font-bold"
                          : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <div>
                        <div>{opt.label}</div>
                        <div className="text-[10px] text-gray-400 font-normal">{opt.hint}</div>
                      </div>
                      {sortBy === opt.id && <Check size={13} className="text-[#FF8A00] flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ERROR BANNER */}
      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={fetchCustomerList}
            className="underline font-bold hover:text-rose-900"
          >
            Retry
          </button>
        </div>
      )}

      {/* CUSTOMER DIRECTORY DATA TABLE */}
      <div className="rounded-2xl border border-gray-200/80 bg-white shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="inline-flex h-10 w-10 animate-spin items-center justify-center rounded-full border-3 border-[#FF8A00] border-t-transparent mb-3" />
            <p className="text-xs font-bold text-gray-600">Loading registered customers...</p>
          </div>
        ) : processedCustomers.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Users size={32} className="mx-auto text-gray-300" />
            <h3 className="text-sm font-bold text-gray-800">No Customers Found</h3>
            <p className="text-xs text-gray-500 max-w-sm mx-auto">
              {debouncedSearch
                ? `No customers matched "${debouncedSearch}". Try checking the spelling or clear the search.`
                : "No registered customers found in this filter."}
            </p>
            {debouncedSearch && (
              <button
                onClick={() => setSearchQuery("")}
                className="mt-2 inline-flex items-center gap-1 rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-200 transition"
              >
                Clear Search
              </button>
            )}
          </div>
        ) : (
          <div>
            {/* DESKTOP TABLE */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-gray-200/80 bg-gray-50/75 text-[11px] font-black uppercase tracking-wider text-gray-500">
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4">Location</th>
                    <th className="py-3 px-4 text-center">Orders</th>
                    <th className="py-3 px-4">LTV</th>
                    <th className="py-3 px-4">Last Order</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-medium">
                  {processedCustomers.map((c, idx) => {
                    const initials = (c.name || "Customer")
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase();

                    return (
                      <tr key={c.id || c.email || idx} className="hover:bg-amber-50/30 transition">
                        {/* Customer Avatar & Name */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-[#FF8A00] to-[#FFA726] text-white font-black text-xs shadow-sm flex-shrink-0">
                              {initials}
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-gray-900 truncate max-w-[150px] text-xs flex items-center gap-1.5">
                                <span className="truncate">{c.name || "Customer"}</span>
                              </div>
                              <span className="inline-block text-[10px] font-semibold text-gray-400">
                                ID: {c.id || "N/A"}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Account Status Badge */}
                        <td className="py-3.5 px-4">
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-700 border border-emerald-200">
                            <CheckCircle2 size={10} />
                            <span>Active</span>
                          </span>
                        </td>

                        {/* Contact Info */}
                        <td className="py-3.5 px-4">
                          <div className="flex flex-col gap-0.5">
                            {c.phone ? (
                              <a
                                href={`tel:${c.phone}`}
                                className="inline-flex items-center gap-1 text-gray-900 font-bold hover:text-[#FF8A00] transition group text-xs"
                              >
                                <Phone size={11} className="text-gray-400 group-hover:text-[#FF8A00]" />
                                <span>{c.phone}</span>
                              </a>
                            ) : (
                              <span className="text-[10px] text-gray-400">No phone</span>
                            )}
                            <span className="flex items-center gap-1 text-[11px] text-gray-500 truncate max-w-[180px]">
                              <Mail size={11} className="text-gray-400 flex-shrink-0" />
                              <span className="truncate">{c.email || "N/A"}</span>
                            </span>
                          </div>
                        </td>

                        {/* Location */}
                        <td className="py-3.5 px-4">
                          <span className="inline-flex items-center gap-1 text-gray-700 text-[11px]">
                            <MapPin size={11} className="text-[#FF8A00] flex-shrink-0" />
                            <span className="truncate max-w-[140px]">{c.location || "Vasai, Maharashtra"}</span>
                          </span>
                        </td>

                        {/* Orders Count */}
                        <td className="py-3.5 px-4 text-center">
                          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-bold text-gray-800 border border-gray-200">
                            <Package size={11} className="text-gray-500" />
                            {c.ordersCount || 0}
                          </span>
                        </td>

                        {/* LTV */}
                        <td className="py-3.5 px-4">
                          <div className="font-black text-gray-900 text-xs tracking-tight">
                            ₹{(c.lifetimeSpent || 0).toLocaleString("en-IN")}
                          </div>
                        </td>

                        {/* Last Order Date */}
                        <td className="py-3.5 px-4 text-gray-500 text-[11px]">
                          <div className="flex items-center gap-1">
                            <Calendar size={11} className="text-gray-400" />
                            {formatISTDate(c.lastOrderDate)}
                          </div>
                        </td>

                        {/* Action Buttons */}
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => setSelectedCustomer(c)}
                            className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-gray-700 shadow-sm hover:border-[#FF8A00] hover:text-[#FF8A00] hover:bg-amber-50/50 transition active:scale-95"
                          >
                            <Eye size={12} className="text-[#FF8A00]" />
                            <span>History</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* MOBILE STACKED CARDS (Zero Horizontal Scroll) */}
            <div className="block sm:hidden divide-y divide-gray-100">
              {processedCustomers.map((c, idx) => {
                const initials = (c.name || "Customer")
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();

                return (
                  <div key={c.id || c.email || idx} className="p-3.5 space-y-3 bg-white hover:bg-gray-50/60 transition">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-[#FF8A00] to-[#FFA726] text-white font-black text-xs shadow-sm flex-shrink-0">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-bold text-gray-900 text-xs truncate">{c.name || "Customer"}</h4>
                          <p className="text-[10px] text-gray-400 font-medium">ID: {c.id || "N/A"}</p>
                        </div>
                      </div>

                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-extrabold text-emerald-700 border border-emerald-200">
                        <CheckCircle2 size={8} /> Active
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] bg-gray-50/70 p-2.5 rounded-xl border border-gray-100">
                      <div>
                        <span className="text-[10px] text-gray-400 block font-semibold uppercase">Lifetime Value</span>
                        <span className="font-black text-gray-900 text-xs">₹{(c.lifetimeSpent || 0).toLocaleString("en-IN")}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-gray-400 block font-semibold uppercase">Total Orders</span>
                        <span className="font-black text-[#FF8A00] text-xs">{c.ordersCount || 0} orders</span>
                      </div>
                      <div className="col-span-2 pt-1 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-500">
                        <span className="truncate">{c.location || "Vasai, Maharashtra"}</span>
                        <span>{formatISTDate(c.lastOrderDate)}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <div className="text-[11px] text-gray-500 truncate max-w-[170px]">
                        {c.phone || c.email || "No contact info"}
                      </div>

                      <button
                        onClick={() => setSelectedCustomer(c)}
                        className="inline-flex items-center gap-1 rounded-xl bg-amber-500/10 px-3 py-1 text-[11px] font-bold text-[#FF8A00] hover:bg-[#FF8A00] hover:text-white transition"
                      >
                        <Eye size={12} />
                        <span>View Orders</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* PAGINATION BAR */}
            <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 bg-gray-50/40 text-xs">
              <span className="text-gray-500 font-medium text-[11px]">
                Page <strong className="text-gray-900">{page}</strong> of <strong className="text-gray-900">{totalPages}</strong>
              </span>

              <div className="flex items-center gap-1.5">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-bold text-gray-700 shadow-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-95"
                >
                  <ChevronLeft size={14} /> Prev
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-bold text-gray-700 shadow-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-95"
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Customer Profile & Purchase History Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-2xl max-h-[92vh] flex flex-col rounded-3xl bg-white shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-gray-100 p-4 sm:p-6 bg-gradient-to-b from-gray-50/80 to-white">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#FF8A00] to-[#FFA726] text-white font-black text-base shadow-sm flex-shrink-0">
                  {(selectedCustomer.name || "Customer").slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base sm:text-lg font-black text-gray-900 truncate">
                      {selectedCustomer.name}
                    </h3>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700 border border-emerald-200">
                      <CheckCircle2 size={9} /> Active
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 font-medium">Customer ID: {selectedCustomer.id || "N/A"}</p>
                </div>
              </div>

              <button
                onClick={() => setSelectedCustomer(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 text-xs">
              {/* Financial Metrics Strip */}
              <div className="grid grid-cols-3 gap-2.5 rounded-2xl bg-amber-50/40 p-3 sm:p-4 border border-amber-100/70 text-center">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Lifetime Spend</span>
                  <div className="text-sm sm:text-base font-black text-gray-900 mt-0.5">
                    ₹{(selectedCustomer.lifetimeSpent || 0).toLocaleString("en-IN")}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Total Orders</span>
                  <div className="text-sm sm:text-base font-black text-[#FF8A00] mt-0.5">
                    {selectedCustomer.ordersCount || 0}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Average Basket</span>
                  <div className="text-sm sm:text-base font-black text-gray-900 mt-0.5">
                    ₹{selectedCustomer.ordersCount > 0 ? Math.round(selectedCustomer.lifetimeSpent / selectedCustomer.ordersCount).toLocaleString("en-IN") : 0}
                  </div>
                </div>
              </div>

              {/* Contact & Address Details */}
              <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-4 space-y-2.5">
                <h4 className="font-extrabold uppercase tracking-wider text-gray-400 text-[10px]">
                  Contact & Shipping Details
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <span className="text-gray-400 block text-[10px] font-bold uppercase">Email Address</span>
                    <span className="font-bold text-gray-900 break-all">{selectedCustomer.email || "N/A"}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block text-[10px] font-bold uppercase">Phone Number</span>
                    {selectedCustomer.phone ? (
                      <a href={`tel:${selectedCustomer.phone}`} className="font-bold text-[#FF8A00] hover:underline inline-flex items-center gap-1">
                        <Phone size={12} /> {selectedCustomer.phone}
                      </a>
                    ) : (
                      <span className="text-gray-400">Not provided</span>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-gray-400 block text-[10px] font-bold uppercase">Delivery Address</span>
                    <span className="font-medium text-gray-700 leading-relaxed block mt-0.5">
                      {selectedCustomer.full_address || selectedCustomer.location}
                    </span>
                  </div>
                </div>
              </div>

              {/* Order History */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-extrabold uppercase tracking-wider text-gray-400 text-[10px] flex items-center gap-1.5">
                    <ShoppingBag size={13} className="text-[#FF8A00]" /> Past Purchases ({selectedCustomer.orders?.length || 0})
                  </h4>
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {(selectedCustomer.orders || []).length === 0 ? (
                    <div className="p-4 text-center text-xs text-gray-400 bg-gray-50 rounded-xl">
                      No past orders recorded for this profile.
                    </div>
                  ) : (
                    (selectedCustomer.orders || []).map((o) => (
                      <div
                        key={o.id}
                        className="flex items-center justify-between rounded-xl bg-gray-50/80 p-3 border border-gray-100 hover:bg-gray-100/60 transition"
                      >
                        <div className="space-y-0.5">
                          <div className="font-bold text-gray-900 text-xs">Order #{o.order_number}</div>
                          <div className="text-[10px] text-gray-500">
                            {formatISTDate(o.date)} • {o.payment_method}
                          </div>
                        </div>

                        <div className="text-right space-y-1">
                          <div className="font-black text-gray-900 text-xs">₹{Number(o.total || 0).toLocaleString("en-IN")}</div>
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase border ${getStatusBadge(
                              o.status
                            )}`}
                          >
                            {o.status}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end border-t border-gray-100 p-4 bg-gray-50/60">
              <button
                onClick={() => setSelectedCustomer(null)}
                className="rounded-xl border border-gray-200 bg-white px-5 py-2 text-xs font-bold text-gray-700 shadow-xs hover:bg-gray-50 transition"
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
