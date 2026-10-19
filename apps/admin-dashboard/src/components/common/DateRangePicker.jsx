import { useState, useEffect, useRef } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  Check,
  RotateCcw,
} from "lucide-react";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export const formatDateDisplay = (dateStr) => {
  if (!dateStr) return "";
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
  } catch {
    return dateStr;
  }
};

export const getDaysDifference = (fromStr, toStr) => {
  if (!fromStr || !toStr) return 0;
  try {
    const d1 = new Date(`${fromStr}T12:00:00+05:30`);
    const d2 = new Date(`${toStr}T12:00:00+05:30`);
    const diffTime = Math.abs(d2 - d1);
    return Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
  } catch {
    return 0;
  }
};

export default function DateRangePicker({
  dateFrom,
  dateTo,
  onApply,
  maxDate,
  presets = [],
  activePreset,
  onPresetSelect,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Draft range while calendar is open
  const [tempStart, setTempStart] = useState(dateFrom);
  const [tempEnd, setTempEnd] = useState(dateTo);
  const [hoverDate, setHoverDate] = useState(null);

  // Calendar view navigation (Year & Month)
  const [viewYear, setViewYear] = useState(() => {
    if (dateTo) return parseInt(dateTo.split("-")[0], 10);
    return new Date().getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    if (dateTo) return parseInt(dateTo.split("-")[1], 10) - 1;
    return new Date().getMonth();
  });

  // Keep temp range in sync when props change
  useEffect(() => {
    setTempStart(dateFrom);
    setTempEnd(dateTo);
  }, [dateFrom, dateTo]);

  // When opening calendar, center view on current end date
  useEffect(() => {
    if (isOpen) {
      if (dateTo) {
        setViewYear(parseInt(dateTo.split("-")[0], 10));
        setViewMonth(parseInt(dateTo.split("-")[1], 10) - 1);
      }
      setTempStart(dateFrom);
      setTempEnd(dateTo);
      setHoverDate(null);
    }
  }, [isOpen, dateFrom, dateTo]);

  // Click outside and Escape handler
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const goToPrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goToNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  // Build grid days for the month
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const handleDayClick = (dayStr) => {
    if (maxDate && dayStr > maxDate) return;

    if (!tempStart || (tempStart && tempEnd)) {
      // First click: start new selection
      setTempStart(dayStr);
      setTempEnd("");
      setHoverDate(null);
    } else if (tempStart && !tempEnd) {
      // Second click: finish selection
      if (dayStr < tempStart) {
        setTempEnd(tempStart);
        setTempStart(dayStr);
      } else {
        setTempEnd(dayStr);
      }
      setHoverDate(null);
    }
  };

  const handleApply = () => {
    const finalStart = tempStart || dateFrom;
    const finalEnd = tempEnd || tempStart || dateTo;
    if (finalStart && finalEnd) {
      const sortedStart = finalStart <= finalEnd ? finalStart : finalEnd;
      const sortedEnd = finalStart <= finalEnd ? finalEnd : finalStart;
      onApply(sortedStart, sortedEnd);
      setIsOpen(false);
    }
  };

  const handlePresetClick = (preset) => {
    if (onPresetSelect) {
      onPresetSelect(preset.id);
      setIsOpen(false);
    }
  };

  const diffDays = getDaysDifference(dateFrom, dateTo);

  return (
    <div className="relative w-full" ref={containerRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full min-h-[44px] flex items-center justify-between gap-3 rounded-2xl border bg-white px-3.5 py-2 text-xs font-semibold shadow-xs transition-all cursor-pointer ${
          isOpen
            ? "border-orange-500 ring-2 ring-orange-500/15"
            : "border-gray-200 hover:border-gray-300"
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-50 text-[#FF8A00] shrink-0">
            <CalendarDays size={15} />
          </div>
          <div className="flex flex-col text-left min-w-0">
            <span className="text-[10px] uppercase font-bold tracking-wider text-gray-400">
              Selected Period
            </span>
            <div className="flex items-center gap-2 font-bold text-gray-800 text-xs sm:text-[13px] truncate">
              <span>{formatDateDisplay(dateFrom)}</span>
              <span className="text-gray-400 font-normal">→</span>
              <span>{formatDateDisplay(dateTo)}</span>
              {diffDays > 0 && (
                <span className="hidden sm:inline-flex rounded-full bg-orange-100/70 px-2 py-0.5 text-[10px] font-black text-orange-800 shrink-0">
                  {diffDays} {diffDays === 1 ? "day" : "days"}
                </span>
              )}
            </div>
          </div>
        </div>

        <ChevronDown
          size={16}
          className={`text-gray-400 transition-transform duration-200 shrink-0 ${
            isOpen ? "rotate-180 text-[#FF8A00]" : ""
          }`}
        />
      </button>

      {/* Popover Custom Calendar */}
      {isOpen && (
        <div className="absolute left-0 sm:left-auto top-full z-40 mt-2 w-full sm:w-[360px] md:w-[540px] rounded-3xl border border-gray-200 bg-white p-4 sm:p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
          <div className="flex flex-col md:flex-row gap-5">
            {/* Left sidebar presets on desktop */}
            {presets.length > 0 && (
              <div className="flex md:flex-col gap-1.5 overflow-x-auto pb-1 md:pb-0 md:w-36 shrink-0 border-b md:border-b-0 md:border-r border-gray-100 md:pr-4">
                <span className="hidden md:block text-[10px] font-extrabold uppercase tracking-wider text-gray-400 mb-1">
                  Quick Ranges
                </span>
                {presets.map((preset) => {
                  const isSelected = activePreset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handlePresetClick(preset)}
                      className={`h-8 px-3 rounded-xl text-xs font-bold transition-all text-left truncate cursor-pointer shrink-0 md:shrink ${
                        isSelected
                          ? "bg-orange-500 text-white shadow-xs"
                          : "text-gray-600 hover:bg-orange-50 hover:text-orange-700 bg-gray-50/70 md:bg-transparent"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Right Calendar Area */}
            <div className="flex-1 min-w-0">
              {/* Calendar Month Header */}
              <div className="flex items-center justify-between mb-3">
                <span className="font-extrabold text-sm text-gray-900">
                  {MONTH_NAMES[viewMonth]} {viewYear}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={goToPrevMonth}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 transition cursor-pointer"
                    aria-label="Previous Month"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={goToNextMonth}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 transition cursor-pointer"
                    aria-label="Next Month"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>

              {/* Weekday labels */}
              <div className="grid grid-cols-7 gap-1 text-center mb-1">
                {WEEKDAYS.map((day) => (
                  <span
                    key={day}
                    className="py-1 text-[11px] font-black text-gray-400 uppercase tracking-wider"
                  >
                    {day}
                  </span>
                ))}
              </div>

              {/* Days Grid */}
              <div className="grid grid-cols-7 gap-y-1 gap-x-0.5 text-center">
                {/* Previous month filler days */}
                {[...Array(firstDayOfWeek)].map((_, i) => {
                  const dayNum = daysInPrevMonth - firstDayOfWeek + i + 1;
                  return (
                    <div
                      key={`prev-${i}`}
                      className="h-8 flex items-center justify-center text-xs text-gray-300 pointer-events-none select-none"
                    >
                      {dayNum}
                    </div>
                  );
                })}

                {/* Current month days */}
                {[...Array(daysInMonth)].map((_, i) => {
                  const dayNum = i + 1;
                  const dateString = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;

                  const isStart = tempStart === dateString;
                  const isEnd = tempEnd === dateString;
                  const isSingleSelected = isStart && (!tempEnd || tempStart === tempEnd);

                  // Range calculation
                  const effectiveEnd = tempEnd || (hoverDate && hoverDate > tempStart ? hoverDate : null);
                  const inRange =
                    tempStart &&
                    effectiveEnd &&
                    dateString > tempStart &&
                    dateString < effectiveEnd;

                  const isFuture = maxDate ? dateString > maxDate : false;

                  return (
                    <button
                      key={dateString}
                      type="button"
                      disabled={isFuture}
                      onClick={() => handleDayClick(dateString)}
                      onMouseEnter={() => {
                        if (tempStart && !tempEnd) setHoverDate(dateString);
                      }}
                      className={`h-8 w-full flex items-center justify-center text-xs font-semibold transition-all relative select-none ${
                        isFuture
                          ? "text-gray-300 cursor-not-allowed"
                          : "cursor-pointer"
                      } ${
                        inRange
                          ? "bg-orange-50 text-orange-950 font-bold"
                          : ""
                      } ${
                        isStart && effectiveEnd && !isSingleSelected
                          ? "rounded-l-xl bg-orange-500 text-white font-extrabold shadow-xs"
                          : ""
                      } ${
                        isEnd && tempStart && !isSingleSelected
                          ? "rounded-r-xl bg-orange-500 text-white font-extrabold shadow-xs"
                          : ""
                      } ${
                        isSingleSelected
                          ? "rounded-xl bg-orange-500 text-white font-extrabold shadow-xs"
                          : !inRange && !isStart && !isEnd && !isFuture
                          ? "hover:bg-gray-100 rounded-lg text-gray-700"
                          : ""
                      }`}
                    >
                      {dayNum}
                    </button>
                  );
                })}
              </div>

              {/* Selection Summary & Apply footer */}
              <div className="mt-4 pt-3.5 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
                <div className="text-[11px] font-medium text-gray-500">
                  {tempStart && (
                    <span>
                      <strong className="text-gray-800">{formatDateDisplay(tempStart)}</strong>
                      {tempEnd && tempEnd !== tempStart && (
                        <> → <strong className="text-gray-800">{formatDateDisplay(tempEnd)}</strong></>
                      )}
                      {tempStart && tempEnd && (
                        <span className="ml-1.5 text-orange-600 font-bold">
                          ({getDaysDifference(tempStart, tempEnd)} days)
                        </span>
                      )}
                    </span>
                  )}
                  {!tempStart && <span>Click a start date to begin</span>}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleApply}
                    disabled={!tempStart}
                    className="px-4 py-1.5 text-xs font-extrabold text-white bg-orange-500 hover:bg-orange-600 rounded-xl transition shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    Apply Range
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
