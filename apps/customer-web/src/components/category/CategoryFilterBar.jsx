import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  SlidersHorizontal,
  ArrowUpDown,
  ChevronDown,
  Check,
  X,
  Zap,
} from "lucide-react";
import { triggerHaptic } from "../../utils/haptics";

const SORT_OPTIONS = [
  { id: "default", label: "Featured" },
  { id: "price-asc", label: "Price: Low to High" },
  { id: "price-desc", label: "Price: High to Low" },
  { id: "rating", label: "Top Rated" },
  { id: "newest", label: "Newest Arrivals" },
];

const PRICE_OPTIONS = [
  { id: "all", label: "All Prices" },
  { id: "under-500", label: "Under ₹500" },
  { id: "500-1000", label: "₹500 – ₹1,000" },
  { id: "1000-2000", label: "₹1,000 – ₹2,000" },
  { id: "above-2000", label: "Above ₹2,000" },
];

export default function CategoryFilterBar({
  sortBy = "default",
  setSortBy,
  priceFilter = "all",
  setPriceFilter,
  inStockOnly = false,
  setInStockOnly,
  onReset,
  onApply,
  totalProducts = 0,
}) {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [targetSection, setTargetSection] = useState("all"); // 'all' | 'sort' | 'price' | 'stock'
  const [draft, setDraft] = useState({ sortBy, priceFilter, inStockOnly });

  const sheetScrollRef = useRef(null);
  const sortSectionRef = useRef(null);
  const priceSectionRef = useRef(null);
  const stockSectionRef = useRef(null);
  const sheetDialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const triggerButtonRef = useRef(null);

  // Synchronize draft state when the modal opens or parent filters change while closed
  const handleOpenSheet = (section = "all", e) => {
    triggerHaptic("light");
    triggerButtonRef.current = e?.currentTarget || document.activeElement;
    setDraft({ sortBy, priceFilter, inStockOnly });
    setTargetSection(section);
    setIsSheetOpen(true);
  };

  const handleCloseSheet = () => {
    triggerHaptic("light");
    setIsSheetOpen(false);
  };

  // Focus management: move focus inside dialog on open, and restore focus to trigger pill on close
  useEffect(() => {
    if (isSheetOpen) {
      const focusTimer = setTimeout(() => {
        closeButtonRef.current?.focus({ preventScroll: true });
      }, 50);
      return () => clearTimeout(focusTimer);
    } else if (triggerButtonRef.current) {
      triggerButtonRef.current.focus?.({ preventScroll: true });
      triggerButtonRef.current = null;
    }
  }, [isSheetOpen]);

  // Keyboard navigation, focus trap & auto-scroll into target section when opened
  useEffect(() => {
    if (!isSheetOpen) return;

    const scrollTimer = setTimeout(() => {
      if (targetSection === "sort" && sortSectionRef.current) {
        sortSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (targetSection === "price" && priceSectionRef.current) {
        priceSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (targetSection === "stock" && stockSectionRef.current) {
        stockSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (sheetScrollRef.current) {
        sheetScrollRef.current.scrollTo({ top: 0, behavior: "instant" });
      }
    }, 60);

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCloseSheet();
        return;
      }

      if (e.key === "Tab") {
        const dialogEl = sheetDialogRef.current;
        if (!dialogEl) return;

        const focusableElements = Array.from(
          dialogEl.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || !dialogEl.contains(document.activeElement)) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement || !dialogEl.contains(document.activeElement)) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      clearTimeout(scrollTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSheetOpen, targetSection]);

  // Count active filters (non-default values)
  const activeCount =
    (sortBy !== "default" ? 1 : 0) +
    (priceFilter !== "all" ? 1 : 0) +
    (inStockOnly ? 1 : 0);

  const currentSortObj = SORT_OPTIONS.find((s) => s.id === sortBy);
  const currentSortLabel = sortBy === "default" ? "Sort" : currentSortObj?.label || "Sort";

  const currentPriceObj = PRICE_OPTIONS.find((p) => p.id === priceFilter);
  const currentPriceLabel = priceFilter === "all" ? "Price" : currentPriceObj?.label || "Price";

  const isDraftDefault =
    draft.sortBy === "default" &&
    draft.priceFilter === "all" &&
    !draft.inStockOnly;

  const handleApply = () => {
    triggerHaptic("light");
    const isUnchanged =
      draft.sortBy === sortBy &&
      draft.priceFilter === priceFilter &&
      draft.inStockOnly === inStockOnly;

    setIsSheetOpen(false);

    // Only invoke parent onApply and trigger network request if the draft selection differs
    if (!isUnchanged && onApply) {
      onApply(draft);
    }
  };

  const handleClearAllDraft = () => {
    triggerHaptic("light");
    setDraft({ sortBy: "default", priceFilter: "all", inStockOnly: false });
  };

  const handleToggleStockDirect = () => {
    triggerHaptic("light");
    if (setInStockOnly) {
      setInStockOnly((prev) => !prev);
    }
  };

  const handleResetDirect = () => {
    triggerHaptic("light");
    if (onReset) onReset();
  };

  return (
    <div className="relative shrink-0 z-30 bg-[#F0F8E8] px-3 sm:px-4 py-2 select-none">
      <div className="mx-auto max-w-7xl flex items-center justify-between gap-2.5">
        {/* Horizontal scrollable pills row */}
        <div className="flex items-center gap-2 sm:gap-2.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] py-0.5">
          {/* 1. All Filters Pill (Stretched & Prominent) */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={(e) => handleOpenSheet("all", e)}
              aria-expanded={isSheetOpen && targetSection === "all"}
              aria-label="Filter options"
              className={`flex items-center justify-center gap-2 rounded-full px-4.5 sm:px-5 h-9 min-w-[96px] sm:min-w-[106px] text-[12.5px] sm:text-[13px] font-extrabold tracking-[0.01em] transition-all active:scale-95 cursor-pointer antialiased shadow-xs ${
                activeCount > 0
                  ? "bg-[#FFFFFF] text-[#22499F] border border-[#22499F]/70 shadow-[0_0_12px_rgba(66,214,232,0.2)]"
                  : isSheetOpen && targetSection === "all"
                  ? "bg-[#FFFFFF] text-[#1E293B] border border-[#22499F]/50 ring-1 ring-[#22499F]/30"
                  : "bg-[#FFFFFF]/90 text-[#CBD5E1] border border-white/10 hover:bg-[#FFFFFF] hover:text-white hover:border-white/20"
              }`}
            >
              <SlidersHorizontal
                size={13}
                strokeWidth={2.4}
                className={`shrink-0 transition-colors ${activeCount > 0 ? "text-[#22499F]" : "text-[#64748B]"}`}
              />
              <span>Filters</span>
              {activeCount > 0 && (
                <span className="flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-[#22499F] text-[#FFFFFF] text-[10px] font-black leading-none">
                  {activeCount}
                </span>
              )}
            </button>
          </div>

          {/* 2. Sort By Pill */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={(e) => handleOpenSheet("sort", e)}
              aria-expanded={isSheetOpen && targetSection === "sort"}
              aria-label="Sort products"
              className={`flex items-center gap-1.5 sm:gap-2 rounded-full px-3.5 sm:px-4 h-9 text-[12.5px] sm:text-[13px] font-bold transition-all active:scale-95 cursor-pointer antialiased shadow-xs ${
                sortBy !== "default"
                  ? "bg-[#FFFFFF] text-[#22499F] border border-[#22499F]/70 shadow-[0_0_12px_rgba(66,214,232,0.2)]"
                  : isSheetOpen && targetSection === "sort"
                  ? "bg-[#FFFFFF] text-[#1E293B] border border-[#22499F]/50 ring-1 ring-[#22499F]/30"
                  : "bg-[#FFFFFF]/90 text-[#CBD5E1] border border-white/10 hover:bg-[#FFFFFF] hover:text-white hover:border-white/20"
              }`}
            >
              <ArrowUpDown
                size={13}
                strokeWidth={2.2}
                className={`shrink-0 transition-colors ${sortBy !== "default" ? "text-[#22499F]" : "text-[#64748B]"}`}
              />
              <span className="max-w-[130px] truncate">{currentSortLabel}</span>
              <ChevronDown
                size={13}
                strokeWidth={2.4}
                className={`shrink-0 transition-transform duration-200 ${
                  isSheetOpen && targetSection === "sort" ? "rotate-180 text-[#22499F]" : "text-[#64748B]"
                }`}
              />
            </button>
          </div>

          {/* 3. Price Filter Pill */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={(e) => handleOpenSheet("price", e)}
              aria-expanded={isSheetOpen && targetSection === "price"}
              aria-label="Filter by price"
              className={`flex items-center gap-1.5 sm:gap-2 rounded-full px-3.5 sm:px-4 h-9 text-[12.5px] sm:text-[13px] font-bold transition-all active:scale-95 cursor-pointer antialiased shadow-xs ${
                priceFilter !== "all"
                  ? "bg-[#FFFFFF] text-[#22499F] border border-[#22499F]/70 shadow-[0_0_12px_rgba(66,214,232,0.2)]"
                  : isSheetOpen && targetSection === "price"
                  ? "bg-[#FFFFFF] text-[#1E293B] border border-[#22499F]/50 ring-1 ring-[#22499F]/30"
                  : "bg-[#FFFFFF]/90 text-[#CBD5E1] border border-white/10 hover:bg-[#FFFFFF] hover:text-white hover:border-white/20"
              }`}
            >
              <span className={`text-[13px] font-bold shrink-0 ${priceFilter !== "all" ? "text-[#22499F]" : "text-[#64748B]"}`}>₹</span>
              <span className="max-w-[130px] truncate">{currentPriceLabel}</span>
              <ChevronDown
                size={13}
                strokeWidth={2.4}
                className={`shrink-0 transition-transform duration-200 ${
                  isSheetOpen && targetSection === "price" ? "rotate-180 text-[#22499F]" : "text-[#64748B]"
                }`}
              />
            </button>
          </div>

          {/* 4. In Stock Instant Toggle Pill */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={handleToggleStockDirect}
              aria-pressed={inStockOnly}
              aria-label="Toggle in-stock only"
              className={`flex items-center gap-1.5 sm:gap-2 rounded-full px-3.5 sm:px-4 h-9 text-[12.5px] sm:text-[13px] font-bold transition-all active:scale-95 cursor-pointer antialiased shadow-xs ${
                inStockOnly
                  ? "bg-[#FFFFFF] text-[#22499F] border border-[#22499F]/70 shadow-[0_0_12px_rgba(66,214,232,0.2)]"
                  : "bg-[#FFFFFF]/90 text-[#CBD5E1] border border-white/10 hover:bg-[#FFFFFF] hover:text-white hover:border-white/20"
              }`}
            >
              <Zap
                size={13}
                strokeWidth={2.4}
                className={`shrink-0 transition-colors ${inStockOnly ? "text-[#22499F] fill-[#22499F]" : "text-[#64748B]"}`}
              />
              <span className="whitespace-nowrap">In Stock</span>
            </button>
          </div>

          {/* 5. Clear / Reset Button (Shown only when active) */}
          {activeCount > 0 && (
            <button
              type="button"
              onClick={handleResetDirect}
              aria-label="Reset all filters"
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-rose-950/30 border border-rose-500/30 px-3 h-9 text-xs font-bold text-rose-300 hover:bg-rose-900/40 hover:text-rose-200 transition-all active:scale-95 cursor-pointer"
            >
              <X size={12} strokeWidth={2.8} />
              <span>Reset</span>
            </button>
          )}
        </div>

        {/* Product count display */}
        <div className="shrink-0 text-xs font-semibold text-[#64748B] hidden sm:block whitespace-nowrap pl-3">
          {totalProducts} {totalProducts === 1 ? "item" : "items"}
        </div>
      </div>

      {/* ────────────────────────────────────────────────────────── */}
      {/* FULL FILTER MODAL (PORTALED ABOVE BOTTOM NAV & Z-30)       */}
      {/* ────────────────────────────────────────────────────────── */}
      {isSheetOpen && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="filter-sheet-title"
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-150"
          onClick={handleCloseSheet}
        >
          <div
            ref={sheetDialogRef}
            className="w-full max-w-md rounded-t-[28px] sm:rounded-3xl bg-[#FFFFFF] border border-[#E2E8F0] p-5 sm:p-6 text-[#1E293B] shadow-2xl relative animate-in slide-in-from-bottom-4 duration-200 max-h-[85vh] flex flex-col pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile Drag Pill */}
            <div className="mx-auto mb-3.5 h-1.5 w-12 rounded-full bg-white/25 sm:hidden" />

            {/* Header - Fixed (shrink-0) */}
            <div className="flex items-center justify-between pb-4 border-b border-[#E2E8F0]/80 shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#FFFFFF] to-[#FFFFFF] text-[#22499F] border border-[#22499F]/40 shadow-[0_0_12px_rgba(66,214,232,0.2)]">
                  <SlidersHorizontal size={20} strokeWidth={2.5} />
                </div>
                <div>
                  <h3 id="filter-sheet-title" className="text-[19px] sm:text-[21px] font-black text-[#1E293B] tracking-[-0.015em] leading-tight antialiased">
                    Filter & Sort
                  </h3>
                  <p className="text-[13px] sm:text-[13.5px] font-semibold text-[#CBD5E1] tracking-[0.005em] mt-0.5 leading-snug antialiased">
                    Choose your preferences
                  </p>
                </div>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={handleCloseSheet}
                aria-label="Close"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F0F8E8] text-[#1E293B] hover:bg-[#FFFFFF] hover:text-[#22499F] border border-[#E2E8F0] transition active:scale-95 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#22499F]"
              >
                <X size={18} strokeWidth={2.5} />
              </button>
            </div>

            {/* Scrollable Filter Body */}
            <div ref={sheetScrollRef} className="flex-1 overflow-y-auto py-4 space-y-6 overscroll-contain">
              {/* SECTION: SORT BY */}
              <div ref={sortSectionRef} tabIndex={-1} className="outline-none">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-black uppercase tracking-wider text-[#94A3B8]">
                    Sort By
                  </label>
                  {draft.sortBy !== "default" && (
                    <button
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, sortBy: "default" }))}
                      className="text-xs font-extrabold text-[#22499F] hover:text-[#22499F] hover:underline cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {SORT_OPTIONS.map((opt) => {
                    const isSelected = opt.id === draft.sortBy;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          triggerHaptic("light");
                          setDraft((prev) => ({ ...prev, sortBy: opt.id }));
                        }}
                        className={`flex items-center justify-between gap-2 px-4 py-3.5 min-h-[50px] rounded-2xl text-[13.5px] sm:text-[14px] font-extrabold border transition-all text-left active:scale-[0.98] cursor-pointer antialiased shadow-xs ${
                          isSelected
                            ? "bg-[#FFFFFF] text-[#22499F] border-[#22499F] shadow-[0_0_14px_rgba(66,214,232,0.25)] ring-1 ring-[#22499F]/60"
                            : "bg-[#FFFFFF] text-[#1E293B] border-[#E2E8F0] hover:bg-[#FFFFFF] hover:border-[#22499F]/40"
                        }`}
                      >
                        <span className="truncate leading-tight">{opt.label}</span>
                        {isSelected && <Check size={16} strokeWidth={3} className="text-[#22499F] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* SECTION: PRICE RANGE */}
              <div ref={priceSectionRef} tabIndex={-1} className="outline-none">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-black uppercase tracking-wider text-[#94A3B8]">
                    Price Range
                  </label>
                  {draft.priceFilter !== "all" && (
                    <button
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, priceFilter: "all" }))}
                      className="text-xs font-extrabold text-[#22499F] hover:text-[#22499F] hover:underline cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {PRICE_OPTIONS.map((opt) => {
                    const isSelected = opt.id === draft.priceFilter;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          triggerHaptic("light");
                          setDraft((prev) => ({ ...prev, priceFilter: opt.id }));
                        }}
                        className={`flex items-center justify-between gap-2 px-4 py-3.5 min-h-[50px] rounded-2xl text-[13.5px] sm:text-[14px] font-extrabold border transition-all text-left active:scale-[0.98] cursor-pointer antialiased shadow-xs ${
                          isSelected
                            ? "bg-[#FFFFFF] text-[#22499F] border-[#22499F] shadow-[0_0_14px_rgba(66,214,232,0.25)] ring-1 ring-[#22499F]/60"
                            : "bg-[#FFFFFF] text-[#1E293B] border-[#E2E8F0] hover:bg-[#FFFFFF] hover:border-[#22499F]/40"
                        }`}
                      >
                        <span className="truncate leading-tight">{opt.label}</span>
                        {isSelected && <Check size={16} strokeWidth={3} className="text-[#22499F] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* SECTION: AVAILABILITY & STOCK */}
              <div ref={stockSectionRef} tabIndex={-1} className="outline-none">
                <label className="text-xs font-black uppercase tracking-wider text-[#94A3B8] mb-3 block">
                  Availability
                </label>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("light");
                    setDraft((prev) => ({ ...prev, inStockOnly: !prev.inStockOnly }));
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3.5 min-h-[52px] rounded-2xl border text-[13.5px] sm:text-[14px] font-extrabold transition-all active:scale-[0.98] cursor-pointer antialiased shadow-xs ${
                    draft.inStockOnly
                      ? "bg-[#FFFFFF] text-[#22499F] border-[#22499F] shadow-[0_0_14px_rgba(66,214,232,0.25)] ring-1 ring-[#22499F]/60"
                      : "bg-[#FFFFFF] text-[#1E293B] border-[#E2E8F0] hover:bg-[#FFFFFF] hover:border-[#22499F]/40"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Zap size={16} strokeWidth={2.4} className={draft.inStockOnly ? "text-[#22499F] fill-[#22499F]" : "text-[#64748B]"} />
                    <span>In Stock Only</span>
                  </div>
                  {draft.inStockOnly && <Check size={17} strokeWidth={3} className="text-[#22499F]" />}
                </button>
              </div>
            </div>

            {/* Footer Actions - Fixed (shrink-0) with Safe-Area Padding */}
            <div className="pt-3.5 border-t border-[#E2E8F0]/80 flex items-center justify-between gap-3.5 shrink-0">
              <button
                type="button"
                onClick={handleClearAllDraft}
                disabled={isDraftDefault}
                className={`flex items-center justify-center gap-1.5 rounded-[20px] px-4.5 sm:px-5 py-4 min-h-[52px] sm:min-h-[54px] text-[14px] font-extrabold border transition-all active:scale-95 antialiased shadow-xs ${
                  isDraftDefault
                    ? "bg-[#FFFFFF]/80 text-[#94A3B8] border-[#E2E8F0] cursor-not-allowed opacity-80"
                    : "bg-[#FFFFFF] text-[#1E293B] border-[#E2E8F0] hover:bg-[#E2E8F0] hover:border-[#22499F]/60 hover:text-[#22499F] cursor-pointer shadow-sm"
                }`}
              >
                <X size={15} strokeWidth={2.6} className={isDraftDefault ? "text-[#64748B]" : "text-[#22499F]"} />
                <span>Clear All</span>
              </button>

              <button
                type="button"
                onClick={handleApply}
                className="flex-1 max-w-[240px] sm:max-w-[260px] rounded-[20px] bg-[#22499F] hover:bg-[#1B3B82] active:bg-[#1B3B82] px-5 py-4 min-h-[52px] sm:min-h-[54px] text-[15.5px] sm:text-[16px] font-black tracking-[-0.01em] text-[#FFFFFF] shadow-[0_4px_18px_rgba(66,214,232,0.35)] transition-all active:scale-[0.98] cursor-pointer text-center flex items-center justify-center select-none antialiased"
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
