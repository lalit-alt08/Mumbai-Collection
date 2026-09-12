import { useState } from "react";
import {
  Search,
  UserX,
  UserCheck,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
  Loader2,
  ShieldAlert,
  Calendar,
  Mail,
  User,
  Phone,
  FileText,
} from "lucide-react";
import {
  lookupCustomerSuspension,
  suspendCustomer,
  unsuspendCustomer,
} from "../services/adminApi";

const DURATION_OPTIONS = [
  { id: "3_months", label: "3 Months", desc: "Active for 90 days from today" },
  { id: "6_months", label: "6 Months", desc: "Active for 180 days from today" },
  { id: "permanent", label: "Permanent", desc: "No expiry until manually unsuspended" },
];

export default function CustomerSuspension() {
  const [searchEmail, setSearchEmail] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [customer, setCustomer] = useState(null);

  // Form State
  const [selectedDuration, setSelectedDuration] = useState("3_months");
  const [reason, setReason] = useState("");

  // Feedback State
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Modal State
  const [confirmModal, setConfirmModal] = useState(null); // 'suspend' | 'unsuspend' | null
  const [actionLoading, setActionLoading] = useState(false);

  const showSuccess = (msg) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(""), 6000);
  };

  const handleLookup = async (e) => {
    if (e) e.preventDefault();
    const email = searchEmail.trim();
    if (!email) {
      setError("Please enter a customer email address.");
      return;
    }

    try {
      setLookupLoading(true);
      setError("");
      setSuccessMessage("");
      const res = await lookupCustomerSuspension(email);

      if (res.success && res.customer) {
        setCustomer(res.customer);
        // Default duration if customer already had one or fallback
        if (res.customer.duration) {
          setSelectedDuration(res.customer.duration);
        }
        if (res.customer.reason) {
          setReason(res.customer.reason);
        } else {
          setReason("");
        }
      } else {
        setCustomer(null);
        setError(res.message || "Customer not found.");
      }
    } catch (err) {
      setCustomer(null);
      setError(
        err.response?.data?.message ||
          err.message ||
          "Failed to look up customer."
      );
    } finally {
      setLookupLoading(false);
    }
  };

  const handleSuspendSubmit = async () => {
    if (!customer) return;

    try {
      setActionLoading(true);
      setError("");
      const res = await suspendCustomer({
        email: customer.email,
        duration: selectedDuration,
        reason: reason.trim(),
      });

      if (res.success) {
        showSuccess(res.message || "Customer account suspended successfully.");
        setConfirmModal(null);
        // Refresh customer details
        const updated = await lookupCustomerSuspension(customer.email);
        if (updated.success && updated.customer) {
          setCustomer(updated.customer);
        }
      } else {
        setError(res.message || "Failed to suspend customer.");
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Failed to suspend customer."
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnsuspendSubmit = async () => {
    if (!customer) return;

    try {
      setActionLoading(true);
      setError("");
      const res = await unsuspendCustomer({
        email: customer.email,
      });

      if (res.success) {
        showSuccess(res.message || "Customer suspension removed successfully.");
        setConfirmModal(null);
        // Refresh customer details
        const updated = await lookupCustomerSuspension(customer.email);
        if (updated.success && updated.customer) {
          setCustomer(updated.customer);
        }
      } else {
        setError(res.message || "Failed to remove customer suspension.");
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Failed to remove customer suspension."
      );
    } finally {
      setActionLoading(false);
    }
  };

  const formatDateTime = (isoString) => {
    if (!isoString) return "N/A";
    try {
      return new Date(isoString).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div>
        <h1 className="text-xl font-black text-gray-900 tracking-tight flex items-center gap-2.5">
          <UserX className="text-[#FF8A00]" size={24} />
          Customer Suspension
        </h1>
        <p className="text-xs text-gray-500 mt-1">
          Restrict customer accounts from placing new orders while preserving login, cart, and order history.
        </p>
      </div>

      {/* Alert Banners */}
      {error && (
        <div className="flex items-center justify-between rounded-2xl bg-rose-50 border border-rose-200 p-4 text-xs font-bold text-rose-800 animate-in fade-in duration-150">
          <div className="flex items-center gap-2.5">
            <XCircle size={18} className="text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError("")}
            className="text-rose-400 hover:text-rose-700 transition"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="flex items-center justify-between rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-xs font-bold text-emerald-800 animate-in fade-in duration-150">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button
            onClick={() => setSuccessMessage("")}
            className="text-emerald-400 hover:text-emerald-700 transition"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Search & Lookup Card */}
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-xs">
        <h2 className="text-sm font-black text-gray-900 mb-1">
          Lookup Registered Customer
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Enter the registered customer's email address to inspect account status or apply restrictions.
        </p>

        <form onSubmit={handleLookup} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Mail
              size={18}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="email"
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              placeholder="customer@example.com"
              className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 py-3 pl-10 pr-4 text-xs font-medium text-gray-900 placeholder:text-gray-400 focus:border-[#FF8A00] focus:bg-white focus:outline-hidden transition"
            />
          </div>

          <button
            type="submit"
            disabled={lookupLoading}
            className="flex items-center justify-center gap-2 rounded-2xl bg-[#121417] px-6 py-3 text-xs font-bold text-white hover:bg-black transition active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
          >
            {lookupLoading ? (
              <>
                <Loader2 size={16} className="animate-spin text-[#FF8A00]" />
                Checking Account...
              </>
            ) : (
              <>
                <Search size={16} />
                Lookup Account
              </>
            )}
          </button>
        </form>
      </div>

      {/* Customer Record & Action Card */}
      {customer && (
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-xs space-y-6">
          {/* Customer Meta Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-gray-100">
            <div className="flex items-start gap-4">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-2xl shrink-0 font-bold ${
                  customer.is_suspended
                    ? "bg-rose-50 text-rose-600 border border-rose-100"
                    : "bg-emerald-50 text-emerald-600 border border-emerald-100"
                }`}
              >
                {customer.is_suspended ? <UserX size={24} /> : <UserCheck size={24} />}
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h3 className="text-base font-black text-gray-900">
                    {customer.name || "Registered Customer"}
                  </h3>
                  {customer.is_suspended ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-3 py-1 text-[11px] font-extrabold text-rose-700">
                      <ShieldAlert size={12} />
                      Suspended
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-extrabold text-emerald-700">
                      <CheckCircle2 size={12} />
                      Active (Allowed to order)
                    </span>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Mail size={13} className="text-gray-400" />
                    {customer.email}
                  </span>
                  {customer.phone && (
                    <span className="flex items-center gap-1">
                      <Phone size={13} className="text-gray-400" />
                      {customer.phone}
                    </span>
                  )}
                  {customer.registered_at && (
                    <span className="flex items-center gap-1">
                      <Calendar size={13} className="text-gray-400" />
                      Joined {formatDateTime(customer.registered_at)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* If Currently Suspended: Details & Unsuspend Action */}
          {customer.is_suspended ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-5 space-y-3">
                <div className="flex items-center gap-2 text-xs font-black text-rose-900">
                  <Clock size={16} className="text-rose-600" />
                  <span>Suspension Details</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="bg-white/80 rounded-xl p-3 border border-rose-100">
                    <span className="text-gray-500 block text-[11px] font-bold">
                      Duration:
                    </span>
                    <span className="font-extrabold text-gray-900 capitalize">
                      {customer.is_permanent
                        ? "Permanent"
                        : customer.duration
                        ? customer.duration.replace("_", " ")
                        : "Temporary"}
                    </span>
                  </div>

                  <div className="bg-white/80 rounded-xl p-3 border border-rose-100">
                    <span className="text-gray-500 block text-[11px] font-bold">
                      Order Restriction Expiry:
                    </span>
                    <span className="font-extrabold text-gray-900">
                      {customer.is_permanent
                        ? "Never (Permanent)"
                        : formatDateTime(customer.expires_at)}
                    </span>
                  </div>
                </div>

                {customer.reason && (
                  <div className="bg-white/80 rounded-xl p-3 border border-rose-100 text-xs">
                    <span className="text-gray-500 block text-[11px] font-bold mb-0.5">
                      Internal Management Note:
                    </span>
                    <p className="text-gray-800 font-medium whitespace-pre-wrap">
                      {customer.reason}
                    </p>
                  </div>
                )}

                <div className="text-[11px] text-gray-600 font-medium">
                  Note: The customer can still log in, browse products, view addresses, and check order history. They are blocked from placing new orders at checkout.
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmModal("unsuspend")}
                  className="rounded-2xl bg-emerald-600 px-6 py-3 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm transition active:scale-95 cursor-pointer flex items-center gap-2"
                >
                  <UserCheck size={16} />
                  Remove Suspension (Restore Orders)
                </button>
              </div>
            </div>
          ) : (
            /* If Active: Suspension Setup Form */
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-black text-gray-900 mb-2">
                  Select Suspension Duration <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {DURATION_OPTIONS.map((opt) => {
                    const isSelected = selectedDuration === opt.id;
                    return (
                      <div
                        key={opt.id}
                        onClick={() => setSelectedDuration(opt.id)}
                        className={`cursor-pointer rounded-2xl border p-4 transition text-left flex flex-col justify-between ${
                          isSelected
                            ? "border-[#FF8A00] bg-[#FF8A00]/5 ring-1 ring-[#FF8A00]"
                            : "border-gray-200 bg-white hover:bg-gray-50/60"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={`text-xs font-black ${
                              isSelected ? "text-[#FF8A00]" : "text-gray-900"
                            }`}
                          >
                            {opt.label}
                          </span>
                          <div
                            className={`h-4 w-4 rounded-full border flex items-center justify-center ${
                              isSelected
                                ? "border-[#FF8A00] bg-[#FF8A00]"
                                : "border-gray-300"
                            }`}
                          >
                            {isSelected && (
                              <div className="h-1.5 w-1.5 rounded-full bg-white" />
                            )}
                          </div>
                        </div>
                        <span className="text-[11px] text-gray-500 font-medium">
                          {opt.desc}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-gray-900 mb-1.5">
                  Internal Reason (Optional)
                </label>
                <textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g., Repeated delivery refusal, abuse of cash on delivery, or fraudulent activity. (Admin-only note)"
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 p-3 text-xs font-medium text-gray-900 placeholder:text-gray-400 focus:border-[#FF8A00] focus:bg-white focus:outline-hidden transition"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  This note is private to administrators and is never shown to the customer.
                </p>
              </div>

              <div className="rounded-2xl bg-amber-50/70 border border-amber-200 p-4 text-xs font-medium text-amber-900 flex items-start gap-2.5">
                <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-black block text-amber-950">
                    Order Placement Restriction:
                  </span>
                  Suspension will strictly block this account from completing checkout. Their login session, saved cart, addresses, and past order history will remain active.
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmModal("suspend")}
                  className="rounded-2xl bg-rose-600 px-6 py-3 text-xs font-bold text-white hover:bg-rose-700 shadow-sm transition active:scale-95 cursor-pointer flex items-center gap-2"
                >
                  <UserX size={16} />
                  Suspend Account
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Suspend Confirmation Modal */}
      {confirmModal === "suspend" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-gray-100 space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert size={18} className="text-rose-600" />
                <h3 className="text-base font-black text-gray-900">
                  Confirm Account Suspension
                </h3>
              </div>
              <button
                onClick={() => setConfirmModal(null)}
                className="rounded-xl border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-700 transition"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 text-xs text-gray-600 font-medium">
              <p>
                Are you sure you want to suspend order privileges for:
              </p>
              <div className="rounded-2xl bg-gray-50 p-3 border border-gray-200 font-bold text-gray-900 space-y-1">
                <div>{customer?.name}</div>
                <div className="text-gray-500 font-normal">{customer?.email}</div>
              </div>

              <div className="flex justify-between items-center text-xs py-1">
                <span className="text-gray-500 font-bold">Selected Duration:</span>
                <span className="font-extrabold text-rose-700 capitalize">
                  {selectedDuration.replace("_", " ")}
                </span>
              </div>

              <p className="text-[11px] text-gray-500">
                The customer will receive a 403 Forbidden notice during checkout and will be prevented from placing new orders until the suspension period ends or is manually removed.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                disabled={actionLoading}
                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSuspendSubmit}
                disabled={actionLoading}
                className="rounded-xl bg-rose-600 px-5 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-rose-700 transition active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
              >
                {actionLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Suspending...
                  </>
                ) : (
                  "Confirm Suspension"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unsuspend Confirmation Modal */}
      {confirmModal === "unsuspend" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-gray-100 space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <UserCheck size={18} className="text-emerald-600" />
                <h3 className="text-base font-black text-gray-900">
                  Restore Ordering Privileges
                </h3>
              </div>
              <button
                onClick={() => setConfirmModal(null)}
                className="rounded-xl border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-700 transition"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 text-xs text-gray-600 font-medium">
              <p>
                Are you sure you want to remove suspension and restore checkout privileges for:
              </p>
              <div className="rounded-2xl bg-gray-50 p-3 border border-gray-200 font-bold text-gray-900 space-y-1">
                <div>{customer?.name}</div>
                <div className="text-gray-500 font-normal">{customer?.email}</div>
              </div>

              <p className="text-[11px] text-gray-500">
                This will immediately re-enable checkout and order placement for this customer.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                disabled={actionLoading}
                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUnsuspendSubmit}
                disabled={actionLoading}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-emerald-700 transition active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
              >
                {actionLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Restoring...
                  </>
                ) : (
                  "Confirm & Restore"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
