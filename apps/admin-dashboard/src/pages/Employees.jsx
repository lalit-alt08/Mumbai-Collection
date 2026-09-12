import { useEffect, useState } from "react";
import {
  ShieldCheck,
  Search,
  UserPlus,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  Ban,
  KeyRound,
  Mail,
  Phone,
  AlertTriangle,
  X,
  UserCheck,
  Shield,
  Loader2,
  Info,
} from "lucide-react";
import {
  getEmployees,
  requestEmployeeAccess,
  approveEmployee,
  rejectEmployee,
  updateEmployeeStatus,
  revokeEmployeeSessions,
} from "../services/adminApi";

function Employees() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const requestIdRef = useRef(0);
  const [statusFilter, setStatusFilter] = useState("all");

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addForm, setAddForm] = useState({ email: "", role: "employee", notes: "" });
  const [addLoading, setAddLoading] = useState(false);

  // Action confirmation modals
  const [actionTarget, setActionTarget] = useState(null); // employee item
  const [actionType, setActionType] = useState(null); // 'approve' | 'reject' | 'deactivate' | 'reactivate' | 'revoke'
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      const normalized = searchQuery.trim();
      setDebouncedSearch(normalized.length >= 2 ? normalized : "");
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchEmployeeList = async () => {
    const requestId = ++requestIdRef.current;
    try {
      setLoading(true);
      setError("");
      const res = await getEmployees({
        search: debouncedSearch || undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
      });

      if (res.success) {
        if (requestId !== requestIdRef.current) return;
        setEmployees(res.employees || []);
      } else {
        setError(res.message || "Failed to load staff list.");
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err.response?.data?.message || err.message || "Failed to load staff list.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployeeList();
  }, [debouncedSearch, statusFilter]);

  const showSuccess = (msg) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(""), 5000);
  };

  // Add / Allowlist submit handler
  const handleAddEmployee = async (e) => {
    e.preventDefault();
    if (!addForm.email) return;

    try {
      setAddLoading(true);
      setError("");
      const res = await requestEmployeeAccess(addForm);

      if (res.success) {
        showSuccess(res.message || "Employee access requested successfully.");
        setIsAddModalOpen(false);
        setAddForm({ email: "", role: "employee", notes: "" });
        fetchEmployeeList();
      } else {
        setError(res.message || "Failed to request employee access.");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to request employee access.");
    } finally {
      setAddLoading(false);
    }
  };

  // Execute Action
  const handleConfirmAction = async () => {
    if (!actionTarget || !actionType) return;
    try {
      setActionLoading(true);
      setError("");

      if (actionType === "approve") {
        const res = await approveEmployee(actionTarget.id, { role: "employee" });
        showSuccess(res.message || "Employee approved successfully.");
      } else if (actionType === "reject") {
        const res = await rejectEmployee(actionTarget.id, { reason: rejectReason });
        showSuccess(res.message || "Employee request rejected.");
      } else if (actionType === "deactivate") {
        const res = await updateEmployeeStatus(actionTarget.id, { status: "deactivated" });
        showSuccess(res.message || "Employee access deactivated and sessions revoked.");
      } else if (actionType === "reactivate") {
        const res = await updateEmployeeStatus(actionTarget.id, { status: "active" });
        showSuccess(res.message || "Employee access reactivated.");
      } else if (actionType === "revoke") {
        const res = await revokeEmployeeSessions(actionTarget.id);
        showSuccess(res.message || "All sessions revoked successfully.");
      }

      setActionTarget(null);
      setActionType(null);
      fetchEmployeeList();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Action failed.");
    } finally {
      setActionLoading(false);
    }
  };

  // Calculate statistics
  const activeCount = employees.filter((e) => e.status === "approved").length;
  const pendingCount = employees.filter((e) => e.status === "pending").length;
  const allowlistCount = employees.filter((e) => e.status === "allowlisted").length;
  const deactivatedCount = employees.filter((e) => e.status === "deactivated" || e.status === "rejected").length;

  const getStatusBadge = (status) => {
    switch (status) {
      case "approved":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 border border-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
            Active Staff
          </span>
        );
      case "pending":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 border border-amber-200">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0 animate-pulse" />
            Pending Approval
          </span>
        );
      case "allowlisted":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700 border border-blue-200">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
            Allowlisted (Pending Reg.)
          </span>
        );
      case "deactivated":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 border border-rose-200">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" />
            Deactivated
          </span>
        );
      case "rejected":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-700 border border-gray-200">
            <span className="h-1.5 w-1.5 rounded-full bg-gray-400 shrink-0" />
            Rejected
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-bold text-gray-600 border border-gray-200">
            {status}
          </span>
        );
    }
  };

  const getRoleBadge = (role) => {
    if (role === "employee") {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-black text-blue-700 border border-blue-200">
          <UserCheck size={11} className="text-blue-600" />
          Employee
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
        Customer
      </span>
    );
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900">
            Employee Access Control
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Authorize and manage employee accounts, assign roles, and revoke panel permissions.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchEmployeeList}
            disabled={loading}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 shadow-2xs transition cursor-pointer disabled:opacity-50"
            title="Refresh Staff List"
          >
            <RotateCcw size={16} className={loading ? "animate-spin text-[#FF8A00]" : ""} />
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#FF8A00] px-4 py-2.5 text-xs font-black text-white shadow-[0_4px_16px_rgba(255,138,0,0.3)] hover:bg-[#e67c00] active:scale-95 transition cursor-pointer"
          >
            <UserPlus size={15} />
            <span>Add / Allowlist Staff</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="flex items-center justify-between rounded-xl bg-rose-50 border border-rose-200 p-3.5 text-xs font-bold text-rose-800">
          <div className="flex items-center gap-2">
            <XCircle size={16} className="text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError("")} className="text-rose-400 hover:text-rose-700">
            <X size={14} />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="flex items-center justify-between rounded-xl bg-emerald-50 border border-emerald-200 p-3.5 text-xs font-bold text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage("")} className="text-emerald-400 hover:text-emerald-700">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500">Active Staff</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <UserCheck size={16} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-gray-900">{activeCount}</p>
        </div>

        <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500">Pending Approvals</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Clock size={16} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-gray-900">{pendingCount}</p>
        </div>

        <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500">Allowlisted Emails</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Mail size={16} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-gray-900">{allowlistCount}</p>
        </div>

        <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500">Deactivated / Inactive</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <Ban size={16} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-gray-900">{deactivatedCount}</p>
        </div>
      </div>

      {/* Search & Tabs Toolbar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-gray-200 shadow-2xs">
        {/* Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1">
          {[
            { id: "all", label: "All Staff" },
            { id: "pending", label: `Pending (${pendingCount})` },
            { id: "approved", label: "Active" },
            { id: "allowlisted", label: `Allowlisted (${allowlistCount})` },
            { id: "deactivated", label: "Deactivated" },
          ].map((tab) => {
            const isSelected = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                  isSelected
                    ? "bg-[#121417] text-white shadow-2xs"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative w-full md:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search email, name, phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-3 text-xs font-semibold text-gray-800 placeholder-gray-400 outline-none focus:border-[#FF8A00] focus:bg-white transition"
          />
        </div>
      </div>

      {/* Staff List Table */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-2xs overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Loader2 size={32} className="animate-spin text-[#FF8A00] mb-2" />
            <p className="text-xs font-bold">Loading staff directory...</p>
          </div>
        ) : employees.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-gray-400 px-4">
            <ShieldCheck size={40} className="text-gray-300 mb-2" />
            <p className="text-sm font-bold text-gray-700">No staff accounts match your criteria</p>
            <p className="text-xs text-gray-400 max-w-sm mt-1">
              Add a new staff email or adjust your status filter above.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/75 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">
                  <th className="py-3 px-4">Staff Member</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Requested / Approved</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {employees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-gray-50/60 transition">
                    {/* Member Details */}
                    <td className="py-3.5 px-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-gray-900 truncate">
                            {emp.name || "Candidate"}
                          </span>
                          {!emp.is_registered && (
                            <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
                              Unregistered
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-gray-500 text-[11px] mt-0.5">
                          <span className="flex items-center gap-1 truncate">
                            <Mail size={11} className="text-gray-400 shrink-0" />
                            {emp.email}
                          </span>
                          {emp.phone && (
                            <span className="hidden sm:flex items-center gap-1">
                              <Phone size={11} className="text-gray-400 shrink-0" />
                              {emp.phone}
                            </span>
                          )}
                        </div>
                        {emp.notes && (
                          <p className="text-[10px] text-gray-400 italic mt-0.5 truncate max-w-xs">
                            Note: {emp.notes}
                          </p>
                        )}
                      </div>
                    </td>

                    {/* Role */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {getRoleBadge(emp.role)}
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {getStatusBadge(emp.status)}
                    </td>

                    {/* Timeline */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-[11px] text-gray-500">
                      {emp.status === "approved" && emp.approved_at ? (
                        <span>Approved {new Date(emp.approved_at).toLocaleDateString("en-IN")}</span>
                      ) : emp.requested_at ? (
                        <span>Requested {new Date(emp.requested_at).toLocaleDateString("en-IN")}</span>
                      ) : (
                        "—"
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {emp.status === "pending" && emp.is_registered && (
                          <>
                            <button
                              onClick={() => {
                                setActionTarget(emp);
                                setActionType("approve");
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 transition shadow-2xs cursor-pointer"
                            >
                              <CheckCircle2 size={12} />
                              <span>Approve</span>
                            </button>
                            <button
                              onClick={() => {
                                setActionTarget(emp);
                                setRejectReason("");
                                setActionType("reject");
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-bold text-gray-600 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition cursor-pointer"
                            >
                              <XCircle size={12} />
                              <span>Reject</span>
                            </button>
                          </>
                        )}

                        {emp.status === "approved" && (
                          <>
                            <button
                              onClick={() => {
                                setActionTarget(emp);
                                setActionType("revoke");
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-bold text-gray-700 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200 transition cursor-pointer"
                              title="Revoke active sessions"
                            >
                              <KeyRound size={12} />
                              <span className="hidden sm:inline">Revoke Sessions</span>
                            </button>

                            <button
                              onClick={() => {
                                setActionTarget(emp);
                                setActionType("deactivate");
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition cursor-pointer"
                              title="Deactivate Employee"
                            >
                              <Ban size={12} />
                              <span>Deactivate</span>
                            </button>
                          </>
                        )}

                        {(emp.status === "deactivated" || emp.status === "rejected") && emp.is_registered && (
                          <button
                            onClick={() => {
                              setActionTarget(emp);
                              setActionType("reactivate");
                            }}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 transition shadow-2xs cursor-pointer"
                          >
                            <RotateCcw size={12} />
                            <span>Reactivate</span>
                          </button>
                        )}

                        {emp.status === "allowlisted" && (
                          <span className="text-[11px] text-gray-400 font-semibold italic">
                            Awaiting customer registration
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Allowlist Employee Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-gray-100 space-y-5">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <UserPlus size={18} className="text-[#FF8A00]" />
                <h3 className="text-base font-black text-gray-900">Add / Allowlist Staff</h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="rounded-xl border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-700 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleAddEmployee} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-bold text-gray-700 uppercase tracking-wider text-[11px]">
                  Employee Email Address *
                </label>
                <input
                  type="email"
                  required
                  placeholder="employee@mumbaicollection.com"
                  value={addForm.email}
                  onChange={(e) => setAddForm((prev) => ({ ...prev, email: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 p-2.5 font-semibold text-gray-800 outline-none focus:border-[#FF8A00] focus:bg-white focus:ring-2 focus:ring-[#FF8A00]/20"
                />
                <p className="text-[10px] text-gray-400">
                  If the user already has a customer account, they will be queued for approval. If not, they will be allowlisted for when they register.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-gray-700 uppercase tracking-wider text-[11px]">
                  Assigned Role
                </label>
                <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 font-bold text-gray-800">
                  <Shield size={15} className="text-[#FF8A00] shrink-0" />
                  <span>Employee — Employee Panel</span>
                </div>
                <p className="text-[10px] text-gray-400">
                  Provides dedicated access to orders, fulfillment, dispatch pipeline, and inventory.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2 font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addLoading || !addForm.email}
                  className="rounded-xl bg-[#FF8A00] px-5 py-2 font-extrabold text-white shadow-xs hover:bg-[#e67c00] active:scale-95 transition disabled:opacity-40 cursor-pointer"
                >
                  {addLoading ? "Processing..." : "Submit Staff Access"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Action Modal */}
      {actionTarget && actionType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-gray-100 space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                {actionType === "approve" && <CheckCircle2 size={18} className="text-emerald-600" />}
                {actionType === "reject" && <XCircle size={18} className="text-rose-600" />}
                {actionType === "deactivate" && <Ban size={18} className="text-rose-600" />}
                {actionType === "reactivate" && <RotateCcw size={18} className="text-emerald-600" />}
                {actionType === "revoke" && <KeyRound size={18} className="text-amber-600" />}

                <h3 className="text-base font-black text-gray-900 capitalize">
                  {`${actionType} Employee Access`}
                </h3>
              </div>
              <button
                onClick={() => {
                  setActionTarget(null);
                  setActionType(null);
                }}
                className="rounded-xl border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-700 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-gray-700">
                Target User:{" "}
                <span className="font-bold text-gray-900">{actionTarget.name}</span> (
                <span className="font-mono text-gray-600">{actionTarget.email}</span>)
              </p>

              {actionType === "approve" && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-emerald-900 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold">
                    <UserCheck size={14} className="text-emerald-700 shrink-0" />
                    <span>Assign Role: Employee (Employee Panel)</span>
                  </div>
                  <p className="text-[11px] text-emerald-800 leading-relaxed">
                    This will grant this account access to the Employee Panel for orders, dispatch, and inventory management.
                  </p>
                </div>
              )}

              {actionType === "reject" && (
                <div className="space-y-1.5">
                  <label className="font-bold text-gray-700 uppercase tracking-wider text-[11px]">
                    Reason for Rejection (Optional):
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Unverified staff member"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 p-2.5 font-semibold text-gray-800 outline-none focus:border-rose-500 focus:bg-white"
                  />
                </div>
              )}

              {actionType === "deactivate" && (
                <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-rose-800 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold">
                    <AlertTriangle size={14} className="text-rose-600 shrink-0" />
                    <span>Immediate Session Invalidation</span>
                  </div>
                  <p className="text-[11px] text-rose-700 leading-relaxed">
                    Deactivating this employee will immediately revoke all active sessions on the Employee Panel. Their account role will revert to a standard customer account.
                  </p>
                </div>
              )}

              {actionType === "revoke" && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-800 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold">
                    <Info size={14} className="text-amber-600 shrink-0" />
                    <span>Force Sign-out</span>
                  </div>
                  <p className="text-[11px] text-amber-700 leading-relaxed">
                    This will invalidate all current WordPress session cookies across all devices for this employee, requiring them to sign in again.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => {
                  setActionTarget(null);
                  setActionType(null);
                }}
                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleConfirmAction}
                className={`rounded-xl px-5 py-2 text-xs font-extrabold text-white shadow-xs transition active:scale-95 cursor-pointer disabled:opacity-50 ${
                  actionType === "approve" || actionType === "reactivate"
                    ? "bg-emerald-600 hover:bg-emerald-500"
                    : actionType === "reject" || actionType === "deactivate"
                    ? "bg-rose-600 hover:bg-rose-500"
                    : "bg-[#121417] hover:bg-gray-800"
                }`}
              >
                {actionLoading ? "Processing..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Employees;
