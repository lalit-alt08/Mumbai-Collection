import { Calendar, X } from "lucide-react";

export function OrderCustomDateModal({
  isOpen,
  onClose,
  tempDateRange,
  setTempDateRange,
  onApply,
  setPresetRange,
  setMonthPreset,
}) {
  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
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
            type="button"
            onClick={onClose}
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
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={!tempDateRange.start || !tempDateRange.end}
            className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-extrabold text-white shadow-sm hover:bg-emerald-500 active:scale-95 transition disabled:opacity-40 cursor-pointer"
          >
            Apply Range
          </button>
        </div>
      </div>
    </div>
  );
}
