import { Filter, X, Check } from "lucide-react";

export function OrderMobileFiltersModal({
  isOpen,
  onClose,
  tabs,
  activeTab,
  onTabChange,
  dateFilters,
  dateFilter,
  onDateFilterSelect,
  locationOptions,
  locationFilter,
  setLocationFilter,
  setPage,
  onResetAll,
}) {
  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs p-0 sm:hidden animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl border-t border-gray-100 space-y-4 animate-in slide-in-from-bottom duration-200"
      >
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-emerald-600" />
            <h3 className="text-sm font-black text-gray-900">Filter Orders</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:text-gray-600"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Status Filter */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
            Fulfillment Stage
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {tabs.map((tab) => {
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabChange(tab.id)}
                  className={`rounded-xl px-3 py-2 text-xs font-bold transition text-left flex items-center justify-between cursor-pointer ${
                    isSelected
                      ? "bg-emerald-600 text-white shadow-xs"
                      : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  <span className="truncate">{tab.label}</span>
                  {isSelected && <Check size={13} className="shrink-0 text-white" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Date Filter */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
            Date Window
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {dateFilters.map((f) => {
              const isSelected = dateFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onDateFilterSelect(f.id)}
                  className={`rounded-xl px-3 py-2 text-xs font-bold transition text-left flex items-center justify-between cursor-pointer ${
                    isSelected
                      ? "bg-emerald-600 text-white shadow-xs"
                      : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  <span className="truncate">{f.label}</span>
                  {isSelected && <Check size={13} className="shrink-0 text-white" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Location Filter */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
            Delivery Location / Area
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {locationOptions.map((loc) => {
              const isSelected = locationFilter === loc.id;
              return (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => {
                    setLocationFilter(loc.id);
                    setPage(1);
                  }}
                  className={`rounded-xl px-3 py-2 text-xs font-bold transition text-left flex items-center justify-between cursor-pointer ${
                    isSelected
                      ? "bg-purple-600 text-white shadow-xs"
                      : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${loc.dot}`} />
                    <span className="truncate">{loc.label}</span>
                  </div>
                  {isSelected && <Check size={13} className="text-white shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-gray-100">
          <button
            type="button"
            onClick={onResetAll}
            className="text-xs font-bold text-gray-500 hover:text-gray-900 underline px-2 py-2"
          >
            Reset All
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white shadow-sm hover:bg-emerald-500 active:scale-95 transition cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
