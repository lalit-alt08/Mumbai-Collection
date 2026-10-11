import { useState, useEffect, useMemo } from "react";
import {
  Save,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Power,
  Calendar,
  MessageSquare,
  ChevronRight,
  Zap,
  Truck,
  Sparkles,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import {
  getStoreHours,
  updateStoreHours,
  togglePeakHours,
} from "../services/adminApi";

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

const RUSH_PRESETS = [
  {
    id: "high_demand",
    label: "⚡ High Demand",
    tag: "2–3 hrs",
    deliveryText: "Delivery in 2–3 hours",
    notice: "High order volume in progress. Deliveries may take 2–3 hours today.",
  },
  {
    id: "monsoon",
    label: "🌧️ Monsoon Rain",
    tag: "3–4 hrs",
    deliveryText: "Delivery in 3–4 hours",
    notice: "Heavy rainfall in Mumbai. Riders are traveling safely; deliveries may take 3–4 hours.",
  },
  {
    id: "festival",
    label: "📦 Festival Rush",
    tag: "2–4 hrs",
    deliveryText: "Delivery in 2–4 hours",
    notice: "Festival demand surge! Orders are being freshly packed and dispatched in sequence.",
  },
  {
    id: "backlog",
    label: "⏱️ Minor Delay",
    tag: "90–120 mins",
    deliveryText: "Delivery in 90–120 mins",
    notice: "Slight order backlog. Estimated delivery within 90–120 minutes.",
  },
];

const CLOSED_PRESETS = [
  {
    id: "routine",
    label: "Routine Closing",
    desc: "Daily 9 AM–10 PM notice",
    text: "Our store is currently closed for new orders. We operate daily from 9:00 AM to 10:00 PM IST.",
  },
  {
    id: "monsoon",
    label: "🌧️ Monsoon Rain",
    desc: "Weather alert",
    text: "Store temporarily closed due to severe rainfall and waterlogging in Mumbai. Reopening shortly.",
  },
  {
    id: "inventory",
    label: "📦 Stock Audit",
    desc: "Restocking pause",
    text: "We are currently conducting inventory audit & stock replenishment. Orders resume shortly.",
  },
  {
    id: "holiday",
    label: "🎉 Festive Holiday",
    desc: "Reopens tomorrow",
    text: "Store is closed today in celebration of the festival holiday. We will reopen tomorrow at 09:00 AM IST.",
  },
];

const SHIFT_PRESETS = [
  {
    id: "standard",
    label: "✨ Retail Standard (9:00 AM – 10:00 PM)",
    subtitle: "Applies 9 AM–10 PM to all 7 days",
    build: () => {
      const s = {};
      DAYS_OF_WEEK.forEach(({ key }) => {
        s[key] = { open: "09:00", close: "22:00", enabled: true };
      });
      return s;
    },
  },
  {
    id: "extended",
    label: "🌙 Late Night (10:00 AM – 11:30 PM)",
    subtitle: "Applies 10 AM–11:30 PM to all 7 days",
    build: () => {
      const s = {};
      DAYS_OF_WEEK.forEach(({ key }) => {
        s[key] = { open: "10:00", close: "23:30", enabled: true };
      });
      return s;
    },
  },
  {
    id: "weekend_split",
    label: "📅 Weekdays 9–10 / Weekends 9–11",
    subtitle: "Mon–Fri until 10 PM, Sat–Sun until 11 PM",
    build: () => {
      const s = {};
      DAYS_OF_WEEK.forEach(({ key, isWeekend }) => {
        s[key] = {
          open: "09:00",
          close: isWeekend ? "23:00" : "22:00",
          enabled: true,
        };
      });
      return s;
    },
  },
];

function StoreHours() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingPeak, setTogglingPeak] = useState(false);
  const [togglingOverride, setTogglingOverride] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [liveStatus, setLiveStatus] = useState(null);

  const [manualOverride, setManualOverride] = useState("auto");
  const [closedMessage, setClosedMessage] = useState("");
  const [isPeakHours, setIsPeakHours] = useState(false);
  const [peakDeliveryText, setPeakDeliveryText] = useState("Delivery in 2–3 hours");
  const [normalDeliveryText, setNormalDeliveryText] = useState("Delivery in 60–90 mins");
  const [peakNoticeMessage, setPeakNoticeMessage] = useState(
    "High order volume in progress. Deliveries may take 2–3 hours today."
  );

  const [schedule, setSchedule] = useState(DEFAULT_SCHEDULE);
  const [savedSchedule, setSavedSchedule] = useState(DEFAULT_SCHEDULE);
  const [dayFilter, setDayFilter] = useState("all");
  const [showCustomPeak, setShowCustomPeak] = useState(false);
  const [showCustomClosed, setShowCustomClosed] = useState(false);

  // Check if weekly schedule has unsaved changes
  const isScheduleDirty = useMemo(() => {
    return JSON.stringify(schedule) !== JSON.stringify(savedSchedule);
  }, [schedule, savedSchedule]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError("");
      const data = await getStoreHours();
      if (data) {
        setManualOverride(data.manual_override || "auto");
        setClosedMessage(data.closed_message || data.notice_message || "");
        setIsPeakHours(Boolean(data.is_peak_hours));
        setPeakDeliveryText(data.peak_delivery_text || "Delivery in 2–3 hours");
        setNormalDeliveryText(data.normal_delivery_text || "Delivery in 60–90 mins");
        setPeakNoticeMessage(
          data.peak_notice_message ||
            data.peak_notice ||
            "High order volume in progress. Deliveries may take 2–3 hours today."
        );

        if (data.schedule) {
          const mergedSchedule = { ...DEFAULT_SCHEDULE };
          DAYS_OF_WEEK.forEach(({ key }) => {
            if (data.schedule[key]) {
              mergedSchedule[key] = {
                open: data.schedule[key].open || "09:00",
                close: data.schedule[key].close || "22:00",
                enabled: data.schedule[key].enabled !== false && data.schedule[key].is_enabled !== false,
              };
            }
          });
          setSchedule(mergedSchedule);
          setSavedSchedule(mergedSchedule);
        }

        setLiveStatus({
          is_open: data.is_open,
          current_ist_time: data.current_ist_time,
          next_opening: data.next_opening,
          evaluation_reason: data.evaluation_reason,
          is_peak_hours: Boolean(data.is_peak_hours),
          delivery_eta_text: data.delivery_eta_text,
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

  const showToast = (msg) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(""), 5000);
  };

  // 1-Click Operational Switchboard (Instant Server Sync)
  const handleSelectOverride = async (targetMode) => {
    if (togglingOverride || targetMode === manualOverride) return;
    try {
      setTogglingOverride(true);
      setError("");

      const payload = {
        manual_override: targetMode,
        closed_message: closedMessage.trim(),
        is_peak_hours: isPeakHours,
        peak_delivery_text: peakDeliveryText.trim(),
        normal_delivery_text: normalDeliveryText.trim(),
        peak_notice_message: peakNoticeMessage.trim(),
        schedule,
      };

      const res = await updateStoreHours(payload);
      if (res) {
        setManualOverride(targetMode);
        setLiveStatus((prev) => ({
          ...(prev || {}),
          is_open: res.is_open,
          current_ist_time: res.current_ist_time,
          next_opening: res.next_opening,
          evaluation_reason: res.evaluation_reason,
          delivery_eta_text: res.delivery_eta_text,
        }));

        if (targetMode === "closed") {
          showToast("🔴 Orders PAUSED immediately! Checkout is now blocked for customers.");
        } else if (targetMode === "open") {
          showToast("🟣 Store forced OPEN 24/7! Orders allowed regardless of time.");
        } else {
          showToast("🟢 Automatic Schedule active! Following daily operating hours.");
        }
      }
    } catch (err) {
      setError(
        err.response?.data?.message || "Failed to switch store operational mode."
      );
    } finally {
      setTogglingOverride(false);
    }
  };

  // 1-Click Peak / Rush Mode Toggle (Instant Server Sync)
  const handleTogglePeakHours = async (forcedState = null, customParams = {}) => {
    try {
      setTogglingPeak(true);
      setError("");
      const nextState = forcedState !== null ? forcedState : !isPeakHours;
      const res = await togglePeakHours(nextState, {
        peak_delivery_text: (customParams.peak_delivery_text || peakDeliveryText).trim(),
        normal_delivery_text: normalDeliveryText.trim(),
        peak_notice_message: (customParams.peak_notice_message || peakNoticeMessage).trim(),
      });

      if (res) {
        setIsPeakHours(Boolean(res.is_peak_hours));
        setLiveStatus((prev) => ({
          ...(prev || {}),
          is_peak_hours: Boolean(res.is_peak_hours),
          delivery_eta_text: res.delivery_eta_text,
        }));
        showToast(
          res.is_peak_hours
            ? "⚡ Peak Hours Mode ACTIVATED! Customers now see extended delivery time."
            : "✅ Peak Hours Mode DEACTIVATED. Standard 60–90 min delivery restored."
        );
      }
    } catch (err) {
      setError(
        err.response?.data?.message || "Failed to toggle peak hours mode."
      );
    } finally {
      setTogglingPeak(false);
    }
  };

  // 1-Click Rush Preset Selection
  const handleSelectRushPreset = async (preset) => {
    setPeakDeliveryText(preset.deliveryText);
    setPeakNoticeMessage(preset.notice);

    // If Peak mode is already active, instantly sync the new preset message to customers
    if (isPeakHours) {
      await handleTogglePeakHours(true, {
        peak_delivery_text: preset.deliveryText,
        peak_notice_message: preset.notice,
      });
      showToast(`⚡ Updated customer alert to: "${preset.label}" (${preset.tag})`);
    } else {
      // If peak mode was inactive, activate it in 1 click with this preset
      await handleTogglePeakHours(true, {
        peak_delivery_text: preset.deliveryText,
        peak_notice_message: preset.notice,
      });
    }
  };

  // 1-Click Closed Notice Preset Selection
  const handleSelectClosedPreset = async (preset) => {
    setClosedMessage(preset.text);
    if (manualOverride === "closed") {
      try {
        const res = await updateStoreHours({
          manual_override: "closed",
          closed_message: preset.text,
          is_peak_hours: isPeakHours,
          peak_delivery_text: peakDeliveryText.trim(),
          normal_delivery_text: normalDeliveryText.trim(),
          peak_notice_message: peakNoticeMessage.trim(),
          schedule,
        });
        if (res) {
          showToast(`Applied notice: "${preset.label}"`);
        }
      } catch (err) {
        setError(err.response?.data?.message || "Failed to update closed message.");
      }
    } else {
      showToast(`Selected "${preset.label}" notice.`);
    }
  };

  // Schedule Manipulation
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
    showToast(`Copied ${sourceDay.toUpperCase()} hours to all 7 days.`);
  };

  const handleApplyShiftPreset = (preset) => {
    const updated = preset.build();
    setSchedule(updated);
    showToast(`Applied preset: ${preset.label}`);
  };

  const handleDiscardSchedule = () => {
    setSchedule(savedSchedule);
    showToast("Schedule changes discarded.");
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    try {
      setSaving(true);
      setError("");

      const payload = {
        manual_override: manualOverride,
        closed_message: closedMessage.trim(),
        is_peak_hours: isPeakHours,
        peak_delivery_text: peakDeliveryText.trim(),
        normal_delivery_text: normalDeliveryText.trim(),
        peak_notice_message: peakNoticeMessage.trim(),
        schedule,
      };

      const res = await updateStoreHours(payload);
      if (res) {
        setSavedSchedule(schedule);
        setLiveStatus({
          is_open: res.is_open,
          current_ist_time: res.current_ist_time,
          next_opening: res.next_opening,
          evaluation_reason: res.evaluation_reason,
          is_peak_hours: Boolean(res.is_peak_hours),
          delivery_eta_text: res.delivery_eta_text,
        });
        showToast(res.message || "Store operating hours updated successfully!");
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
    <div className="space-y-6 pb-24">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-black tracking-tight text-gray-900">
          Store Operating Hours
        </h1>

        {isScheduleDirty && (
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#FF8A00] to-[#FFA726] px-4 py-2 text-xs font-bold text-white shadow-md shadow-orange-500/20 transition hover:brightness-105 active:scale-95 disabled:opacity-50"
            >
              {saving ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Save size={13} />
              )}
              {saving ? "Saving..." : "Save Schedule"}
            </button>
          </div>
        )}
      </div>

      {/* Notifications */}
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          <div className="flex items-center gap-3">
            <AlertCircle size={18} className="shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError("")}
            className="text-xs font-bold text-red-600 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {successMsg && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800 animate-fadeIn">
          <div className="flex items-center gap-3">
            <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
            <span className="font-semibold">{successMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg("")}
            className="text-xs font-bold text-emerald-700 hover:underline"
          >
            ✕
          </button>
        </div>
      )}

      {/* ============================================================== */}
      {/* ZONE 1: QUICK OPERATIONAL CONTROL DESK (Top 3 Seconds Desk)    */}
      {/* ============================================================== */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {/* Switchboard Banner Bar */}
        <div className="border-b border-gray-100 bg-gradient-to-r from-gray-50 via-white to-gray-50 p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-xs ${
                  liveStatus?.is_open
                    ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                    : "bg-red-50 text-red-600 border border-red-200"
                }`}
              >
                <Power size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-black text-gray-900">
                    Live Operational Desk
                  </h2>
                  <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-mono font-bold text-gray-600">
                    {liveStatus?.current_ist_time || "IST Time"}
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  {liveStatus?.is_open
                    ? "Store is currently accepting customer orders."
                    : "Order checkout is currently paused."}
                  {liveStatus?.next_opening?.label && !liveStatus.is_open && (
                    <span className="ml-1 font-semibold text-amber-700">
                      (Next shift resumes: {liveStatus.next_opening.label})
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Live Delivery Status Indicator */}
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs shadow-xs">
              <Truck
                size={16}
                className={isPeakHours ? "text-amber-600" : "text-emerald-600"}
              />
              <span className="font-medium text-gray-500">Customer ETA:</span>
              <span
                className={`font-black ${
                  isPeakHours ? "text-amber-700" : "text-emerald-700"
                }`}
              >
                {liveStatus?.delivery_eta_text ||
                  (isPeakHours ? peakDeliveryText : normalDeliveryText)}
              </span>
            </div>
          </div>
        </div>

        {/* 1-Click Master Mode Switchboard (Immediate Action Buttons) */}
        <div className="p-5">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-gray-400">
              1-Click Master Mode Switch (Instant Server Sync)
            </span>
            {togglingOverride && (
              <span className="flex items-center gap-1 text-[11px] font-bold text-[#FF8A00]">
                <RefreshCw size={11} className="animate-spin" />
                Syncing with server...
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* 1. Auto Schedule */}
            <button
              type="button"
              disabled={togglingOverride}
              onClick={() => handleSelectOverride("auto")}
              className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all active:scale-98 ${
                manualOverride === "auto"
                  ? "border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-500/20 shadow-xs"
                  : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50"
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-xs font-black text-gray-900 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Automatic Schedule
                </span>
                {manualOverride === "auto" && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800">
                    ACTIVE
                  </span>
                )}
              </div>
              <p className="mt-2 text-[11px] text-gray-500">
                Follows weekly shift schedule (9:00 AM – 10:00 PM).
              </p>
            </button>

            {/* 2. Rush / Peak Mode Toggle */}
            <button
              type="button"
              disabled={togglingPeak}
              onClick={() => handleTogglePeakHours()}
              className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all active:scale-98 ${
                isPeakHours
                  ? "border-amber-500 bg-amber-50/70 ring-2 ring-amber-500/20 shadow-xs"
                  : "border-gray-200 bg-white hover:border-amber-300 hover:bg-amber-50/20"
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-xs font-black text-gray-900 flex items-center gap-1.5">
                  <Zap
                    size={14}
                    className={isPeakHours ? "text-amber-600 fill-current" : "text-gray-400"}
                  />
                  Peak / Rush Mode
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                    isPeakHours
                      ? "bg-amber-100 text-amber-900"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {isPeakHours ? "ACTIVE (2–3h)" : "OFF (60–90m)"}
                </span>
              </div>
              <p className="mt-2 text-[11px] text-gray-500">
                Keeps store open, but alerts customers of delivery delays.
              </p>
            </button>

            {/* 3. Emergency Pause Store */}
            <button
              type="button"
              disabled={togglingOverride}
              onClick={() => handleSelectOverride("closed")}
              className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all active:scale-98 ${
                manualOverride === "closed"
                  ? "border-red-500 bg-red-50/70 ring-2 ring-red-500/20 shadow-xs"
                  : "border-gray-200 bg-white hover:border-red-300 hover:bg-red-50/20"
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-xs font-black text-gray-900 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  Pause Store Orders
                </span>
                {manualOverride === "closed" && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-800">
                    PAUSED
                  </span>
                )}
              </div>
              <p className="mt-2 text-[11px] text-gray-500">
                Instantly blocks checkout (rain, stockout, emergency).
              </p>
            </button>

            {/* 4. Force Store Open */}
            <button
              type="button"
              disabled={togglingOverride}
              onClick={() => handleSelectOverride("open")}
              className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all active:scale-98 ${
                manualOverride === "open"
                  ? "border-purple-500 bg-purple-50/70 ring-2 ring-purple-500/20 shadow-xs"
                  : "border-gray-200 bg-white hover:border-purple-300 hover:bg-purple-50/20"
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-xs font-black text-gray-900 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-purple-500" />
                  Force Open 24/7
                </span>
                {manualOverride === "open" && (
                  <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-black text-purple-800">
                    FORCED OPEN
                  </span>
                )}
              </div>
              <p className="mt-2 text-[11px] text-gray-500">
                Bypasses schedule (festivals, late night sales).
              </p>
            </button>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 1-CLICK RUSH MODE PRESETS & LIVE CART PREVIEW                  */}
      {/* ============================================================== */}
      <div
        className={`rounded-2xl border p-5 shadow-sm transition-all ${
          isPeakHours
            ? "border-amber-300 bg-gradient-to-br from-amber-50/60 via-white to-orange-50/30 ring-1 ring-amber-300/60"
            : "border-gray-200 bg-white"
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                  isPeakHours
                    ? "bg-amber-500 text-white shadow-xs"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                <Zap size={16} />
              </div>
              <h3 className="text-sm font-black text-gray-900">
                Peak Demand & Delay Presets (1-Click)
              </h3>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                  isPeakHours
                    ? "bg-amber-100 text-amber-900 border border-amber-300"
                    : "bg-gray-100 text-gray-600 border border-gray-200"
                }`}
              >
                {isPeakHours ? "⚡ LIVE ON WEBSITE" : "NORMAL SPEED"}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Click any scenario chip below to instantly alert customers in Cart and Checkout without typing.
            </p>
          </div>

          <button
            type="button"
            onClick={() => handleTogglePeakHours()}
            disabled={togglingPeak}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black shadow-xs transition active:scale-95 shrink-0 ${
              isPeakHours
                ? "bg-amber-600 text-white hover:bg-amber-700 shadow-amber-600/20"
                : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {togglingPeak ? (
              <RefreshCw size={13} className="animate-spin" />
            ) : (
              <Zap size={13} className={isPeakHours ? "fill-current" : ""} />
            )}
            {togglingPeak
              ? "Updating..."
              : isPeakHours
              ? "Deactivate Rush Mode"
              : "⚡ Activate Rush Mode"}
          </button>
        </div>

        {/* 1-Click Rush Preset Chips */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {RUSH_PRESETS.map((preset) => {
            const isCurrentPreset =
              isPeakHours &&
              peakDeliveryText === preset.deliveryText &&
              peakNoticeMessage === preset.notice;

            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectRushPreset(preset)}
                className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold transition active:scale-95 ${
                  isCurrentPreset
                    ? "border-amber-500 bg-amber-500 text-white shadow-sm shadow-amber-500/25"
                    : "border-gray-200 bg-white text-gray-700 hover:border-amber-300 hover:bg-amber-50/40"
                }`}
              >
                <span>{preset.label}</span>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-extrabold ${
                    isCurrentPreset
                      ? "bg-white/20 text-white"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {preset.tag}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setShowCustomPeak(!showCustomPeak)}
            className="flex items-center gap-1 rounded-xl border border-dashed border-gray-300 bg-gray-50/70 px-3 py-2 text-xs font-bold text-gray-600 hover:border-gray-400 hover:bg-gray-100 transition"
          >
            <span>{showCustomPeak ? "Hide Custom Fields" : "✏️ Custom Wording"}</span>
          </button>
        </div>

        {/* Live Customer Preview */}
        <div className="mt-4 rounded-xl border border-gray-200/90 bg-gray-50/70 p-3.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">
              Live Customer Experience Preview (Cart & Checkout)
            </span>
            <span className="text-[10px] font-semibold text-gray-400">
              What customers see on their screens
            </span>
          </div>

          <div
            className={`rounded-xl border p-3 transition-all ${
              isPeakHours
                ? "border-amber-300 bg-gradient-to-r from-amber-50/90 to-orange-50/70"
                : "border-gray-200 bg-white"
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  isPeakHours
                    ? "bg-amber-100 text-amber-700"
                    : "bg-[#F1ECFF] text-[#7C3AED]"
                }`}
              >
                <Truck size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-black text-gray-900">
                    {isPeakHours ? peakDeliveryText : normalDeliveryText}
                  </span>
                  {isPeakHours && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-900 border border-amber-300">
                      ⚡ High Demand
                    </span>
                  )}
                </div>
                {isPeakHours && (
                  <p className="mt-0.5 text-xs font-semibold text-amber-800">
                    {peakNoticeMessage}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Expandable Custom Wording Form */}
        {showCustomPeak && (
          <div className="mt-4 grid grid-cols-1 gap-3 pt-3 border-t border-gray-200 sm:grid-cols-2 animate-fadeIn">
            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">
                Peak Delivery Time Label
              </label>
              <input
                type="text"
                value={peakDeliveryText}
                onChange={(e) => setPeakDeliveryText(e.target.value)}
                placeholder="Delivery in 2–3 hours"
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-900 focus:border-[#FF8A00] focus:outline-none focus:ring-1 focus:ring-[#FF8A00]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">
                Normal Delivery Time Label
              </label>
              <input
                type="text"
                value={normalDeliveryText}
                onChange={(e) => setNormalDeliveryText(e.target.value)}
                placeholder="Delivery in 60–90 mins"
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-900 focus:border-[#FF8A00] focus:outline-none focus:ring-1 focus:ring-[#FF8A00]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-gray-700 mb-1">
                Peak Notice Message (Alert banner across cart & checkout)
              </label>
              <input
                type="text"
                value={peakNoticeMessage}
                onChange={(e) => setPeakNoticeMessage(e.target.value)}
                placeholder="High order volume in progress. Deliveries may take 2–3 hours today."
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-900 focus:border-[#FF8A00] focus:outline-none focus:ring-1 focus:ring-[#FF8A00]"
              />
            </div>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* 1-CLICK CLOSED NOTICE REASON PRESETS                           */}
      {/* ============================================================== */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-[#FF8A00]" />
            <h3 className="text-sm font-black text-gray-900">
              Closed Store Notice Reason (1-Click Chips)
            </h3>
          </div>
          <span className="text-[11px] text-gray-400">
            Displayed to customers when the store is outside operating hours or paused
          </span>
        </div>

        {/* 1-Click Reason Chips */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {CLOSED_PRESETS.map((preset) => {
            const isSelected = closedMessage.trim() === preset.text.trim();
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectClosedPreset(preset)}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition active:scale-95 ${
                  isSelected
                    ? "border-[#FF8A00] bg-orange-50 text-[#FF8A00] ring-1 ring-[#FF8A00]/30"
                    : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <span>{preset.label}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setShowCustomClosed(!showCustomClosed)}
            className="rounded-xl border border-dashed border-gray-300 bg-gray-50/70 px-3 py-1.5 text-xs font-bold text-gray-600 hover:border-gray-400 hover:bg-gray-100 transition"
          >
            {showCustomClosed ? "Hide Custom Text" : "✏️ Customise Message"}
          </button>
        </div>

        {/* Closed Message Display / Input */}
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
          <div className="text-[11px] font-bold text-gray-500 mb-1">Active Notice:</div>
          <p className="text-xs font-semibold text-gray-800 italic">
            &quot;{closedMessage || "Our store is currently closed for new orders."}&quot;
          </p>
        </div>

        {showCustomClosed && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <input
              type="text"
              value={closedMessage}
              onChange={(e) => setClosedMessage(e.target.value)}
              placeholder="e.g. We are closed for new orders. Store opens daily at 09:00 AM IST."
              className="w-full rounded-xl border border-gray-200 px-3.5 py-2 text-xs text-gray-900 focus:border-[#FF8A00] focus:outline-none focus:ring-1 focus:ring-[#FF8A00]"
            />
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* ZONE 2: 1-CLICK WEEKLY OPERATING SCHEDULE MATRIX               */}
      {/* ============================================================== */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <Calendar size={16} className="text-[#FF8A00]" />
              <h3 className="text-sm font-black text-gray-900">
                Weekly Operating Schedule
              </h3>
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              Standard shift hours for each day of the week (IST 24-hour time).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const sourceKey = dayFilter !== "all" ? dayFilter : "monday";
                handleApplyAllDays(sourceKey);
              }}
              className="flex items-center gap-1 text-xs font-bold text-[#FF8A00] hover:underline"
            >
              Copy {dayFilter !== "all" ? dayFilter.toUpperCase() : "Monday"} to all days
              <ChevronRight size={13} />
            </button>
          </div>
        </div>

        {/* 1-Click Shift Templates */}
        <div className="mb-4 rounded-xl border border-orange-100 bg-orange-50/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-orange-950 flex items-center gap-1.5">
              <Sparkles size={13} className="text-[#FF8A00]" />
              1-Click Shift Presets (Apply to Entire Week)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {SHIFT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleApplyShiftPreset(preset)}
                className="flex items-center gap-2 rounded-xl border border-orange-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-800 shadow-xs hover:border-[#FF8A00] hover:bg-orange-50/50 transition active:scale-95"
              >
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Segmented Filter Bar */}
        <div className="mb-4 flex items-center gap-1 overflow-x-auto rounded-xl bg-gray-100/90 p-1.5">
          <button
            type="button"
            onClick={() => setDayFilter("all")}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              dayFilter === "all"
                ? "bg-white text-gray-900 shadow-xs"
                : "text-gray-600 hover:bg-gray-200/60 hover:text-gray-900"
            }`}
          >
            All Days
          </button>

          <div className="h-4 w-[1px] bg-gray-300 mx-0.5 shrink-0" />

          {DAYS_OF_WEEK.map(({ key, short }) => {
            const isSelected = dayFilter === key;
            const isDayEnabled = schedule[key]?.enabled !== false;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setDayFilter(key)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                  isSelected
                    ? "bg-[#FF8A00] text-white shadow-xs font-bold"
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
          }).map(({ key, label }) => {
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
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 font-mono text-xs font-semibold text-gray-800 shadow-xs focus:border-[#FF8A00] focus:outline-none"
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
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 font-mono text-xs font-semibold text-gray-800 shadow-xs focus:border-[#FF8A00] focus:outline-none"
                      />
                    </div>

                    {dayConfig.open > dayConfig.close && (
                      <span className="rounded-md bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-700">
                        🌙 Overnight (+1 Day)
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

      {/* ============================================================== */}
      {/* FLOATING ACTION DOCK (Appears only when schedule has draft changes) */}
      {/* ============================================================== */}
      {isScheduleDirty && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-xl animate-bounce-short">
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-gray-900 p-4 text-white shadow-2xl ring-1 ring-white/10">
            <div className="flex items-center gap-2.5 min-w-0">
              <AlertTriangle size={18} className="text-[#FFA726] shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-bold leading-tight truncate">
                  Unsaved weekly schedule changes
                </p>
                <p className="text-[11px] text-gray-400 leading-tight">
                  Save to apply to live checkout
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleDiscardSchedule}
                className="flex items-center gap-1.5 rounded-xl border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-bold text-gray-300 hover:bg-gray-700 hover:text-white transition"
              >
                <RotateCcw size={12} />
                Discard
              </button>

              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#FF8A00] to-[#FFA726] px-4 py-1.5 text-xs font-bold text-white shadow-md shadow-orange-500/30 hover:brightness-105 active:scale-95 transition disabled:opacity-50"
              >
                {saving ? (
                  <RefreshCw size={12} className="animate-spin" />
                ) : (
                  <Save size={12} />
                )}
                {saving ? "Saving..." : "Save Schedule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default StoreHours;
