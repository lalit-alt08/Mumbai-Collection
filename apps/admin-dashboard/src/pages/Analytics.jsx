import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  IndianRupee,
  PackageSearch,
  RotateCcw,
  Search,
  ShoppingBag,
  TrendingUp,
  X,
} from "lucide-react";
import { getAnalyticsReport, getProducts } from "../services/adminApi";
import DateRangePicker from "../components/common/DateRangePicker";

const ANALYTICS_PRESETS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7", label: "7 days" },
  { id: "month", label: "This month" },
  { id: "last30", label: "30 days" },
  { id: "year", label: "This year" },
];

const getISTDate = (date = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(date);

const formatRupees = (value) => `₹${Math.round(Number(value) || 0).toLocaleString("en-IN")}`;
const formatDay = (date) => new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
}).format(new Date(`${date}T12:00:00+05:30`));

function Analytics() {
  const today = getISTDate();
  const [dateFrom, setDateFrom] = useState(`${today.slice(0, 7)}-01`);
  const [dateTo, setDateTo] = useState(today);
  const [activePreset, setActivePreset] = useState("month");
  const [appliedRange, setAppliedRange] = useState({ from: `${today.slice(0, 7)}-01`, to: today });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [productQuery, setProductQuery] = useState("");
  const [productOptions, setProductOptions] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [appliedProduct, setAppliedProduct] = useState(null);
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const searchRequestId = useRef(0);
  const productSearchAbortRef = useRef(null);
  const reportAbortRef = useRef(null);

  useEffect(() => {
    if (productQuery.trim().length < 2 || productQuery === selectedProduct?.name) {
      setProductOptions([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      productSearchAbortRef.current?.abort();
      const controller = new AbortController();
      productSearchAbortRef.current = controller;
      const requestId = ++searchRequestId.current;
      try {
        setProductSearchLoading(true);
        const result = await getProducts(
          { search: productQuery.trim(), page: 1, per_page: 10 },
          { signal: controller.signal }
        );
        if (requestId === searchRequestId.current && !controller.signal.aborted) {
          setProductOptions(result.products || []);
        }
      } catch (err) {
        if (controller.signal.aborted || err.name === "CanceledError" || err.code === "ERR_CANCELED") return;
        if (requestId === searchRequestId.current) setProductOptions([]);
      } finally {
        if (requestId === searchRequestId.current && !controller.signal.aborted) {
          setProductSearchLoading(false);
        }
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      productSearchAbortRef.current?.abort();
    };
  }, [productQuery, selectedProduct]);

  useEffect(() => {
    reportAbortRef.current?.abort();
    const controller = new AbortController();
    reportAbortRef.current = controller;
    let active = true;
    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const result = await getAnalyticsReport(
          {
            date_from: appliedRange.from,
            date_to: appliedRange.to,
            product_id: appliedProduct?.id,
            refresh: refreshTick ? "true" : undefined,
          },
          { signal: controller.signal }
        );
        if (active && !controller.signal.aborted && result?.success) setReport(result.data);
        else if (active && !controller.signal.aborted) throw new Error(result?.message || "Unable to load report.");
      } catch (requestError) {
        if (!active || controller.signal.aborted || requestError.name === "CanceledError" || requestError.code === "ERR_CANCELED") return;
        setError(requestError.response?.data?.message || requestError.message || "Unable to load sales report.");
      } finally {
        if (active && !controller.signal.aborted) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [appliedRange, appliedProduct, refreshTick]);

  const daily = report?.daily || EMPTY_ARRAY;
  const products = report?.products || [];
  const maxDailyRevenue = Math.max(1, ...daily.map((entry) => Number(entry.revenue) || 0));

  const applyRange = () => {
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      setError("Choose a valid date range. The start date must not be after the end date.");
      return;
    }
    setAppliedRange({ from: dateFrom, to: dateTo });
    setAppliedProduct(selectedProduct);
    setRefreshTick((tick) => tick + 1);
  };

  const setPreset = (preset) => {
    const now = new Date();
    const to = getISTDate(now);
    let from = to;
    let finalTo = to;

    if (preset === "today") {
      from = to;
    } else if (preset === "yesterday") {
      const yesterdayDate = new Date(`${to}T12:00:00+05:30`);
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      from = getISTDate(yesterdayDate);
      finalTo = from;
    } else if (preset === "last7") {
      const fromDate = new Date(`${to}T12:00:00+05:30`);
      fromDate.setDate(fromDate.getDate() - 6);
      from = getISTDate(fromDate);
    } else if (preset === "last30") {
      const fromDate = new Date(`${to}T12:00:00+05:30`);
      fromDate.setDate(fromDate.getDate() - 29);
      from = getISTDate(fromDate);
    } else if (preset === "month") {
      const fromDate = new Date(`${to}T12:00:00+05:30`);
      fromDate.setDate(1);
      from = getISTDate(fromDate);
    } else if (preset === "year") {
      const fromDate = new Date(`${to}T12:00:00+05:30`);
      fromDate.setMonth(0, 1);
      from = getISTDate(fromDate);
    }

    setDateFrom(from);
    setDateTo(finalTo);
    setActivePreset(preset);
    setAppliedRange({ from, to: finalTo });
    setAppliedProduct(selectedProduct);
    setRefreshTick((tick) => tick + 1);
  };

  const handleCustomRangeApply = (newFrom, newTo) => {
    setDateFrom(newFrom);
    setDateTo(newTo);
    setActivePreset("custom");
    setAppliedRange({ from: newFrom, to: newTo });
    setAppliedProduct(selectedProduct);
    setRefreshTick((tick) => tick + 1);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 md:text-3xl">Sales Analytics</h1>
          <p className="mt-1 text-sm text-gray-500">Explore order and product sales without changing your WooCommerce history.</p>
        </div>
        <button
          onClick={() => setRefreshTick((tick) => tick + 1)}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
        >
          <RotateCcw size={15} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5 space-y-4">
        {/* Top Header Row: Filter Title + Quick Preset Pills */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-gray-100 pb-3.5">
          <div className="flex items-center gap-2 text-sm font-black text-gray-900">
            <CalendarDays size={18} className="text-[#FF8A00]" />
            <span>Report Filters</span>
          </div>

          {/* Quick Preset Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            {ANALYTICS_PRESETS.map((preset) => {
              const isSelected = activePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setPreset(preset.id)}
                  className={`h-8 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 ${
                    isSelected
                      ? "bg-orange-50 text-orange-700 border border-orange-200 shadow-2xs font-extrabold"
                      : "bg-gray-50/80 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Controls Row: Custom Date Range Picker + Product Search + Apply */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.3fr_1.3fr_auto] items-end">
          {/* Custom Date Range Picker Component */}
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1.5">
              Date Range
            </label>
            <DateRangePicker
              dateFrom={dateFrom}
              dateTo={dateTo}
              maxDate={today}
              presets={ANALYTICS_PRESETS}
              activePreset={activePreset}
              onPresetSelect={setPreset}
              onApply={handleCustomRangeApply}
            />
          </div>

          {/* Optional Product Search */}
          <div className="relative">
            <label className="block text-xs font-bold text-gray-500 mb-1.5" htmlFor="analytics-product-search">
              Product Filter <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <div className="relative">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="analytics-product-search"
                value={productQuery}
                onChange={(event) => {
                  setProductQuery(event.target.value);
                  setSelectedProduct(null);
                }}
                placeholder="Search product name…"
                className="h-[44px] w-full rounded-2xl border border-gray-200 bg-white pl-10 pr-9 text-xs sm:text-sm font-semibold text-gray-800 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 transition shadow-xs"
              />
              {selectedProduct && (
                <button
                  aria-label="Clear product filter"
                  onClick={() => {
                    setSelectedProduct(null);
                    setProductQuery("");
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 p-0.5 rounded-md cursor-pointer"
                >
                  <X size={15} />
                </button>
              )}
              {productQuery.trim().length >= 2 && productQuery !== selectedProduct?.name && (
                <div className="absolute z-30 mt-1.5 max-h-56 w-full overflow-y-auto rounded-2xl border border-gray-200 bg-white p-1.5 shadow-xl animate-in fade-in duration-150">
                  {productSearchLoading ? (
                    <p className="p-3 text-xs text-gray-500 font-medium">Searching products…</p>
                  ) : productOptions.length ? (
                    productOptions.map((product) => (
                      <button
                        key={product.id}
                        onClick={() => {
                          setSelectedProduct(product);
                          setProductQuery(product.name);
                          setProductOptions([]);
                        }}
                        className="block w-full rounded-xl px-3 py-2 text-left text-xs sm:text-sm font-semibold text-gray-700 hover:bg-orange-50 hover:text-orange-900 transition cursor-pointer"
                      >
                        {product.name}{" "}
                        <span className="text-xs font-normal text-gray-400">
                          #{product.id}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="p-3 text-xs text-gray-500 font-medium">No matching products.</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Apply Filter Button */}
          <div className="sm:col-span-2 lg:col-span-1">
            <button
              onClick={applyRange}
              disabled={loading}
              className="h-[44px] w-full sm:w-auto px-6 rounded-2xl bg-[#FF8A00] hover:bg-orange-600 text-sm font-extrabold text-white shadow-xs transition cursor-pointer disabled:opacity-50 active:scale-95 flex items-center justify-center gap-2"
            >
              <span>Apply Filters</span>
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading && !report ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-white shadow-sm" />)}</div>
      ) : report && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-gray-500">
            <span>Showing {report.date_from} to {report.date_to} (India Standard Time)</span>
            <span>The product filter narrows the product table and units card; sales, order count, and daily totals remain store-wide. Orders are never erased.</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={<IndianRupee size={18} />} label="Sales in period" value={formatRupees(report.summary?.revenue)} note={`Delivered: ${formatRupees(report.summary?.completed_revenue)}`} />
            <MetricCard icon={<ShoppingBag size={18} />} label="Orders in period" value={Number(report.summary?.orders || 0).toLocaleString("en-IN")} note="Cancelled, failed, refunded and pending orders excluded" />
            <MetricCard icon={<TrendingUp size={18} />} label="Average order value" value={formatRupees(report.summary?.average_order)} note="Sales divided by valid orders" />
            <MetricCard icon={<PackageSearch size={18} />} label={appliedProduct ? "Selected product units" : "Units in listed products"} value={products.reduce((sum, product) => sum + Number(product.quantity || 0), 0).toLocaleString("en-IN")} note={appliedProduct ? appliedProduct.name : `Across ${products.length} products shown`} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.1fr_1.4fr]">
            <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <div className="mb-5">
                <h2 className="font-extrabold text-gray-900">Daily sales</h2>
                <p className="mt-1 text-xs text-gray-500">Order totals by order-created date</p>
              </div>
              {daily.length ? <div className="space-y-3">
                {daily.map((day) => (
                  <div key={day.date} className="grid grid-cols-[48px_1fr_auto] items-center gap-3 text-xs">
                    <span className="font-semibold text-gray-500">{formatDay(day.date)}</span>
                    <div className="h-2.5 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-orange-400" style={{ width: `${Math.max(2, (Number(day.revenue || 0) / maxDailyRevenue) * 100)}%` }} /></div>
                    <span className="min-w-20 text-right font-bold text-gray-800">{formatRupees(day.revenue)}</span>
                  </div>
                ))}
              </div> : <EmptyState text="No sales in this date range." />}
            </section>

            <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="border-b border-gray-100 p-5">
                <h2 className="font-extrabold text-gray-900">Product sales</h2>
                <p className="mt-1 text-xs text-gray-500">Product line revenue, units, and number of orders in the selected period</p>
              </div>
              {products.length ? <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500"><tr><th className="px-5 py-3">Product</th><th className="px-4 py-3 text-right">Units</th><th className="px-4 py-3 text-right">Orders</th><th className="px-5 py-3 text-right">Revenue</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">{products.map((product) => <tr key={`${product.id}-${product.name}`}><td className="max-w-[220px] truncate px-5 py-3 font-semibold text-gray-800">{product.name}</td><td className="px-4 py-3 text-right tabular-nums text-gray-600">{Number(product.quantity).toLocaleString("en-IN")}</td><td className="px-4 py-3 text-right tabular-nums text-gray-600">{Number(product.orders).toLocaleString("en-IN")}</td><td className="px-5 py-3 text-right font-bold tabular-nums text-gray-900">{formatRupees(product.revenue)}</td></tr>)}</tbody>
                </table>
              </div> : <EmptyState text={appliedProduct ? "This product has no sales in the selected period." : "No product sales in this date range."} />}
              {!appliedProduct && products.length === 100 && <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">Showing the 100 highest-revenue product/name entries. Search for a product to see its exact results.</p>}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ icon, label, value, note }) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-gray-400"><span>{label}</span><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-50 text-[#FF8A00]">{icon}</span></div>
      <div className="mt-3 text-2xl font-black tabular-nums text-gray-900">{value}</div>
      <p className="mt-1 text-[11px] text-gray-500">{note}</p>
    </section>
  );
}

function EmptyState({ text }) {
  return <div className="p-8 text-center text-sm font-medium text-gray-400">{text}</div>;
}

const EMPTY_ARRAY = [];

export default Analytics;
