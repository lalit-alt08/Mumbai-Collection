import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import API_URL from "../config/api.js";
import axios from "axios";
import {
  DELIVERY_REGIONS,
  DEFAULT_STORE_STATE,
  isValidDeliveryRegion,
  isValidIndianPhone,
} from "../data/indianStates.js";
import ConfirmModal from "../components/common/ConfirmModal.jsx";

import { useAuth } from "../context/AuthContext";

const API = `${API_URL}/addresses`;
import {
  MapPin,
  Pencil,
  Trash2,
  Plus,
  Home,
  Building2,
  X,
  Loader2,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

const emptyForm = {
  type: "home",
  first_name: "",
  last_name: "",
  phone: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "MH",
};

function Addresses() {
  const navigate = useNavigate();
  const { handleSessionExpired } = useAuth();
  const [addresses, setAddresses] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Custom confirmation modal state
  const [addressToDelete, setAddressToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Status feedback toast/banner
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [form, setForm] = useState(emptyForm);

  const getCleanDisplayName = (fullName, firstName, lastName, fallback = "Saved Address") => {
    const f = (firstName || "").trim();
    const l = (lastName || "").trim();
    if (f || l) {
      if (f && l && f.toLowerCase() === l.toLowerCase()) return f;
      if (f && l) return `${f} ${l}`;
      return f || l || fallback;
    }
    if (fullName) {
      const parts = fullName.trim().split(/\s+/);
      if (parts.length === 2 && parts[0].toLowerCase() === parts[1].toLowerCase()) {
        return parts[0];
      }
      return fullName.trim();
    }
    return fallback;
  };

  // --------------------------------------------------
  // LOAD ADDRESSES
  // --------------------------------------------------

  const loadAddresses = async () => {
    try {
      setLoading(true);
      setFeedback({ type: "", message: "" });

      const response = await axios.get(API, {
        withCredentials: true,
      });

      setAddresses(response.data.addresses || []);
    } catch (error) {
      if (error.response?.status === 401) {
        if (handleSessionExpired) {
          handleSessionExpired();
        }
        navigate("/login", {
          replace: true,
          state: { from: "/addresses" },
        });
        return;
      }
      setFeedback({
        type: "error",
        message:
          error.response?.data?.message ||
          "Unable to load addresses. Please refresh and try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAddresses();
  }, []);

  // --------------------------------------------------
  // STRICT CAPACITY & TYPE AVAILABILITY
  // --------------------------------------------------

  const hasHome = addresses.some((a) => a.type?.toLowerCase() === "home");
  const hasOffice = addresses.some((a) => a.type?.toLowerCase() === "office");
  const canAddAddress = !hasHome || !hasOffice;

  // Types available for current form mode (Create vs Edit)
  const isHomeAvailable = !editingId
    ? !hasHome
    : !addresses.some((a) => a.id !== editingId && a.type?.toLowerCase() === "home");

  const isOfficeAvailable = !editingId
    ? !hasOffice
    : !addresses.some((a) => a.id !== editingId && a.type?.toLowerCase() === "office");

  // --------------------------------------------------
  // FORM HANDLING
  // --------------------------------------------------

  const handleChange = (e) => {
    let { name, value } = e.target;

    if (name === "phone") {
      value = value.replace(/\D/g, "").slice(0, 10);
    }

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));

    if (fieldErrors[name]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }

    setFormError("");
  };

  const openAddForm = () => {
    if (!canAddAddress) return;

    // Automatically default to the remaining available type
    const defaultType = !hasHome ? "home" : "office";

    setEditingId(null);
    setForm({
      ...emptyForm,
      type: defaultType,
    });
    setFormError("");
    setFieldErrors({});
    setFeedback({ type: "", message: "" });
    setShowForm(true);
  };

  const openEditForm = (address) => {
    setEditingId(address.id);
    const parts = (address.full_name || "").trim().split(/\s+/);
    const parsedFirst = address.first_name || parts[0] || "";
    const parsedLast = address.last_name || (parts.length > 1 ? parts.slice(1).join(" ") : "");

    setForm({
      type: address.type || "home",
      first_name: parsedFirst,
      last_name: parsedLast,
      phone: address.phone || "",
      address_line1: address.address_line1 || "",
      address_line2: address.address_line2 || "",
      city: address.city || "",
      state: address.state || "MH",
    });

    setFormError("");
    setFieldErrors({});
    setFeedback({ type: "", message: "" });
    setShowForm(true);
  };

  const closeForm = () => {
    if (saving) return;

    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setFormError("");
    setFieldErrors({});
  };

  // --------------------------------------------------
  // ADD / UPDATE ADDRESS
  // --------------------------------------------------

  const handleSubmit = async (e) => {
    e.preventDefault();

    setFormError("");
    const errors = {};

    if (!form.type || (form.type !== "home" && form.type !== "office")) {
      errors.type = "Please select a valid address type.";
    }

    // Client-side validation guarding against duplicate type
    if (!editingId && form.type === "home" && hasHome) {
      errors.type = "A Home address is already saved. You can only add an Office address.";
    } else if (!editingId && form.type === "office" && hasOffice) {
      errors.type = "An Office address is already saved. You can only add a Home address.";
    } else if (
      editingId &&
      form.type === "home" &&
      addresses.some((a) => a.id !== editingId && a.type?.toLowerCase() === "home")
    ) {
      errors.type = "Another Home address is already saved.";
    } else if (
      editingId &&
      form.type === "office" &&
      addresses.some((a) => a.id !== editingId && a.type?.toLowerCase() === "office")
    ) {
      errors.type = "Another Office address is already saved.";
    }

    if (!form.first_name || !form.first_name.trim()) {
      errors.first_name = "First name is required.";
    }

    if (!form.last_name || !form.last_name.trim()) {
      errors.last_name = "Last name is required.";
    }

    if (!form.phone || !form.phone.trim()) {
      errors.phone = "Mobile number is required.";
    } else if (!isValidIndianPhone(form.phone)) {
      errors.phone = "Please enter a valid 10-digit mobile number.";
    }

    if (!form.address_line1 || !form.address_line1.trim()) {
      errors.address_line1 = "Please enter your street address / house number.";
    }

    if (!form.city || !form.city.trim() || !isValidDeliveryRegion(form.city)) {
      errors.city = "Please select your delivery region.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError("Please fill in the required fields highlighted in red below.");
      return;
    }

    try {
      setSaving(true);

      const cleanFirst = form.first_name.trim();
      const cleanLast = form.last_name.trim();
      const payload = {
        ...form,
        first_name: cleanFirst,
        last_name: cleanLast,
        full_name: `${cleanFirst} ${cleanLast}`,
      };

      if (editingId) {
        // UPDATE
        await axios.put(
          `${API}/${editingId}`,
          payload,
          {
            withCredentials: true,
          }
        );
        setFeedback({
          type: "success",
          message: `${form.type === "home" ? "Home" : "Office"} address updated successfully!`,
        });
      } else {
        // CREATE
        await axios.post(
          API,
          payload,
          {
            withCredentials: true,
          }
        );
        setFeedback({
          type: "success",
          message: `${form.type === "home" ? "Home" : "Office"} address saved successfully!`,
        });
      }

      // Auto dismiss success toast after 4s
      setTimeout(() => {
        setFeedback((prev) => (prev.type === "success" ? { type: "", message: "" } : prev));
      }, 4000);

      // Refresh list from backend
      await loadAddresses();
      closeForm();
    } catch (error) {
      const msg = error.response?.data?.message || "Unable to save address.";
      setFormError(msg);
      if (msg.toLowerCase().includes("phone") || msg.toLowerCase().includes("mobile")) {
        setFieldErrors((prev) => ({ ...prev, phone: msg }));
      } else if (msg.toLowerCase().includes("first name")) {
        setFieldErrors((prev) => ({ ...prev, first_name: msg }));
      } else if (msg.toLowerCase().includes("last name")) {
        setFieldErrors((prev) => ({ ...prev, last_name: msg }));
      } else if (msg.toLowerCase().includes("address") || msg.toLowerCase().includes("street")) {
        setFieldErrors((prev) => ({ ...prev, address_line1: msg }));
      } else if (msg.toLowerCase().includes("city") || msg.toLowerCase().includes("region")) {
        setFieldErrors((prev) => ({ ...prev, city: msg }));
      }
    } finally {
      setSaving(false);
    }
  };

  // --------------------------------------------------
  // DELETE ADDRESS (CUSTOM IN-APP MODAL)
  // --------------------------------------------------

  const handlePromptDelete = (address) => {
    setAddressToDelete(address);
  };

  const handleConfirmDelete = async () => {
    if (!addressToDelete || isDeleting) return;

    try {
      setIsDeleting(true);
      setFeedback({ type: "", message: "" });

      await axios.delete(
        `${API}/${addressToDelete.id}`,
        {
          withCredentials: true,
        }
      );

      // Remove immediately from UI
      setAddresses((prev) =>
        prev.filter((address) => address.id !== addressToDelete.id)
      );

      setFeedback({
        type: "success",
        message: `${addressToDelete.type === "home" ? "Home" : "Office"} address deleted successfully.`,
      });

      setAddressToDelete(null);

      // Auto dismiss success feedback
      setTimeout(() => {
        setFeedback((prev) => (prev.type === "success" ? { type: "", message: "" } : prev));
      }, 4000);
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error.response?.data?.message ||
          "Unable to delete address. Please try again.",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // --------------------------------------------------
  // LOADING
  // --------------------------------------------------

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center bg-[#0B1425]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#1E3252] border-t-[#42D6E8]" />
      </div>
    );
  }

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <div className="min-h-screen bg-[#0B1425] text-[#F1F5F9] px-4 py-6 sm:px-5 md:px-10 md:py-10 pb-28 sm:pb-16">
      <div className="mx-auto max-w-4xl">

        {/* HEADER */}
        <div className="mb-6 flex items-center gap-3.5 sm:mb-8">
          <button
            onClick={() => {
              if (window.history.state && window.history.state.idx > 0) {
                navigate(-1);
              } else {
                navigate("/account", { replace: true });
              }
            }}
            aria-label="Back to Account"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#111F36] text-[#F1F5F9] shadow-sm border border-[#1E3252] transition hover:bg-[#42D6E8] hover:text-[#061220] hover:border-[#42D6E8] cursor-pointer active:scale-95"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-[26px] font-extrabold tracking-tight text-[#F1F5F9] sm:text-[32px]">
              My Addresses
            </h1>
            <p className="text-xs text-[#8FA4BE] font-medium sm:text-sm">
              Manage your saved delivery addresses.
            </p>
          </div>
        </div>

        {/* FEEDBACK TOAST / BANNER */}
        {feedback.message && (
          <div
            className={`mb-6 flex items-center justify-between gap-3 rounded-2xl p-4 text-sm font-semibold animate-[slideUp_0.2s_ease-out] ${
              feedback.type === "success"
                ? "bg-[#132B45] text-[#67E8F9] border border-[#1E3252]"
                : "bg-rose-950/40 text-rose-300 border border-rose-900/60"
            }`}
          >
            <div className="flex items-center gap-2.5">
              {feedback.type === "success" ? (
                <CheckCircle2 size={18} className="shrink-0 text-[#42D6E8]" />
              ) : (
                <AlertCircle size={18} className="shrink-0 text-rose-400" />
              )}
              <span>{feedback.message}</span>
            </div>

            <button
              type="button"
              onClick={() => setFeedback({ type: "", message: "" })}
              className="rounded-lg p-1 text-[#8FA4BE] hover:text-[#F1F5F9] transition cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* ADD / EDIT FORM */}
        {showForm && (
          <div className="mb-8 rounded-3xl border border-[#1E3252]/80 bg-[#111F36] p-5 shadow-lg md:p-7 animate-[slideUp_0.25s_ease-out]">

            {/* FORM HEADER */}
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-extrabold text-[#F1F5F9]">
                  {editingId
                    ? "Edit Address"
                    : `Add ${!hasHome ? "Home" : "Office"} Address`}
                </h2>

                <p className="mt-1 text-sm text-[#8FA4BE]">
                  {editingId
                    ? "Update your saved delivery address details."
                    : "Save your address for 1-click checkout."}
                </p>
              </div>

              <button
                type="button"
                onClick={closeForm}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[#080F1C] text-[#8FA4BE] border border-[#1E3252] transition hover:bg-[#162744] hover:text-[#F1F5F9] cursor-pointer"
              >
                <X size={19} />
              </button>
            </div>

            {/* FORM ERROR */}
            {formError && (
              <div className="mb-5 rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-sm font-medium text-rose-300">
                {formError}
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              noValidate
              className="space-y-5"
            >

              {/* ADDRESS TYPE SELECTOR */}
              <div>
                <label className={`mb-2 block text-sm font-bold ${fieldErrors.type ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                  Address Type <span className={fieldErrors.type ? "text-rose-400 font-black" : "text-[#42D6E8]"}>*</span>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  {/* HOME OPTION */}
                  {isHomeAvailable ? (
                    <button
                      type="button"
                      onClick={() => {
                        setForm((prev) => ({
                          ...prev,
                          type: "home",
                        }));
                        if (fieldErrors.type) {
                          setFieldErrors((prev) => {
                            const next = { ...prev };
                            delete next.type;
                            return next;
                          });
                        }
                        setFormError("");
                      }}
                      className={`flex h-12 items-center justify-center gap-2 rounded-xl border-2 font-semibold transition cursor-pointer ${
                        form.type === "home"
                          ? "border-[#42D6E8] bg-[#132B45] text-[#67E8F9]"
                          : fieldErrors.type
                          ? "border-rose-400 text-[#8FA4BE] hover:bg-rose-950/20"
                          : "border-[#1E3252] bg-[#080F1C] text-[#8FA4BE] hover:bg-[#162744]"
                      }`}
                    >
                      <Home size={18} />
                      Home
                    </button>
                  ) : (
                    <div className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-[#1E3252] bg-[#080F1C]/50 px-3 text-xs font-semibold text-[#6E84A3]">
                      <Home size={16} />
                      <span>Home (Already Saved)</span>
                    </div>
                  )}

                  {/* OFFICE OPTION */}
                  {isOfficeAvailable ? (
                    <button
                      type="button"
                      onClick={() => {
                        setForm((prev) => ({
                          ...prev,
                          type: "office",
                        }));
                        if (fieldErrors.type) {
                          setFieldErrors((prev) => {
                            const next = { ...prev };
                            delete next.type;
                            return next;
                          });
                        }
                        setFormError("");
                      }}
                      className={`flex h-12 items-center justify-center gap-2 rounded-xl border-2 font-semibold transition cursor-pointer ${
                        form.type === "office"
                          ? "border-[#42D6E8] bg-[#132B45] text-[#67E8F9]"
                          : fieldErrors.type
                          ? "border-rose-400 text-[#8FA4BE] hover:bg-rose-950/20"
                          : "border-[#1E3252] bg-[#080F1C] text-[#8FA4BE] hover:bg-[#162744]"
                      }`}
                    >
                      <Building2 size={18} />
                      Office
                    </button>
                  ) : (
                    <div className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-[#1E3252] bg-[#080F1C]/50 px-3 text-xs font-semibold text-[#6E84A3]">
                      <Building2 size={16} />
                      <span>Office (Already Saved)</span>
                    </div>
                  )}
                </div>
                {fieldErrors.type && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-rose-400 animate-in fade-in duration-150">
                    <AlertCircle size={13} className="shrink-0 text-rose-400" />
                    <span>{fieldErrors.type}</span>
                  </p>
                )}
              </div>

              {/* FIRST NAME + LAST NAME */}
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className={`mb-2 block text-sm font-bold ${fieldErrors.first_name ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                    First Name <span className={fieldErrors.first_name ? "text-rose-400 font-black" : "text-[#42D6E8]"}>*</span>
                  </label>

                  <input
                    name="first_name"
                    autoComplete="given-name"
                    value={form.first_name}
                    onChange={handleChange}
                    placeholder="e.g. Rahul"
                    className={`h-12 w-full rounded-xl border px-4 text-sm outline-none transition ${
                      fieldErrors.first_name
                        ? "border-rose-500 bg-rose-950/40 text-rose-200 placeholder-rose-300 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/20"
                        : "border-[#1E3252] bg-[#080F1C] text-[#F1F5F9] focus:border-[#42D6E8] focus:ring-4 focus:ring-[#42D6E8]/15"
                    }`}
                  />
                  {fieldErrors.first_name && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-rose-400 animate-in fade-in duration-150">
                      <AlertCircle size={13} className="shrink-0 text-rose-400" />
                      <span>{fieldErrors.first_name}</span>
                    </p>
                  )}
                </div>

                <div>
                  <label className={`mb-2 block text-sm font-bold ${fieldErrors.last_name ? "text-rose-400" : "text-[#8DA79A]"}`}>
                    Last Name <span className={fieldErrors.last_name ? "text-rose-400 font-black" : "text-[#42D6E8]"}>*</span>
                  </label>

                  <input
                    name="last_name"
                    autoComplete="family-name"
                    value={form.last_name}
                    onChange={handleChange}
                    placeholder="e.g. Sharma"
                    className={`h-12 w-full rounded-xl border px-4 text-sm outline-none transition ${
                      fieldErrors.last_name
                        ? "border-rose-500 bg-rose-950/40 text-rose-200 placeholder-rose-300 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/20"
                        : "border-[#1E3252] bg-[#080F1C] text-[#F1F5F9] focus:border-[#42D6E8] focus:ring-4 focus:ring-[#42D6E8]/15"
                    }`}
                  />
                  {fieldErrors.last_name && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-rose-400 animate-in fade-in duration-150">
                      <AlertCircle size={13} className="shrink-0 text-rose-400" />
                      <span>{fieldErrors.last_name}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* PHONE */}
              <div>
                <label className={`mb-2 block text-sm font-bold ${fieldErrors.phone ? "text-rose-400" : "text-[#8DA79A]"}`}>
                  Mobile Number <span className={fieldErrors.phone ? "text-rose-400 font-black" : "text-[#42D6E8]"}>*</span>
                </label>

                <div className="relative flex items-center">
                  <span className={`absolute left-3.5 text-sm font-bold ${fieldErrors.phone ? "text-rose-400" : "text-[#6E84A3]"}`}>
                    +91
                  </span>
                  <input
                    name="phone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={form.phone}
                    onChange={handleChange}
                    placeholder="10-digit number"
                    className={`h-12 w-full rounded-xl border pl-12 pr-4 text-sm outline-none transition ${
                      fieldErrors.phone
                        ? "border-rose-500 bg-rose-950/40 text-rose-200 placeholder-rose-300 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/20"
                        : "border-[#1E3252] bg-[#080F1C] text-[#F1F5F9] focus:border-[#42D6E8] focus:ring-4 focus:ring-[#42D6E8]/15"
                    }`}
                  />
                </div>
                {fieldErrors.phone && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-rose-400 animate-in fade-in duration-150">
                    <AlertCircle size={13} className="shrink-0 text-rose-400" />
                    <span>{fieldErrors.phone}</span>
                  </p>
                )}
              </div>

              {/* ADDRESS LINE 1 */}
              <div>
                <label className={`mb-2 block text-sm font-bold ${fieldErrors.address_line1 ? "text-rose-400" : "text-[#8DA79A]"}`}>
                  Address Line 1 <span className={fieldErrors.address_line1 ? "text-rose-400 font-black" : "text-[#42D6E8]"}>*</span>
                </label>

                <input
                  name="address_line1"
                  value={form.address_line1}
                  onChange={handleChange}
                  placeholder="Flat / House no., building, street"
                  className={`h-12 w-full rounded-xl border px-4 text-sm outline-none transition ${
                    fieldErrors.address_line1
                      ? "border-rose-500 bg-rose-950/40 text-rose-200 placeholder-rose-300 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/20"
                      : "border-[#1E3252] bg-[#080F1C] text-[#F1F5F9] focus:border-[#42D6E8] focus:ring-4 focus:ring-[#42D6E8]/15"
                  }`}
                />
                {fieldErrors.address_line1 && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-rose-400 animate-in fade-in duration-150">
                    <AlertCircle size={13} className="shrink-0 text-rose-400" />
                    <span>{fieldErrors.address_line1}</span>
                  </p>
                )}
              </div>

              {/* ADDRESS LINE 2 */}
              <div>
                <label className="mb-2 block text-sm font-bold text-[#8FA4BE]">
                  Address Line 2
                  <span className="ml-1 font-normal text-[#6E84A3]">
                    (Optional)
                  </span>
                </label>

                <input
                  name="address_line2"
                  value={form.address_line2}
                  onChange={handleChange}
                  placeholder="Landmark, area name"
                  className="h-12 w-full rounded-xl border border-[#1E3252] bg-[#080F1C] px-4 text-sm text-[#F1F5F9] outline-none transition focus:border-[#42D6E8] focus:ring-4 focus:ring-[#42D6E8]/15"
                />
              </div>

              {/* DELIVERY REGION (4 OPTIONS WITH SMOOTH SCROLL) */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className={`block text-sm font-bold ${fieldErrors.city ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                    Delivery Region / Area <span className={fieldErrors.city ? "text-rose-400 font-black" : "text-[#42D6E8]"}>*</span>
                  </label>
                  <span className="text-[11px] font-semibold text-[#6E84A3]">
                    Local delivery zones
                  </span>
                </div>

                <div className={`flex gap-2 overflow-x-auto p-1 rounded-2xl scroll-smooth no-scrollbar md:grid md:grid-cols-2 lg:grid-cols-4 ${
                  fieldErrors.city ? "border-2 border-dashed border-rose-400/40 bg-rose-950/20" : ""
                }`}>
                  {DELIVERY_REGIONS.map((region) => {
                    const isSelected = form.city?.toLowerCase() === region.toLowerCase();

                    return (
                      <button
                        key={region}
                        type="button"
                        onClick={() => {
                          setForm((prev) => ({
                            ...prev,
                            city: region,
                          }));
                          if (fieldErrors.city) {
                            setFieldErrors((prev) => {
                              const next = { ...prev };
                              delete next.city;
                              return next;
                            });
                          }
                          setFormError("");
                        }}
                        className={`flex shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3.5 py-3 text-xs font-bold transition-all duration-200 cursor-pointer active:scale-95 ${
                          isSelected
                            ? "border-[#42D6E8] bg-[#132B45] text-[#67E8F9] shadow-sm ring-2 ring-[#42D6E8]/20"
                            : fieldErrors.city
                            ? "border-rose-400 bg-rose-950/30 text-[#8FA4BE]"
                            : "border-[#1E3252] bg-[#080F1C] text-[#8FA4BE] hover:border-[#42D6E8]/40 hover:bg-[#162744]"
                        }`}
                      >
                        <MapPin size={14} className={isSelected ? "text-[#67E8F9]" : fieldErrors.city ? "text-rose-400" : "text-[#6E84A3]"} />
                        <span className="whitespace-nowrap">{region}</span>
                      </button>
                    );
                  })}
                </div>
                {fieldErrors.city && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-rose-400 animate-in fade-in duration-150">
                    <AlertCircle size={13} className="shrink-0 text-rose-400" />
                    <span>{fieldErrors.city}</span>
                  </p>
                )}
              </div>

              {/* STATE (PERMANENTLY LOCKED TO MAHARASHTRA) */}
              <div>
                <label className="mb-2 block text-sm font-bold text-[#8FA4BE]">
                  State
                </label>

                <div className="flex h-12 w-full items-center justify-between rounded-xl border border-[#1E3252] bg-[#080F1C] px-4 text-sm font-bold text-[#8FA4BE]">
                  <div className="flex items-center gap-2">
                    <span className="text-[#F1F5F9]">Maharashtra</span>
                    <span className="text-xs font-semibold text-[#6E84A3]">(MH)</span>
                  </div>
                  <span className="rounded-md bg-[#132B45] border border-[#1E3252] px-2 py-0.5 text-[10px] font-extrabold uppercase text-[#67E8F9]">
                    Store Delivery Zone
                  </span>
                </div>
              </div>

              {/* FORM BUTTONS */}
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeForm}
                  disabled={saving}
                  className="h-12 rounded-xl border border-[#1E3252] bg-[#080F1C] px-6 text-sm font-bold text-[#8FA4BE] transition hover:bg-[#162744] hover:text-white disabled:opacity-50 cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#42D6E8] px-7 text-sm font-black text-[#061220] shadow-sm transition hover:bg-[#2CC4D8] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer active:scale-95"
                >
                  {saving && (
                    <Loader2
                      size={17}
                      className="animate-spin text-[#061220]"
                    />
                  )}

                  {saving
                    ? "Saving..."
                    : editingId
                    ? "Update Address"
                    : "Save Address"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* SAVED ADDRESSES */}
        {addresses.length === 0 ? (
          <div className="rounded-3xl border border-[#1E3252]/80 bg-[#111F36] p-8 text-center shadow-lg md:p-12">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#1E3252] bg-[#132B45] text-[#42D6E8]">
              <MapPin
                size={30}
                className="text-[#42D6E8]"
              />
            </div>

            <h2 className="text-xl font-bold text-[#F1F5F9]">
              No saved addresses
            </h2>

            <p className="mt-2 text-[#8FA4BE]">
              Add your Home or Office address for 1-click checkout.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {addresses.map((address) => {
              const isHome =
                address.type === "home";

              return (
                <div
                  key={address.id}
                  className="rounded-3xl bg-[#111F36] p-5 shadow-lg transition hover:border-[#42D6E8]/50 md:p-6 border border-[#1E3252]/80"
                >

                  {/* CARD HEADER */}
                  <div className="mb-5 flex items-start justify-between gap-3">

                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-[#1E3252] bg-[#132B45] text-[#42D6E8]">
                        {isHome ? (
                          <Home
                            size={23}
                            className="text-[#42D6E8]"
                          />
                        ) : (
                          <Building2
                            size={23}
                            className="text-[#42D6E8]"
                          />
                        )}
                      </div>

                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-extrabold text-[#F1F5F9]">
                            {isHome
                              ? "Home"
                              : "Office"}
                          </h2>

                          <span className="rounded-full bg-[#132B45] border border-[#1E3252] px-2.5 py-1 text-[10px] font-bold text-[#67E8F9]">
                            SAVED
                          </span>
                        </div>

                        <p className="mt-1 text-xs text-[#8FA4BE] font-medium">
                          Delivery address
                        </p>
                      </div>
                    </div>

                    {/* ACTION BUTTONS */}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          openEditForm(address)
                        }
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#1E3252] bg-[#080F1C] text-[#8FA4BE] transition hover:border-[#42D6E8] hover:text-[#42D6E8] cursor-pointer"
                        title="Edit address"
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handlePromptDelete(address)
                        }
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-rose-900/60 bg-[#080F1C] text-rose-400 transition hover:bg-rose-600 hover:border-rose-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                        title="Delete address"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {/* ADDRESS INFORMATION */}
                  <div className="border-t border-[#1E3252]/60 pt-5">

                    <p className="font-bold text-[#F1F5F9]">
                      {getCleanDisplayName(address.full_name, address.first_name, address.last_name)}
                    </p>

                    <p className="mt-1 text-sm text-[#8FA4BE] font-medium">
                      +91 {address.phone}
                    </p>

                    <div className="mt-4 text-[14px] leading-relaxed text-[#8FA4BE]">
                      <p>
                        {address.address_line1}
                      </p>

                      {address.address_line2 && (
                        <p>
                          {address.address_line2}
                        </p>
                      )}

                      <p className="font-semibold text-[#F1F5F9] pt-1">
                        {address.city}, Maharashtra
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ADD ADDRESS BUTTON — BOTTOM (HIDDEN WHEN BOTH HOME & OFFICE EXIST) */}
        {canAddAddress && !showForm && (
          <div className="mt-8 flex justify-center pb-4 sm:pb-6">
            <button
              type="button"
              onClick={openAddForm}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#42D6E8] px-6 py-4 text-[15px] font-black text-[#061220] shadow-lg transition hover:bg-[#2CC4D8] active:scale-[0.98] sm:w-auto sm:min-w-[220px] cursor-pointer"
            >
              <Plus size={19} />
              Add {!hasHome ? "Home" : "Office"} Address
            </button>
          </div>
        )}
      </div>

      {/* CONFIRM DELETE MODAL */}
      <ConfirmModal
        isOpen={Boolean(addressToDelete)}
        onClose={() => {
          if (!isDeleting) setAddressToDelete(null);
        }}
        onConfirm={handleConfirmDelete}
        title={`Delete ${addressToDelete?.type === "home" ? "Home" : "Office"} address?`}
        message="Are you sure you want to delete this saved address? This action cannot be undone."
        confirmText="Delete Address"
        cancelText="Cancel"
        isLoading={isDeleting}
        variant="danger"
      />
    </div>
  );
}

export default Addresses;