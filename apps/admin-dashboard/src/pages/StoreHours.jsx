import { useState, useEffect } from "react";
import {
  Clock,
  Save,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Power,
  Calendar,
  MessageSquare,
  Filter,
  ChevronRight,
} from "lucide-react";
import { getStoreHours, updateStoreHours } from "../services/adminApi";

const DAYS_OF_WEEK = [
  { key: "monday", label: "Monday", short: "Mon", isWeekend: false },
  { key: "tuesday", label: "Tuesday", short: "Tue", isWeekend: false },
  { key: "wednesday", label: "Wednesday", short: "Wed", isWeekend: false },
  { key: "thursday", label: "Thursday", short: "Thu", isWeekend: false },
  { key: "friday", label: "Friday", short: "Fri", isWeekend: false },
  { key: "saturday", label: "Saturday", short: "Sat", isWeekend: true },
  { key: "sunday", label: "Sunday", short: "Sun", isWeekend: true },
];

const DEFAULT_SCHEDULE = {
  monday: { open: "09:00", close: "22:00", enabled: true },
  tuesday: { open: "09:00", close: "22:00", enabled: true },
  wednesday: { open: "09:00", close: "22:00", enabled: true },
  thursday: { open: "09:00", close: "22:00", enabled: true },
  friday: { open: "09:00", close: "22:00", enabled: true },
  saturday: { open: "09:00", close: "22:00", enabled: true },
  sunday: { open: "09:00", close: "22:00", enabled: true },
};

function StoreHours() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [liveStatus, setLiveStatus] = useState(null);

  const [manualOverride, setManualOverride] = useState("auto");
  const [closedMessage, setClosedMessage] = useState("");
  const [schedule, setSchedule] = useState(DEFAULT_SCHEDULE);
  const [dayFilter, setDayFilter] = useState("all");

  const loadData = async () => {
    try {
      setLoading(true);
      setError("");
      const data = await getStoreHours();
      if (data) {
        setManualOverride(data.manual_override || "auto");
        setClosedMessage(data.closed_message || "");
        if (data.schedule) {
          const mergedSchedule = { ...DEFAULT_SCHEDULE };
          DAYS_OF_WEEK.forEach(({ key }) => {
            if (data.schedule[key]) {
              mergedSchedule[key] = {
                open: data.schedule[key].open || "09:00",
                close: data.schedule[key].close || "22:00",
                enabled: data.schedule[key].enabled !== false,
              };
            }
          });
          setSchedule(mergedSchedule);
        }
        setLiveStatus({
          is_open: data.is_open,
          current_ist_time: data.current_ist_time,
          next_opening: data.next_opening,
          evaluation_reason: data.evaluation_reason,
        });
      }
    } catch (err) {
      setError(
        err.response?.data?.message || "Failed to load store operating hours."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleScheduleChange = (day, field, value) => {
    setSchedule((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: value,
      },
    }));
  };

  const handleApplyAllDays = (sourceDay) => {
    const template = schedule[sourceDay];
    setSchedule((prev) => {
      const next = { ...prev };
      DAYS_OF_WEEK.forEach(({ key }) => {
        next[key] = { ...template };
      });
      return next;
    });
    setSuccessMsg(`Copied ${sourceDay.toUpperCase()} hours to all 7 days.`);
    setTimeout(() => setSuccessMsg(""), 4000);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError("");
      setSuccessMsg("");

      const payload = {
        manual_override: manualOverride,
        closed_message: closedMessage.trim(),
        schedule,
      };

      const res = await updateStoreHours(payload);
      if (res) {
        setLiveStatus({
          is_open: res.is_open,
          current_ist_time: res.current_ist_time,
          next_opening: res.next_opening,
          evaluation_reason: res.evaluation_reason,
        });
        setSuccessMsg(res.message || "Store operating hours updated successfully!");
        setTimeout(() => setSuccessMsg(""), 5000);
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Failed to save changes. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex items-center gap-3 text-sm font-semibold text-gray-500">
          <RefreshCw size={20} className="animate-spin text-[#FF8A00]" />
          Loading store operating hours...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900">
            Store Operating Hours
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Configure order acceptance hours for Mumbai Collection (Asia/Kolkata IST).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold text-gray-700 shadow-sm transition hover:bg-gray-50 active:scale-95"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh Status
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#FF8A00] to-[#FFA726] px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-orange-500/20 transition hover:brightness-105 active:scale-95 disabled:opacity-50"
          >
            {saving ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {saving ? "Saving Changes..." : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          <AlertCircle size={18} className="shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
          <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Live Status Card */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                liveStatus?.is_open
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-amber-50 text-amber-600"
              }`}
            >
              <Clock size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
                  Live Store Status
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-extrabold ${
                    liveStatus?.is_open
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      liveStatus?.is_open
                        ? "bg-emerald-500 animate-pulse"
                        : "bg-amber-500"
                    }`}
                  />
                  {liveStatus?.is_open ? "OPEN FOR ORDERS" : "CLOSED FOR ORDERS"}
                </span>
              </div>
              <h3 className="mt-1 text-lg font-bold text-gray-900">
                {liveStatus?.is_open
                  ? "Customers can place orders normally"
                  : "Order checkout is currently paused"}
              </h3>
            </div>
          </div>

          {liveStatus?.next_opening?.label && !liveStatus.is_open && (
            <div className="rounded-xl bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-800 border border-amber-200">
              Resumes: {liveStatus.next_opening.label}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-y-2 gap-x-6 border-t border-gray-100 pt-4 text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-gray-700">Current IST Time:</span>
            <span className="font-mono font-medium text-gray-900">
              {liveStatus?.current_ist_time || "Asia/Kolkata"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-gray-700">Control Mode:</span>
            <span className="capitalize font-medium text-gray-900">
              {manualOverride === "auto"
                ? "Automatic Schedule"
                : manualOverride === "open"
                ? "Manual (Always Open)"
                : "Manual (Always Closed)"}
            </span>
          </div>
        </div>
      </div>

      {/* Manual Override Settings */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-gray-900 mb-2">
          <Power size={18} className="text-[#FF8A00]" />
          <h2 className="text-base font-bold">Manual Override Mode</h2>
        </div>
        <p className="text-xs text-gray-500 mb-5">
          Override automatic schedules in case of emergencies, stock-taking, festivals, or extended hours.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            {
              id: "auto",
              title: "Automatic Schedule",
              desc: "Follows daily 7-day schedule below",
              color: "border-gray-200 hover:border-gray-300",
              activeColor: "border-[#FF8A00] bg-orange-50/50 ring-2 ring-[#FF8A00]/20",
            },
            {
              id: "open",
              title: "Force Store Open",
              desc: "Orders allowed 24/7 (Bypasses schedule)",
              color: "border-gray-200 hover:border-emerald-200",
              activeColor: "border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-500/20",
            },
            {
              id: "closed",
              title: "Force Store Closed",
              desc: "Temporarily pause all new orders",
              color: "border-gray-200 hover:border-red-200",
              activeColor: "border-red-500 bg-red-50/50 ring-2 ring-red-500/20",
            },
          ].map((mode) => {
            const isSelected = manualOverride === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setManualOverride(mode.id)}
                className={`flex flex-col items-start rounded-xl border p-4 text-left transition ${
                  isSelected ? mode.activeColor : mode.color
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-sm font-bold text-gray-900">{mode.title}</span>
                  <div
                    className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                      isSelected
                        ? "border-[#FF8A00] bg-[#FF8A00]"
                        : "border-gray-300"
                    }`}
                  >
                    {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </div>
                </div>
                <p className="mt-1 text-xs text-gray-500">{mode.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Closed Message Notice */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-gray-900 mb-2">
          <MessageSquare size={18} className="text-[#FF8A00]" />
          <h2 className="text-base font-bold">Custom Closed Notice Message</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Optional message shown to customers on checkout when orders are closed.
        </p>

        <input
          type="text"
          value={closedMessage}
          onChange={(e) => setClosedMessage(e.target.value)}
          placeholder="e.g. We are currently closed for new orders. Store opens at 09:00 AM!"
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#FF8A00] focus:outline-none focus:ring-2 focus:ring-[#FF8A00]/20"
        />
      </div>

      {/* 7-Day Schedule Matrix */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 text-gray-900">
              <Calendar size={18} className="text-[#FF8A00]" />
              <h2 className="text-base font-bold">Weekly Operating Schedule</h2>
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              Set open and close hours for each day of the week (IST 24-hour time).
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              const sourceKey = dayFilter !== "all" ? dayFilter : "monday";
              handleApplyAllDays(sourceKey);
            }}
            className="flex items-center gap-1.5 text-xs font-bold text-[#FF8A00] hover:underline"
          >
            Apply {dayFilter !== "all" ? dayFilter.toUpperCase() : "Monday"} hours to all days
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Single Clean Segmented Filter Bar */}
        <div className="mb-4 flex items-center gap-1.5 overflow-x-auto rounded-xl bg-gray-100/90 p-1.5">
          <button
            type="button"
            onClick={() => setDayFilter("all")}
            className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-xs font-bold transition ${
              dayFilter === "all"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:bg-gray-200/60 hover:text-gray-900"
            }`}
          >
            All Days
          </button>

          <div className="h-4 w-[1px] bg-gray-300 mx-0.5 shrink-0" />

          {DAYS_OF_WEEK.map(({ key, short, label }) => {
            const isSelected = dayFilter === key;
            const isDayEnabled = schedule[key]?.enabled !== false;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setDayFilter(key)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  isSelected
                    ? "bg-[#FF8A00] text-white shadow-sm font-bold"
                    : "text-gray-600 hover:bg-gray-200/60 hover:text-gray-900"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isSelected
                      ? "bg-white"
                      : isDayEnabled
                      ? "bg-emerald-500"
                      : "bg-gray-400"
                  }`}
                />
                {short}
              </button>
            );
          })}
        </div>

        {/* Schedule List */}
        <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100">
          {DAYS_OF_WEEK.filter((day) => {
            if (dayFilter === "all") return true;
            return day.key === dayFilter;
          }).map(({ key, label, short }) => {
            const dayConfig = schedule[key] || {
              open: "09:00",
              close: "22:00",
              enabled: true,
            };

            return (
              <div
                key={key}
                className={`flex flex-col gap-3 px-4 py-3 transition sm:flex-row sm:items-center sm:justify-between ${
                  dayConfig.enabled ? "bg-white" : "bg-gray-50/70 opacity-75"
                }`}
              >
                {/* Day Name & Toggle */}
                <div className="flex items-center gap-3 min-w-[140px]">
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={dayConfig.enabled}
                      onChange={(e) =>
                        handleScheduleChange(key, "enabled", e.target.checked)
                      }
                      className="peer sr-only"
                    />
                    <div className="peer h-5 w-9 rounded-full bg-gray-200 after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#FF8A00] peer-checked:after:translate-x-full peer-focus:outline-none" />
                  </label>
                  <span className="text-sm font-bold text-gray-900">{label}</span>
                </div>

                {/* Open / Close Time Selectors */}
                {dayConfig.enabled ? (
                  <div className="flex flex-wrap items-center gap-2.5 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-gray-500">Open:</span>
                      <input
                        type="time"
                        value={dayConfig.open}
                        onChange={(e) =>
                          handleScheduleChange(key, "open", e.target.value)
                        }
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 font-mono text-xs font-semibold text-gray-800 shadow-sm focus:border-[#FF8A00] focus:outline-none"
                      />
                    </div>

                    <span className="text-gray-400">to</span>

                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-gray-500">Close:</span>
                      <input
                        type="time"
                        value={dayConfig.close}
                        onChange={(e) =>
                          handleScheduleChange(key, "close", e.target.value)
                        }
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 font-mono text-xs font-semibold text-gray-800 shadow-sm focus:border-[#FF8A00] focus:outline-none"
                      />
                    </div>

                    {dayConfig.open > dayConfig.close && (
                      <span className="rounded-md bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-700">
                        Overnight Shift (+1 Day)
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="text-xs font-semibold text-gray-400">
                    Closed all day (No orders accepted)
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default StoreHours;
